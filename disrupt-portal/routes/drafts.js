"use strict";

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const bolt11 = require("bolt11");
const lnurlPay = require("lnurl-pay");
const db = require("../db");
const logger = require("../logger");
const { schemas, validate } = require("../validators");
const { authenticateToken, authorizeRoles, authorizedRoles } = require("../middleware/auth");

const approveRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyGenerator: (req) => req.user.id,
  message: { success: false, message: "Too many approval requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
const { blinkPost, getBlinkWallets, fetchPreImageFromBlink, getBtcUsdRate, onChainPaymentSend } = require("../lib/blink");

// GET DRAFTS
router.get("/drafts", authenticateToken, async (req, res) => {
  try {
    const userRole = req.user.role;
    const userDepartment = req.user.department;

    let drafts;
    if (userRole !== "Admin") {
      drafts = db
        .prepare("SELECT * FROM drafts WHERE department = ? ORDER BY dateCreated DESC")
        .all(userDepartment);
    } else {
      drafts = db
        .prepare("SELECT * FROM drafts ORDER BY dateCreated DESC")
        .all();
    }

    res.json({ success: true, drafts });
  } catch (err) {
    logger.error("Error retrieving drafts:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to retrieve drafts." });
  }
});

// NEW DRAFT
router.post("/drafts", authenticateToken, validate(schemas.createDraft), async (req, res) => {
  try {
    const {
      title,
      recipientEmail,
      company,
      contact,
      recipientLightningAddress,
      recipientBtcAddress,
      paymentRail = "lightning",
      amount,
      note,
      receiptId,
    } = req.body;

    // Auto-generate title from contact/company if not provided
    const resolvedTitle =
      title && title.trim()
        ? title.trim()
        : `Payment to ${(contact || company || "Recipient").trim()}`;

    if (!req.user.department) {
      return res.status(400).json({
        success: false,
        message: "User department is required.",
      });
    }

    // Create new draft object
    // Validate receiptId belongs to this user if provided
    if (receiptId) {
      const receipt = db.prepare("SELECT uploadedBy FROM receipts WHERE id = ?").get(receiptId);
      if (!receipt || receipt.uploadedBy !== req.user.email) {
        return res.status(400).json({ success: false, message: "Invalid receipt." });
      }
    }

    const newDraft = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      title: resolvedTitle,
      recipientEmail: recipientEmail.trim(),
      company: company.trim(),
      contact: contact.trim(),
      recipientLightningAddress: recipientLightningAddress ? recipientLightningAddress.trim() : null,
      recipientBtcAddress: recipientBtcAddress ? recipientBtcAddress.trim() : null,
      paymentRail,
      amount: Number(amount),
      note: note ? note.trim() : "",
      createdBy: req.user.email,
      department: req.user.department,
      dateCreated: new Date().toISOString(),
      status: "pending",
      receiptId: receiptId || null,
    };

    db.prepare(`
      INSERT INTO drafts
        (id, title, recipientEmail, company, contact, recipientLightningAddress,
         recipientBtcAddress, paymentRail, amount, note, createdBy, department, dateCreated, status, receiptId)
      VALUES
        (@id, @title, @recipientEmail, @company, @contact, @recipientLightningAddress,
         @recipientBtcAddress, @paymentRail, @amount, @note, @createdBy, @department, @dateCreated, @status, @receiptId)
    `).run(newDraft);

    // Respond with success and new draft
    res.json({ success: true, draft: newDraft });
  } catch (err) {
    logger.error("Error saving draft:", err);
    res.status(500).json({ success: false, message: "Failed to save draft." });
  }
});

// APPROVE DRAFT
router.post(
  "/drafts/approve",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  approveRateLimit,
  validate(schemas.approveDraft),
  async (req, res) => {
    const { draftId } = req.body;

    try {
      // 1. Load draft
      const draft = db.prepare("SELECT * FROM drafts WHERE id = ?").get(draftId);
      if (!draft) {
        return res
          .status(404)
          .json({ success: false, message: "Draft not found." });
      }

      // C-4: Prevent self-approval
      if (draft.createdBy === req.user.email) {
        return res.status(403).json({ success: false, message: "Cannot approve your own draft." });
      }

      // H-3: Managers can only approve drafts from their own department
      if (req.user.role !== "Admin" && draft.department !== req.user.department) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }

      // 2. Idempotency guard — only process pending drafts
      if (draft.status !== "pending") {
        return res.status(409).json({
          success: false,
          message: `Draft is already ${draft.status}.`,
        });
      }

      // Atomically claim the draft (pending → processing) to prevent double-payment
      const claimed = db.prepare(
        "UPDATE drafts SET status = 'processing' WHERE id = ? AND status = 'pending'"
      ).run(draftId);
      if (claimed.changes === 0) {
        return res.status(409).json({
          success: false,
          message: "Draft is already being processed.",
        });
      }

      // 3. Get recipient, amount, memo
      const paymentRail = draft.paymentRail || "lightning";
      const amount = Number(draft.amountSats || draft.amount);
      const note = draft.note || draft.memo || "Disrupt Portal Payment";

      if (!amount) {
        return res.status(400).json({ success: false, message: "Draft is missing an amount." });
      }

      // 4. Get BTC wallet ID from Blink
      let walletId;
      try {
        const wallets = await getBlinkWallets();
        const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
        if (!btcWallet) throw new Error("No BTC wallet found");
        walletId = btcWallet.id;
      } catch (err) {
        db.prepare("UPDATE drafts SET status = 'pending' WHERE id = ?").run(draftId);
        return res.status(500).json({ success: false, message: "Failed to fetch wallet: " + err.message });
      }

      const btcUsdRate = await getBtcUsdRate();
      const approvedAt = new Date().toISOString();
      let transaction;

      // ── On-chain path ────────────────────────────────────────────────────────
      if (paymentRail === "onchain") {
        const btcAddress = draft.recipientBtcAddress;
        if (!btcAddress) {
          db.prepare("UPDATE drafts SET status = 'pending' WHERE id = ?").run(draftId);
          return res.status(400).json({ success: false, message: "Draft is missing a Bitcoin address." });
        }

        let onchainResult;
        try {
          onchainResult = await onChainPaymentSend(walletId, btcAddress, amount, note);
        } catch (err) {
          db.prepare("UPDATE drafts SET status = 'pending' WHERE id = ?").run(draftId);
          return res.status(500).json({ success: false, message: "On-chain payment failed: " + err.message });
        }

        if (onchainResult.errors && onchainResult.errors.length > 0) {
          db.prepare("UPDATE drafts SET status = 'pending' WHERE id = ?").run(draftId);
          return res.json({ success: false, message: onchainResult.errors[0].message });
        }

        const txnId = onchainResult.transaction?.id || `onchain_${Date.now()}`;
        transaction = {
          id: txnId,
          date: approvedAt,
          type: "onchain",
          receiver: draft.contact || draft.company || "Unknown",
          lightningAddress: null,
          invoice: null,
          amount,
          currency: "SATS",
          note,
          direction: "SENT",
          status: "PENDING",
          paymentHash: txnId,
          preImage: null,
          approvedStatus: "approved",
          approvedAt,
          approvedBy: req.user.email,
          btcUsdRate,
          receiptId: draft.receiptId || null,
        };

      // ── Lightning path ───────────────────────────────────────────────────────
      } else {
        const lightningAddress = draft.recipientLightningAddress || draft.lnAddress;
        if (!lightningAddress) {
          db.prepare("UPDATE drafts SET status = 'pending' WHERE id = ?").run(draftId);
          return res.status(400).json({ success: false, message: "Draft is missing a Lightning Address." });
        }

        let invoice;
        try {
          const lnurlResp = await lnurlPay.requestInvoice({ lnUrlOrAddress: lightningAddress, tokens: amount, comment: note });
          invoice = lnurlResp.invoice;
          if (!invoice) throw new Error("Could not resolve invoice from Lightning Address.");
        } catch (err) {
          db.prepare("UPDATE drafts SET status = 'pending' WHERE id = ?").run(draftId);
          return res.status(500).json({ success: false, message: "Failed to resolve Lightning Address: " + err.message });
        }

        let paymentHash = null;
        try {
          const decoded = bolt11.decode(invoice);
          paymentHash = decoded.tags.find((t) => t.tagName === "payment_hash")?.data || null;
        } catch (_) {}

        let paymentResult;
        try {
          const mutation = `
            mutation payInvoice($input: LnInvoicePaymentInput!) {
              lnInvoicePaymentSend(input: $input) {
                status
                errors { message }
              }
            }
          `;
          const payResp = await blinkPost({ query: mutation, variables: { input: { walletId, paymentRequest: invoice } } });
          const result = payResp.data.data.lnInvoicePaymentSend;
          if (result.errors && result.errors.length > 0) {
            db.prepare("UPDATE drafts SET status = 'pending' WHERE id = ?").run(draftId);
            return res.json({ success: false, message: result.errors[0].message });
          }
          paymentResult = result;
        } catch (err) {
          const isTimeout = err.code === "ECONNABORTED" || String(err.message).toLowerCase().includes("timeout");
          db.prepare("UPDATE drafts SET status = ? WHERE id = ?").run(isTimeout ? "pending_confirmation" : "pending", draftId);
          return res.status(500).json({ success: false, message: "Payment failed: " + err.message });
        }

        transaction = {
          id: String(paymentHash || Date.now()),
          date: approvedAt,
          type: "lightning",
          receiver: draft.contact || draft.company || "Unknown",
          lightningAddress: lightningAddress || null,
          invoice: invoice || null,
          amount,
          currency: "SATS",
          note,
          direction: "SENT",
          status: paymentResult?.status || "complete",
          paymentHash,
          preImage: await fetchPreImageFromBlink(paymentHash),
          approvedStatus: "approved",
          approvedAt,
          approvedBy: req.user.email,
          btcUsdRate,
          receiptId: draft.receiptId || null,
        };
      }

      // 9. Atomically approve draft + record transaction
      db.transaction(() => {
        db.prepare(
          "UPDATE drafts SET status = 'approved', approvedAt = ?, approvedBy = ? WHERE id = ?"
        ).run(approvedAt, req.user.email, draftId);

        db.prepare(`
          INSERT OR REPLACE INTO transactions
            (id, date, type, receiver, lightningAddress, invoice, amount, currency,
             note, direction, status, paymentHash, preImage, approvedStatus, approvedAt, approvedBy, btcUsdRate, receiptId)
          VALUES
            (@id, @date, @type, @receiver, @lightningAddress, @invoice, @amount, @currency,
             @note, @direction, @status, @paymentHash, @preImage, @approvedStatus, @approvedAt, @approvedBy, @btcUsdRate, @receiptId)
        `).run(transaction);
      })();

      logger.info({ draftId, amount, recipient: draft.contact, approvedBy: req.user.email, paymentHash }, "draft approved");
      res.json({ success: true, transaction });
    } catch (err) {
      logger.error({ err, draftId }, "draft approval failed");
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  },
);

router.post(
  "/drafts/decline",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  validate(schemas.declineDraft),
  async (req, res) => {
    const { draftId } = req.body;

    if (!draftId || typeof draftId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "Valid draftId is required." });
    }

    try {
      const draft = db.prepare("SELECT * FROM drafts WHERE id = ?").get(draftId);
      if (!draft) {
        return res.status(404).json({ success: false, message: "Draft not found." });
      }

      // H-3: Managers can only decline drafts from their own department
      if (req.user.role !== "Admin" && draft.department !== req.user.department) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }

      const result = db.prepare(
        "UPDATE drafts SET status = 'declined', declinedAt = ?, declinedBy = ? WHERE id = ? AND status = 'pending'"
      ).run(new Date().toISOString(), req.user.email, draftId);

      if (result.changes === 0) {
        return res.status(409).json({ success: false, message: "Draft is not in a pending state." });
      }

      res.json({ success: true });
    } catch (err) {
      logger.error("Error declining draft:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

module.exports = router;

"use strict";

const express = require("express");
const router = express.Router();
const bolt11 = require("bolt11");
const lnurlPay = require("lnurl-pay");
const db = require("../db");
const logger = require("../logger");
const { schemas, validate } = require("../validators");
const { validateTaxWithholding } = require("../tax");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { blinkPost, getBlinkWallets, fetchPreImageFromBlink, getBlinkTransactions, getBtcUsdRate } = require("../lib/blink");
const { dbTxnToObj, auditLog, getEmployeeByEmail, getSupplierById } = require("../lib/db-helpers");

const TAX_LIGHTNING_ADDRESS = process.env.TAX_LIGHTNING_ADDRESS;

router.get("/lightning-balance", authenticateToken, async (req, res) => {
  try {
    const wallets = await getBlinkWallets();
    const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
    res.json({ success: true, balanceSats: btcWallet.balance });
  } catch (err) {
    logger.error("Failed to fetch lightning balance:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch balance" });
  }
});

router.get("/transactions", authenticateToken, async (req, res) => {
  try {
    let blinkTxns = [];
    try {
      blinkTxns = await getBlinkTransactions();
    } catch (blinkErr) {
      logger.error("Error fetching Blink transactions:", blinkErr.message);
    }

    const localTxns = db
      .prepare("SELECT * FROM transactions")
      .all()
      .map(dbTxnToObj);

    const getReceiver = (txn) =>
      txn.recipient_name ||
      txn.receiver ||
      txn.contact ||
      txn.company ||
      txn.memo ||
      "Unknown";

    const mergedTxns = blinkTxns.map((blinkTxn) => {
      const local = localTxns.find((t) => t.id === blinkTxn.id);

      // Resolve amount/currency from Blink (authoritative settlement values)
      let amount, currency;
      if (blinkTxn.settlementCurrency === "BTC") {
        amount = blinkTxn.settlementAmount; // sats
        currency = "SATS";
      } else if (blinkTxn.settlementCurrency === "USD") {
        amount = (blinkTxn.settlementAmount / 100).toFixed(2); // dollars
        currency = "USD";
      } else {
        amount = blinkTxn.settlementAmount;
        currency = blinkTxn.settlementCurrency || "";
      }

      if (local) {
        // Local record exists — use it as the base so all rich fields
        // (invoice, lightningAddress, paymentHash, preImage, status, etc.)
        // are preserved. Only override amount/currency/date from Blink
        // since those are the authoritative settled values.
        return {
          ...local,
          receiver: getReceiver(local),
          amount,
          currency,
          date: blinkTxn.createdAt || local.date,
        };
      }

      // No local record — build minimal object from Blink data only
      return {
        id: blinkTxn.id,
        date: blinkTxn.createdAt,
        receiver: blinkTxn.memo || "Unknown",
        amount,
        currency,
        note: blinkTxn.memo || "",
        type: "lightning",
        status: blinkTxn.status,
        direction: blinkTxn.direction,
      };
    });

    // Include local transactions not in Blink — keep all fields as-is
    const blinkTxnIds = new Set(blinkTxns.map((txn) => txn.id));
    const uniqueLocalTxns = localTxns.filter((txn) => !blinkTxnIds.has(txn.id));

    const formattedLocalTxns = uniqueLocalTxns.map((txn) => ({
      ...txn,
      receiver: getReceiver(txn),
    }));

    const allTxns = [...mergedTxns, ...formattedLocalTxns];

    // Sort by date descending
    allTxns.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      transactions: allTxns,
    });
  } catch (err) {
    logger.error("Error reading transactions:", err);
    res.status(500).json({
      success: false,
      message: "Error reading transactions",
      error: err.message,
    });
  }
});

router.post("/transactions", authenticateToken, validate(schemas.sendTransaction), async (req, res) => {
  const { recipient, amountSats, memo } = req.body;

  if (!recipient || !amountSats) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: recipient and amountSats",
    });
  }

  try {
    // Fetch wallets from Blink API
    const wallets = await getBlinkWallets();
    const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");

    if (!btcWallet) {
      return res.status(400).json({
        success: false,
        message: "No BTC wallet found",
      });
    }

    // Prepare GraphQL mutation for Lightning Address payment
    const query = `
      mutation lnLightningAddressPaymentSend($input: LnLightningAddressPaymentInput!) {
        lnLightningAddressPaymentSend(input: $input) {
          status
          errors { message }
          payment {
            id
            status
            paymentHash
          }
        }
      }
    `;

    const variables = {
      input: {
        walletId: btcWallet.id,
        paymentRequest: null,
        lnAddress: recipient,
        amount: Number(amountSats),
        memo: memo || "",
      },
    };

    // Send payment request to Blink API
    const response = await blinkPost({ query, variables });

    const result = response.data.data.lnLightningAddressPaymentSend;

    if (result.errors && result.errors.length > 0) {
      return res.json({
        success: false,
        message: result.errors[0].message,
      });
    }

    // Capture BTC/USD rate at time of payment
    const btcUsdRate = await getBtcUsdRate();

    // Prepare new transaction object
    const newTxn = {
      id: result.payment.id,
      date: new Date().toISOString(),
      receiver: recipient,
      amount: amountSats,
      currency: "SATS",
      note: memo || "",
      type: "lightning",
      direction: "SENT",
      status: result.payment.status,
      btcUsdRate: btcUsdRate,
    };

    db.prepare(`
      INSERT OR REPLACE INTO transactions (id, date, receiver, amount, currency, note, type, direction, status, btcUsdRate)
      VALUES (@id, @date, @receiver, @amount, @currency, @note, @type, @direction, @status, @btcUsdRate)
    `).run(newTxn);

    // Respond with success and payment info
    res.json({
      success: true,
      payment: result.payment,
      transaction: newTxn,
    });
  } catch (err) {
    logger.error("Error processing Lightning payment:", err);
    res.status(500).json({
      success: false,
      message: "Failed to process Lightning payment",
      error: err.message,
    });
  }
});

// GET EXCHANGE RATE
router.get("/btc-usd-rate", authenticateToken, async (req, res) => {
  const rate = await getBtcUsdRate();
  if (rate !== null) {
    return res.json({ success: true, rate });
  }
  res.json({ success: false, rate: null });
});

router.post("/transactions/local", authenticateToken, async (req, res) => {
  try {
    const newTransaction = req.body;

    // Capture BTC/USD rate at time of save
    const btcUsdRate = await getBtcUsdRate();

    const transactionWithId = {
      id: `txn_${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      ...newTransaction,
      btcUsdRate: newTransaction.btcUsdRate ?? btcUsdRate,
    };

    // Build the insert dynamically from whatever fields are present
    const cols = Object.keys(transactionWithId);
    const placeholders = cols.map((c) => `@${c}`).join(", ");
    db.prepare(
      `INSERT OR REPLACE INTO transactions (${cols.join(", ")}) VALUES (${placeholders})`
    ).run(transactionWithId);

    res.json({
      success: true,
      transaction: transactionWithId,
    });
  } catch (err) {
    logger.error("Error saving transaction:", err);
    res.status(500).json({
      success: false,
      message: "Failed to save transaction",
    });
  }
});

//// NEW PAYMENT /////
router.post("/pay", authenticateToken, validate(schemas.pay), async (req, res) => {
  try {
    const {
      recipientType,
      recipientId,
      contact,
      company,
      email,
      lightningAddress,
      paymentAmount,
      paymentNote,
      taxWithholding,
      btcUsdRate: clientBtcUsdRate,
    } = req.body;

    const amount = Number(paymentAmount);
    const note = paymentNote || "";

    // Lookup recipient for validation
    let recipient;
    if (recipientType === "employee") {
      recipient = getEmployeeByEmail(recipientId);
    } else {
      recipient = getSupplierById(recipientId);
    }

    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: "Recipient not found.",
      });
    }

    // Validate client-supplied tax math against server-computed values
    const taxValidationError = validateTaxWithholding(taxWithholding);
    if (taxValidationError) {
      return res.status(400).json({ success: false, message: taxValidationError });
    }

    // Handle tax withholding logic
    const isTaxWithholding = taxWithholding && taxWithholding.applied;
    let employeeInvoice, taxInvoice;
    let employeeAmount = amount;
    let taxAmount = 0;

    if (isTaxWithholding) {
      employeeAmount = taxWithholding.netAmount;
      taxAmount = taxWithholding.taxAmount;
    }

    // Resolve Lightning Address to invoice for employee payment
    try {
      const lnurlResp = await lnurlPay.requestInvoice({
        lnUrlOrAddress: lightningAddress,
        tokens: employeeAmount,
        comment: note,
      });
      employeeInvoice = lnurlResp.invoice;
      if (!employeeInvoice) {
        throw new Error("Could not resolve invoice from Lightning Address.");
      }
    } catch (err) {
      logger.error("LNURL-pay error for employee:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to resolve employee Lightning Address: " + err.message,
      });
    }

    // If tax withholding, resolve tax invoice
    if (isTaxWithholding && taxAmount > 0) {
      try {
        const taxLnurlResp = await lnurlPay.requestInvoice({
          lnUrlOrAddress: TAX_LIGHTNING_ADDRESS,
          tokens: taxAmount,
          comment: `Tax withholding for ${contact} - ${note}`,
        });
        taxInvoice = taxLnurlResp.invoice;
        if (!taxInvoice) {
          throw new Error("Could not resolve tax withholding invoice.");
        }
      } catch (err) {
        logger.error("LNURL-pay error for tax:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to resolve tax Lightning Address: " + err.message,
        });
      }
    }

    // Fetch BTC wallet ID from Blink
    let walletId;
    try {
      const wallets = await getBlinkWallets();
      const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
      if (!btcWallet) throw new Error("No BTC wallet found");
      walletId = btcWallet.id;
    } catch (err) {
      logger.error("Failed to fetch wallet:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch wallet: " + err.message,
      });
    }

    // Decode employee invoice to get payment_hash
    let employeePaymentHash = null;
    try {
      const decodedInvoice = bolt11.decode(employeeInvoice);
      employeePaymentHash =
        decodedInvoice.tags.find((t) => t.tagName === "payment_hash")?.data ||
        null;
    } catch (err) {
      logger.warn("Failed to decode employee invoice:", err);
    }

    // Pay the employee invoice via Blink
    let employeePaymentResult;
    try {
      const mutation = `
        mutation payInvoice($input: LnInvoicePaymentInput!) {
          lnInvoicePaymentSend(input: $input) {
            status
            errors { message }
          }
        }
      `;
      const variables = {
        input: {
          walletId,
          paymentRequest: employeeInvoice,
        },
      };
      const payResp = await blinkPost({ query: mutation, variables });

      const result = payResp.data.data.lnInvoicePaymentSend;
      if (result.errors && result.errors.length > 0) {
        return res.json({ success: false, message: result.errors[0].message });
      }
      employeePaymentResult = result;
    } catch (err) {
      const blinkError = err.response?.data ? JSON.stringify(err.response.data) : "";
      logger.error("Employee payment failed:", err);
      return res.status(500).json({
        success: false,
        message: "Employee payment failed: " + err.message + " " + blinkError,
      });
    }

    // Handle tax payment if withholding is applied
    let taxPaymentResult = null;
    let taxPaymentHash = null;
    let taxPaymentFailed = false;

    if (isTaxWithholding && taxInvoice) {
      try {
        const decodedTaxInvoice = bolt11.decode(taxInvoice);
        taxPaymentHash =
          decodedTaxInvoice.tags.find((t) => t.tagName === "payment_hash")
            ?.data || null;
      } catch (err) {
        logger.warn("Failed to decode tax invoice:", err);
      }

      try {
        const mutation = `
          mutation payInvoice($input: LnInvoicePaymentInput!) {
            lnInvoicePaymentSend(input: $input) {
              status
              errors { message }
            }
          }
        `;
        const taxPayResp = await blinkPost({ query: mutation, variables: { input: { walletId, paymentRequest: taxInvoice } } });

        const taxResult = taxPayResp.data.data.lnInvoicePaymentSend;
        if (taxResult.errors && taxResult.errors.length > 0) {
          taxPaymentFailed = true;
          logger.error({ contact, taxAmount, errMsg: taxResult.errors[0].message }, "tax payment failed");
          auditLog(req.user.email, "TAX_PAYMENT_FAILED", contact, taxResult.errors[0].message);
        } else {
          taxPaymentResult = taxResult;
        }
      } catch (err) {
        taxPaymentFailed = true;
        logger.error({ contact, taxAmount, err: err.message }, "tax payment failed");
        auditLog(req.user.email, "TAX_PAYMENT_FAILED", contact, err.message);
      }
    }

    // Use client-provided rate if available, otherwise fetch from CoinGecko
    const btcUsdRate =
      typeof clientBtcUsdRate === "number" && clientBtcUsdRate > 0
        ? clientBtcUsdRate
        : await getBtcUsdRate();

    // Create employee transaction record
    const employeeTransaction = {
      id: employeePaymentHash || Date.now(),
      date: new Date().toISOString(),
      type: "payment",
      recipientType,
      recipientId,
      contact,
      company,
      lightningAddress,
      invoice: employeeInvoice,
      amount: employeeAmount,
      currency: "SATS",
      note: isTaxWithholding ? `${note} (Net after tax withholding)` : note,
      direction: "SENT",
      status: (employeePaymentResult?.status || "SUCCESS").toUpperCase(),
      paymentHash: employeePaymentHash,
      preImage: await fetchPreImageFromBlink(employeePaymentHash),
      btcUsdRate: btcUsdRate,
      taxPaymentFailed: taxPaymentFailed ? 1 : 0,
      taxWithholding: isTaxWithholding
        ? {
            originalAmount: taxWithholding.originalAmount,
            taxAmount: taxAmount,
            netAmount: employeeAmount,
          }
        : null,
    };

    // Create tax transaction record if applicable
    let taxTransaction = null;
    if (isTaxWithholding && taxPaymentResult) {
      taxTransaction = {
        id: taxPaymentHash || `tax_${Date.now()}`,
        date: new Date().toISOString(),
        type: "tax_withholding",
        recipientType: "government",
        recipientId: "tax_authority",
        contact: "Tax Authority",
        company: "Government",
        lightningAddress: TAX_LIGHTNING_ADDRESS,
        invoice: taxInvoice,
        amount: taxAmount,
        preImage: await fetchPreImageFromBlink(taxPaymentHash),
        currency: "SATS",
        note: `${taxWithholding.type || "employee"} tax withholding for ${contact} - ${note}`,
        direction: "SENT",
        status: (taxPaymentResult?.status || "SUCCESS").toUpperCase(),
        paymentHash: taxPaymentHash,
        relatedEmployeePayment: employeePaymentHash,
        taxType: taxWithholding.type || "employee",
        btcUsdRate: btcUsdRate,
      };
    }

    // Save transactions atomically
    const insertTxnStmt = db.prepare(`
      INSERT OR REPLACE INTO transactions
        (id, date, type, recipientType, recipientId, contact, company, lightningAddress,
         invoice, amount, currency, note, direction, status, paymentHash, preImage,
         btcUsdRate, taxWithholding, taxPaymentFailed)
      VALUES
        (@id, @date, @type, @recipientType, @recipientId, @contact, @company, @lightningAddress,
         @invoice, @amount, @currency, @note, @direction, @status, @paymentHash, @preImage,
         @btcUsdRate, @taxWithholding, @taxPaymentFailed)
    `);
    const insertTaxStmt = db.prepare(`
      INSERT OR REPLACE INTO transactions
        (id, date, type, recipientType, recipientId, contact, company, lightningAddress,
         invoice, amount, currency, note, direction, status, paymentHash, preImage,
         btcUsdRate, relatedEmployeePayment, taxType)
      VALUES
        (@id, @date, @type, @recipientType, @recipientId, @contact, @company, @lightningAddress,
         @invoice, @amount, @currency, @note, @direction, @status, @paymentHash, @preImage,
         @btcUsdRate, @relatedEmployeePayment, @taxType)
    `);
    db.transaction(() => {
      insertTxnStmt.run({
        ...employeeTransaction,
        id: String(employeeTransaction.id),
        taxWithholding: employeeTransaction.taxWithholding
          ? JSON.stringify(employeeTransaction.taxWithholding)
          : null,
      });
      if (taxTransaction) {
        insertTaxStmt.run({ ...taxTransaction, id: String(taxTransaction.id) });
      }
    })();

    // Respond success
    const response = {
      success: true,
      employeeTransaction,
      taxTransaction: taxTransaction || null,
      taxWithholding: isTaxWithholding
        ? {
            applied: true,
            originalAmount: taxWithholding.originalAmount,
            employeeAmount: employeeAmount,
            taxAmount: taxAmount,
            taxPaymentSuccess: !!taxPaymentResult,
            taxPaymentFailed,
            taxLightningAddress: TAX_LIGHTNING_ADDRESS,
          }
        : null,
    };

    logger.info({ contact, company, recipientType, employeeAmount, taxAmount, taxPaymentFailed, paymentHash: employeePaymentHash, paidBy: req.user.email }, "payment sent");
    return res.json(response);
  } catch (err) {
    logger.error({ err: err.message }, "internal error in /api/pay");
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// API endpoint to get tax lightning address
router.get("/tax-address", authenticateToken, (req, res) => {
  res.json({
    success: true,
    taxLightningAddress: TAX_LIGHTNING_ADDRESS,
  });
});

// PAY INVOICE
router.post("/pay-invoice", authenticateToken, validate(schemas.payInvoice), async (req, res) => {
  const {
    invoice,
    note,
    receiverName,
    lightningAddress,
    btcUsdRate: clientBtcUsdRate,
  } = req.body;

  if (!invoice) {
    return res
      .status(400)
      .json({ success: false, message: "Missing invoice." });
  }

  // Step 1: Fetch BTC wallet ID from Blink
  let walletId;
  try {
    const wallets = await getBlinkWallets();
    const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
    if (!btcWallet) throw new Error("No BTC wallet found");
    walletId = btcWallet.id;
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet: " + err.message,
    });
  }

  // Step 2: Decode invoice to extract payment_hash, amount
  let paymentHash = null;
  let amount = 0;
  let currency = "SATS";
  let receiver =
    receiverName && receiverName.trim() !== "" ? receiverName.trim() : null;

  try {
    const decodedInvoice = bolt11.decode(invoice);

    paymentHash =
      decodedInvoice.tags.find((t) => t.tagName === "payment_hash")?.data ||
      null;

    amount = decodedInvoice.satoshis || 0;

    // Only use payee node key if recipientName not provided
    if (!receiver) {
      const payeeTag = decodedInvoice.tags.find((t) =>
        ["payee_node_key", "pubkey", "node_id"].includes(t.tagName),
      );
      if (payeeTag && payeeTag.data) {
        receiver = payeeTag.data;
      } else {
        receiver = "Unknown";
      }
    }
  } catch (err) {
    logger.warn("Failed to decode invoice:", err);
    if (!receiver) receiver = "Unknown";
  }

  // Step 3: Pay the invoice via Blink (simplified mutation)
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

    const variables = {
      input: {
        walletId,
        paymentRequest: invoice,
      },
    };

    const payResp = await blinkPost({ query: mutation, variables });

    const result = payResp.data.data.lnInvoicePaymentSend;

    if (result.errors && result.errors.length > 0) {
      return res.json({ success: false, message: result.errors[0].message });
    }

    paymentResult = result;
  } catch (err) {
    const blinkError = err.response?.data ? JSON.stringify(err.response.data) : "";
    return res.status(500).json({
      success: false,
      message: "Payment failed: " + err.message + " " + blinkError,
    });
  }

  // Step 4: Use client-provided rate if available, otherwise fetch from CoinGecko
  const btcUsdRate =
    typeof clientBtcUsdRate === "number" && clientBtcUsdRate > 0
      ? clientBtcUsdRate
      : await getBtcUsdRate();

  // Step 5: Create new transaction record
  const transaction = {
    id: paymentHash || Date.now(),
    date: new Date().toISOString(),
    type: "lightning",
    receiver,
    lightningAddress: lightningAddress || null,
    invoice: invoice || null,
    amount: Number(amount) || 0,
    currency,
    note: note || "",
    direction: "SENT",
    status: paymentResult?.status || "complete",
    paymentHash,
    preImage: await fetchPreImageFromBlink(paymentHash),
    btcUsdRate: btcUsdRate,
  };

  // Step 6: Save transaction
  db.prepare(`
    INSERT OR REPLACE INTO transactions
      (id, date, type, receiver, lightningAddress, invoice, amount, currency,
       note, direction, status, paymentHash, preImage, btcUsdRate)
    VALUES
      (@id, @date, @type, @receiver, @lightningAddress, @invoice, @amount, @currency,
       @note, @direction, @status, @paymentHash, @preImage, @btcUsdRate)
  `).run({ ...transaction, id: String(transaction.id) });
  return res.json({ success: true, transaction });
});

router.post(
  "/batch-payment",
  authenticateToken,
  authorizeRoles("Admin", "Manager"),
  validate(schemas.batchPayment),
  async (req, res) => {
    const { payments } = req.body;
    logger.debug("Batch payment request received with payments:", payments);

    if (!payments || !Array.isArray(payments)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid batch payment data." });
    }

    const paymentStatuses = [];
    logger.debug("Using API key:", process.env.BLINK_API_KEY ? "Present" : "MISSING");
    let walletId;

    try {
      const wallets = await getBlinkWallets();
      logger.debug("Retrieved wallets:", wallets);
      const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
      if (!btcWallet) {
        logger.debug("No BTC wallet found in wallets:", wallets);
        return res
          .status(400)
          .json({ success: false, message: "No BTC wallet found" });
      }
      walletId = btcWallet.id;
      logger.debug("Using wallet ID:", walletId);
    } catch (error) {
      logger.error("Failed to fetch wallet information:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch wallet information.",
      });
    }

    for (const payment of payments) {
      logger.debug("Processing payment:", payment);
      try {
        const { lightningAddress, amount } = payment;
        logger.debug(`Sending ${amount} sats to ${lightningAddress}`);

        // Step 1: Convert Lightning address to invoice using LNURL-pay
        let invoice;
        try {
          const lnurlResp = await lnurlPay.requestInvoice({
            lnUrlOrAddress: lightningAddress,
            tokens: Number(amount),
            comment: payment.note || "",
          });
          invoice = lnurlResp.invoice;
          if (!invoice) {
            throw new Error(
              "Could not resolve invoice from Lightning Address.",
            );
          }
          logger.debug("Resolved invoice for", lightningAddress);
        } catch (err) {
          logger.error("LNURL-pay error:", err);
          paymentStatuses.push({
            ...payment,
            status: "Failed",
            error: "Failed to resolve Lightning Address: " + err.message,
          });
          continue;
        }

        // Step 2: Pay the invoice using lnInvoicePaymentSend
        const mutation = `
          mutation payInvoice($input: LnInvoicePaymentInput!) {
            lnInvoicePaymentSend(input: $input) {
              status
              errors { message }
            }
          }
        `;

        const variables = {
          input: {
            walletId: walletId,
            paymentRequest: invoice,
          },
        };

        logger.debug("Paying invoice for", lightningAddress);

        const response = await blinkPost({ query: mutation, variables });

        const result = response.data.data.lnInvoicePaymentSend;
        logger.debug("Payment result:", JSON.stringify(result, null, 2));

        if (result.errors && result.errors.length > 0) {
          logger.warn({ lightningAddress, amount, errMsg: result.errors[0].message }, "batch payment failed");
          paymentStatuses.push({
            ...payment,
            status: "Failed",
            error: result.errors[0].message,
          });
        } else {
          logger.info({ lightningAddress, amount }, "batch payment sent");
          paymentStatuses.push({ ...payment, status: "Success" });
        }
      } catch (error) {
        logger.error({ lightningAddress: payment.lightningAddress, amount: payment.amount, err: error.message }, "batch payment error");
        paymentStatuses.push({
          ...payment,
          status: "Failed",
          error: error.message,
        });
      }
    }

    logger.debug("Final payment statuses:", paymentStatuses);

    // Save successful payments to transactions.json
    const successfulPayments = paymentStatuses.filter(
      (p) => p.status === "Success",
    );

    if (successfulPayments.length > 0) {
      try {
        const btcUsdRate = await getBtcUsdRate();
        const insertBatch = db.prepare(`
          INSERT OR REPLACE INTO transactions
            (id, date, type, receiver, lightningAddress, amount, currency, note, direction, status, btcUsdRate)
          VALUES
            (@id, @date, @type, @receiver, @lightningAddress, @amount, @currency, @note, @direction, @status, @btcUsdRate)
        `);
        db.transaction(() => {
          for (const payment of successfulPayments) {
            insertBatch.run({
              id: `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              date: new Date().toISOString(),
              type: "batch",
              receiver: payment.name || payment.lightningAddress,
              lightningAddress: payment.lightningAddress,
              amount: Number(payment.amount),
              currency: "SATS",
              note: payment.note || "",
              direction: "SENT",
              status: "SUCCESS",
              btcUsdRate: btcUsdRate,
            });
          }
        })();
      } catch (err) {
        logger.error("Failed to save batch transactions:", err);
      }
    }

    res.json({ success: true, paymentStatuses });
  },
);

router.post("/decode-invoice", authenticateToken, validate(schemas.decodeInvoice), (req, res) => {
  const { invoice } = req.body;

  if (!invoice || typeof invoice !== "string") {
    return res.status(400).json({
      success: false,
      error: "Invoice is required and must be a string.",
    });
  }

  try {
    const decoded = bolt11.decode(invoice);

    const expiryTag = decoded.tags.find((t) => t.tagName === "expire_time");
    const expirySeconds = expiryTag ? parseInt(expiryTag.data, 10) : 3600;
    const invoiceTimestamp = decoded.timestamp;
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = invoiceTimestamp + expirySeconds - now;

    res.json({
      success: true,
      decoded,
      expiry: expirySeconds,
      timestamp: invoiceTimestamp,
      expiresIn,
      isExpired: expiresIn <= 0,
    });
  } catch (err) {
    logger.error("Error decoding invoice:", err);
    res
      .status(400)
      .json({ success: false, error: "Invalid or unsupported invoice." });
  }
});

module.exports = router;

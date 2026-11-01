"use strict";

const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const { ZipArchive } = require("archiver");
const db = require("../db");
const logger = require("../logger");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { UPLOAD_DIR } = require("../middleware/upload");
const { dbTxnToObj, auditLog } = require("../lib/db-helpers");
const { getBlinkTransactions } = require("../lib/blink");

// ── CSV helpers ───────────────────────────────────────────────────────────────
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// ── Transaction classification ────────────────────────────────────────────────
// payroll: employee payments; tax: withholding remittances; income: received;
// expense: everything else sent. Category kind wins when a category is set.
function classify(txn, categoriesById) {
  const dir = String(txn.direction || "SENT").toUpperCase();
  if (dir === "RECEIVE" || dir === "RECEIVED") return "income";
  if (txn.type === "tax_withholding") return "tax";
  const kind = txn.categoryId && categoriesById[txn.categoryId]?.kind;
  if (kind === "payroll" || kind === "tax" || kind === "income") return kind;
  if (txn.recipientType === "employee" || txn.taxWithholding) return "payroll";
  return "expense";
}

function fmtFiat(n) {
  return n === null || n === undefined ? "" : Number(n).toFixed(2);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// ── Monthly accountant package ────────────────────────────────────────────────
// GET /api/reports/package/2026-06 → ZIP of CSVs, printable summary, receipts
router.get(
  "/reports/package/:period",
  authenticateToken,
  authorizeRoles("Admin", "Bookkeeper"),
  async (req, res) => {
    const { period } = req.params;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return res.status(400).json({ success: false, message: "Period must be YYYY-MM." });
    }

    try {
      const fiatCurrency =
        db.prepare("SELECT value FROM settings WHERE key = 'fiatCurrency'").get()?.value || "USD";
      const categoriesById = {};
      for (const cat of db.prepare("SELECT * FROM categories").all()) {
        categoriesById[cat.id] = cat;
      }
      const categoryName = (txn) =>
        (txn.categoryId && categoriesById[txn.categoryId]?.name) || "Uncategorized";

      // Local records for the period (dates are ISO strings, so prefix-match)
      const localTxns = db
        .prepare("SELECT * FROM transactions WHERE date LIKE ? ORDER BY date")
        .all(`${period}%`)
        .map(dbTxnToObj);

      // Best-effort: pull wallet-received payments Blink knows about that we have
      // no local record for (Blink only returns the most recent 50 transactions,
      // so older months may be incomplete — the summary states this).
      let blinkIncome = [];
      let blinkAvailable = false;
      try {
        const blinkTxns = await getBlinkTransactions();
        blinkAvailable = true;
        const localIds = new Set(localTxns.map((t) => t.id));
        const localHashes = new Set(localTxns.map((t) => t.paymentHash).filter(Boolean));
        blinkIncome = blinkTxns
          .filter((b) => {
            const date = new Date(b.createdAt * 1000).toISOString();
            return (
              b.direction === "RECEIVE" &&
              date.startsWith(period) &&
              !localIds.has(b.id) &&
              !(b.initiationVia?.paymentHash && localHashes.has(b.initiationVia.paymentHash))
            );
          })
          .map((b) => ({
            id: b.id,
            date: new Date(b.createdAt * 1000).toISOString(),
            type: "lightning",
            direction: "RECEIVE",
            receiver: b.memo || b.settlementVia?.counterPartyUsername || "Lightning payment received",
            note: b.memo || "",
            amount: b.settlementCurrency === "BTC" ? b.settlementAmount : b.settlementAmount / 100,
            currency: b.settlementCurrency === "BTC" ? "SATS" : b.settlementCurrency,
            btcUsdRate: null,
            amountFiat: b.settlementCurrency === "USD" ? b.settlementAmount / 100 : null,
            status: b.status,
            categoryId: null,
            source: "blink",
          }));
      } catch (err) {
        logger.warn("Blink unavailable for report generation:", err.message);
      }

      const allTxns = [...localTxns.map((t) => ({ ...t, source: "local" })), ...blinkIncome];
      const byClass = { income: [], expense: [], payroll: [], tax: [] };
      for (const txn of allTxns) byClass[classify(txn, categoriesById)].push(txn);

      // ── Build CSV contents ───────────────────────────────────────────────────
      const fiatCol = `amount${fiatCurrency}`;

      const transactionsCsv = toCsv(
        ["id", "date", "type", "direction", "receiver", "category", "note", "amountSats",
         "currency", "btcUsdRate", fiatCol, "status", "paymentHash", "preImage", "source"],
        allTxns.map((t) => ({
          id: t.id, date: t.date, type: t.type, direction: t.direction,
          receiver: t.receiver || t.contact || t.company || "", category: categoryName(t),
          note: t.note, amountSats: t.amount, currency: t.currency || "SATS",
          btcUsdRate: t.btcUsdRate, [fiatCol]: fmtFiat(t.amountFiat), status: t.status,
          paymentHash: t.paymentHash, preImage: t.preImage, source: t.source,
        }))
      );

      const receiptById = (id) =>
        id ? db.prepare("SELECT * FROM receipts WHERE id = ?").get(id) : null;

      const expensesCsv = toCsv(
        ["date", "receiver", "company", "category", "note", "amountSats", "btcUsdRate", fiatCol, "receiptFile", "paymentHash"],
        byClass.expense.map((t) => ({
          date: t.date, receiver: t.receiver || t.contact || "", company: t.company || "",
          category: categoryName(t), note: t.note, amountSats: t.amount,
          btcUsdRate: t.btcUsdRate, [fiatCol]: fmtFiat(t.amountFiat),
          receiptFile: receiptById(t.receiptId)?.originalName || "",
          paymentHash: t.paymentHash,
        }))
      );

      const incomeCsv = toCsv(
        ["date", "from", "category", "note", "amountSats", "currency", "btcUsdRate", fiatCol, "status", "source"],
        byClass.income.map((t) => ({
          date: t.date, from: t.receiver || t.contact || "", category: categoryName(t),
          note: t.note, amountSats: t.amount, currency: t.currency || "SATS",
          btcUsdRate: t.btcUsdRate, [fiatCol]: fmtFiat(t.amountFiat),
          status: t.status, source: t.source,
        }))
      );

      const payrollCsv = toCsv(
        ["date", "employee", "grossSats", "withheldSats", "employerContributionSats", "netSats", "btcUsdRate",
         `gross${fiatCurrency}`, `net${fiatCurrency}`, "status", "paymentHash", "taxPaymentFailed"],
        byClass.payroll.map((t) => {
          const w = t.taxWithholding || null;
          const gross = w ? w.originalAmount : t.amount;
          // Split by what actually reached the employee, so records made when the
          // employer share was taken from pay still show the true amounts.
          const withheld = w ? w.originalAmount - w.netAmount : 0;
          const employerContribution = w ? w.taxAmount - withheld : 0;
          const rate = t.btcUsdRate;
          const grossFiat = rate ? Math.round((gross * rate / 100000000) * 100) / 100 : null;
          return {
            date: t.date, employee: t.receiver || t.contact || "",
            grossSats: gross, withheldSats: withheld, employerContributionSats: employerContribution,
            netSats: w ? w.netAmount : t.amount,
            btcUsdRate: rate, [`gross${fiatCurrency}`]: fmtFiat(grossFiat),
            [`net${fiatCurrency}`]: fmtFiat(t.amountFiat),
            status: t.status, paymentHash: t.paymentHash,
            taxPaymentFailed: t.taxPaymentFailed ? "YES" : "",
          };
        })
      );

      const withholdingsCsv = toCsv(
        ["date", "taxType", "note", "amountSats", "btcUsdRate", fiatCol, "status", "paymentHash", "relatedEmployeePayment"],
        byClass.tax.map((t) => ({
          date: t.date, taxType: t.taxType || "", note: t.note, amountSats: t.amount,
          btcUsdRate: t.btcUsdRate, [fiatCol]: fmtFiat(t.amountFiat), status: t.status,
          paymentHash: t.paymentHash, relatedEmployeePayment: t.relatedEmployeePayment || "",
        }))
      );

      // ── Summary numbers ──────────────────────────────────────────────────────
      const sumFiat = (rows) => rows.reduce((acc, t) => acc + (Number(t.amountFiat) || 0), 0);
      const sumSats = (rows) => rows.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      const unvalued = allTxns.filter((t) => t.amountFiat === null || t.amountFiat === undefined).length;

      const expenseByCategory = {};
      for (const t of byClass.expense) {
        const name = categoryName(t);
        expenseByCategory[name] = expenseByCategory[name] || { fiat: 0, sats: 0, count: 0 };
        expenseByCategory[name].fiat += Number(t.amountFiat) || 0;
        expenseByCategory[name].sats += Number(t.amount) || 0;
        expenseByCategory[name].count += 1;
      }

      const payrollGrossSats = byClass.payroll.reduce(
        (acc, t) => acc + Number(t.taxWithholding ? t.taxWithholding.originalAmount : t.amount || 0), 0);
      const payrollWithheldSats = byClass.payroll.reduce(
        (acc, t) => acc + Number(t.taxWithholding ? t.taxWithholding.taxAmount : 0), 0);
      const failedTaxPayments = byClass.payroll.filter((t) => t.taxPaymentFailed).length;

      const categoryRows = Object.entries(expenseByCategory)
        .sort((a, b) => b[1].fiat - a[1].fiat)
        .map(([name, v]) =>
          `<tr><td>${escapeHtml(name)}</td><td class="num">${v.count}</td>` +
          `<td class="num">${v.sats.toLocaleString("en-US")}</td><td class="num">${v.fiat.toFixed(2)}</td></tr>`)
        .join("\n");

      const notes = [];
      if (unvalued > 0) notes.push(`${unvalued} transaction(s) have no captured exchange rate and are not included in ${fiatCurrency} totals — they need manual valuation (see transactions.csv, blank ${fiatCol}).`);
      if (failedTaxPayments > 0) notes.push(`${failedTaxPayments} payroll payment(s) have a FAILED tax withholding remittance that needs manual follow-up (see payroll.csv, taxPaymentFailed).`);
      notes.push(blinkAvailable
        ? "Income includes wallet-received payments reported by Blink at generation time (most recent 50 wallet transactions only — older months may be incomplete)."
        : "Blink was unreachable during generation — income reflects locally recorded transactions only.");

      const summaryHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Disrupt Portal — ${period} Summary</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #222; max-width: 720px; margin: 40px auto; padding: 0 16px; }
  h1 { font-size: 1.4em; } h2 { font-size: 1.05em; margin-top: 1.6em; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 0.92em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #777; font-size: 0.85em; }
  ul.notes li { font-size: 0.88em; color: #555; margin-bottom: 4px; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>Disrupt Portal — Monthly Report, ${period}</h1>
<p class="muted">Generated ${new Date().toISOString()} · Values in ${fiatCurrency}, converted at the exchange rate captured when each payment was made · ${allTxns.length} transactions</p>

<h2>Overview</h2>
<table>
  <tr><td>Income</td><td class="num">${sumSats(byClass.income).toLocaleString("en-US")} sats</td><td class="num">${sumFiat(byClass.income).toFixed(2)} ${fiatCurrency}</td></tr>
  <tr><td>Expenses (non-payroll)</td><td class="num">${sumSats(byClass.expense).toLocaleString("en-US")} sats</td><td class="num">${sumFiat(byClass.expense).toFixed(2)} ${fiatCurrency}</td></tr>
  <tr><td>Payroll (gross)</td><td class="num">${payrollGrossSats.toLocaleString("en-US")} sats</td><td class="num">—</td></tr>
  <tr><td>Payroll (net paid)</td><td class="num">${sumSats(byClass.payroll).toLocaleString("en-US")} sats</td><td class="num">${sumFiat(byClass.payroll).toFixed(2)} ${fiatCurrency}</td></tr>
  <tr><td>Tax withholding remitted</td><td class="num">${sumSats(byClass.tax).toLocaleString("en-US")} sats</td><td class="num">${sumFiat(byClass.tax).toFixed(2)} ${fiatCurrency}</td></tr>
  <tr><td>Payroll taxes remitted</td><td class="num">${payrollWithheldSats.toLocaleString("en-US")} sats</td><td class="num">—</td></tr>
</table>

<h2>Expenses by category</h2>
<table>
  <tr><th>Category</th><th class="num">Payments</th><th class="num">Sats</th><th class="num">${fiatCurrency}</th></tr>
  ${categoryRows || '<tr><td colspan="4" class="muted">No expenses this period</td></tr>'}
</table>

<h2>Notes for the accountant</h2>
<ul class="notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("\n")}</ul>

<p class="muted">Every Lightning payment in transactions.csv includes its payment hash and preimage — cryptographic proof of payment that can be independently verified.</p>
</body></html>`;

      // ── Stream the ZIP ───────────────────────────────────────────────────────
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="disrupt-report-${period}.zip"`);

      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on("error", (err) => {
        logger.error("Report archive error:", err);
        if (!res.headersSent) res.status(500).json({ success: false, message: "Failed to build report." });
        else res.end();
      });
      archive.pipe(res);

      archive.append(summaryHtml, { name: "summary.html" });
      archive.append(transactionsCsv, { name: "transactions.csv" });
      archive.append(expensesCsv, { name: "expenses.csv" });
      archive.append(incomeCsv, { name: "income.csv" });
      archive.append(payrollCsv, { name: "payroll.csv" });
      archive.append(withholdingsCsv, { name: "withholdings.csv" });

      // Receipts attached to this period's transactions
      for (const t of localTxns) {
        const receipt = receiptById(t.receiptId);
        if (!receipt) continue;
        const filePath = path.join(UPLOAD_DIR, receipt.filename);
        if (!fs.existsSync(filePath)) continue;
        const day = String(t.date).slice(0, 10);
        archive.file(filePath, { name: `receipts/${day}_${receipt.originalName || receipt.filename}` });
      }

      // Tax registration documents for suppliers paid this period
      const paidSupplierIds = [...new Set(
        localTxns.filter((t) => t.recipientType === "supplier" && t.recipientId).map((t) => t.recipientId)
      )];
      for (const supplierId of paidSupplierIds) {
        const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId);
        const doc = receiptById(supplier?.taxDocReceiptId);
        if (!doc) continue;
        const filePath = path.join(UPLOAD_DIR, doc.filename);
        if (!fs.existsSync(filePath)) continue;
        const label = (supplier.company || supplierId).replace(/[^\w.-]+/g, "_");
        archive.file(filePath, { name: `supplier-tax-docs/${label}_${doc.originalName || doc.filename}` });
      }

      auditLog(req.user.email, "report_package_generated", period, { transactions: allTxns.length });
      await archive.finalize();
    } catch (err) {
      logger.error({ err: err.message, period }, "report package failed");
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "Failed to generate report." });
      }
    }
  }
);

module.exports = router;

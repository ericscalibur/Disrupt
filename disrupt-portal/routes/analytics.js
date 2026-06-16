"use strict";

const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticateToken } = require("../middleware/auth");

router.get("/analytics/recipient", authenticateToken, (req, res) => {
  const { recipientId, recipientType } = req.query;
  if (!recipientId || !recipientType) {
    return res.status(400).json({ success: false, message: "recipientId and recipientType required." });
  }

  const rows = db.prepare(`
    SELECT id, date, type, amount, currency, btcUsdRate, note, status, direction, taxWithholding
    FROM transactions
    WHERE recipientId = ? AND direction = 'SENT'
    ORDER BY date DESC
  `).all(recipientId);

  if (!rows.length) {
    return res.json({ success: true, stats: null, byMonth: [], transactions: [] });
  }

  const txns = rows.map((t) => ({
    ...t,
    taxWithholding: t.taxWithholding ? JSON.parse(t.taxWithholding) : null,
  }));

  const successful = txns.filter((t) => !["FAILED", "Failed", "FAILURE"].includes(t.status));
  const amounts = successful.map((t) => Number(t.amount) || 0);
  const totalSats = amounts.reduce((s, a) => s + a, 0);
  const totalUsd = successful.reduce((s, t) => {
    return s + ((Number(t.amount) || 0) / 100_000_000) * (t.btcUsdRate || 0);
  }, 0);
  const taxWithheldSats = txns.reduce((s, t) => s + (t.taxWithholding?.taxAmount || 0), 0);

  // Breakdown by rail, summed in sats (not transaction count)
  const railBreakdown = { lightning: 0, onchain: 0, batch: 0 };
  successful.forEach((t) => {
    const sats = Number(t.amount) || 0;
    if (t.type === "onchain") railBreakdown.onchain += sats;
    else if (t.type === "batch") railBreakdown.batch += sats;
    else railBreakdown.lightning += sats;
  });

  // Group by month
  const monthMap = {};
  successful.forEach((t) => {
    const month = (t.date || "").slice(0, 7);
    if (!month) return;
    if (!monthMap[month]) monthMap[month] = { month, totalSats: 0, totalUsd: 0, count: 0 };
    monthMap[month].totalSats += Number(t.amount) || 0;
    monthMap[month].totalUsd += ((Number(t.amount) || 0) / 100_000_000) * (t.btcUsdRate || 0);
    monthMap[month].count++;
  });
  const byMonth = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

  res.json({
    success: true,
    stats: {
      totalSats,
      totalUsd,
      count: successful.length,
      avgSats: successful.length ? Math.round(totalSats / successful.length) : 0,
      largestSats: amounts.length ? Math.max(...amounts) : 0,
      lastPaymentDate: successful[0]?.date || null,
      taxWithheldSats,
      railBreakdown,
    },
    byMonth,
    transactions: txns.slice(0, 100),
  });
});

module.exports = router;

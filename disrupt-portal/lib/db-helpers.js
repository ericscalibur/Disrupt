"use strict";

const db = require("../db");
const logger = require("../logger");

// Deserialise a transactions row back to the shape the frontend expects
function dbTxnToObj(row) {
  if (!row) return null;
  return {
    ...row,
    taxWithholding: row.taxWithholding ? JSON.parse(row.taxWithholding) : null,
  };
}

// Fiat book value of a sats amount at the captured rate, rounded to cents.
// Computed once at write time and stored on the transaction — reports must
// never re-derive it from a live rate.
function fiatValue(amountSats, btcUsdRate) {
  const sats = Number(amountSats);
  const rate = Number(btcUsdRate);
  if (!Number.isFinite(sats) || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((sats * rate / 100000000) * 100) / 100;
}

// Resolve a client-supplied categoryId to a valid, non-archived category id
// (or null) so foreign-key inserts can never fail on a bad value.
function resolveCategoryId(categoryId) {
  if (!categoryId) return null;
  const row = db
    .prepare("SELECT id FROM categories WHERE id = ? AND archived = 0")
    .get(String(categoryId));
  return row ? row.id : null;
}

// Write an immutable audit log entry
function auditLog(actor, action, target, detail) {
  try {
    db.prepare(
      "INSERT INTO audit_log (ts, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)"
    ).run(new Date().toISOString(), actor, action, target || null, detail ? JSON.stringify(detail) : null);
  } catch (err) {
    logger.error("audit_log write failed:", err.message);
  }
}

function getEmployeeById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(String(id)) || null;
}

function getEmployeeByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) || null;
}

function getSupplierById(id) {
  return db.prepare("SELECT * FROM suppliers WHERE id = ?").get(String(id)) || null;
}

function updateEmployeeById(id, updates) {
  const allowed = ["name", "email", "role", "department", "lightningAddress", "btcAddress", "password"];
  const fields = Object.keys(updates).filter((k) => allowed.includes(k));
  if (fields.length === 0) return getEmployeeById(id);
  const setClause = fields.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE users SET ${setClause} WHERE id = @id`).run({ ...updates, id });
  return getEmployeeById(id);
}

module.exports = {
  dbTxnToObj,
  fiatValue,
  resolveCategoryId,
  auditLog,
  getEmployeeById,
  getEmployeeByEmail,
  getSupplierById,
  updateEmployeeById,
};

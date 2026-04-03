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
  const allowed = ["name", "role", "department", "lightningAddress", "password"];
  const fields = Object.keys(updates).filter((k) => allowed.includes(k));
  if (fields.length === 0) return getEmployeeById(id);
  const setClause = fields.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE users SET ${setClause} WHERE id = @id`).run({ ...updates, id });
  return getEmployeeById(id);
}

module.exports = {
  dbTxnToObj,
  auditLog,
  getEmployeeById,
  getEmployeeByEmail,
  getSupplierById,
  updateEmployeeById,
};

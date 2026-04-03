#!/usr/bin/env node
"use strict";

/**
 * One-shot migration: reads all JSON data files and inserts them into the
 * SQLite database (skipping rows that already exist via INSERT OR IGNORE).
 * Safe to run multiple times.
 */

const fs = require("fs");
const path = require("path");
const db = require("./db");

const DATA_DIR = path.join(__dirname, "data");

function readJson(file, fallback = []) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

// ── Users ────────────────────────────────────────────────────────────────────
const users = readJson(path.join(DATA_DIR, "users.json"));
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users
    (id, name, email, password, role, department, lightningAddress, dateAdded)
  VALUES
    (@id, @name, @email, @password, @role, @department, @lightningAddress, @dateAdded)
`);
const migrateUsers = db.transaction((rows) => {
  for (const u of rows) {
    insertUser.run({
      id: u.id,
      name: u.name,
      email: u.email,
      password: u.password,
      role: u.role,
      department: u.department || null,
      lightningAddress: u.lightningAddress || null,
      dateAdded: u.dateAdded || new Date().toISOString().split("T")[0],
    });
  }
});
migrateUsers(users);
console.log(`✓ Users:        ${users.length}`);

// ── Transactions ─────────────────────────────────────────────────────────────
const transactions = readJson(path.join(DATA_DIR, "transactions.json"));
const insertTxn = db.prepare(`
  INSERT OR IGNORE INTO transactions (
    id, date, type, receiver, lightningAddress, invoice,
    amount, currency, note, direction, status,
    paymentHash, preImage, approvedStatus, approvedAt, approvedBy,
    btcUsdRate, recipientType, recipientId, contact, company,
    taxWithholding, relatedEmployeePayment, taxType
  ) VALUES (
    @id, @date, @type, @receiver, @lightningAddress, @invoice,
    @amount, @currency, @note, @direction, @status,
    @paymentHash, @preImage, @approvedStatus, @approvedAt, @approvedBy,
    @btcUsdRate, @recipientType, @recipientId, @contact, @company,
    @taxWithholding, @relatedEmployeePayment, @taxType
  )
`);
const migrateTxns = db.transaction((rows) => {
  for (const t of rows) {
    insertTxn.run({
      id: String(t.id),
      date: t.date || new Date().toISOString(),
      type: t.type || "lightning",
      receiver: t.receiver || t.contact || null,
      lightningAddress: t.lightningAddress || null,
      invoice: t.invoice || null,
      amount: t.amount || 0,
      currency: t.currency || "SATS",
      note: t.note || "",
      direction: t.direction || "SENT",
      status: t.status || "SUCCESS",
      paymentHash: t.paymentHash || null,
      preImage: t.preImage || null,
      approvedStatus: t.approvedStatus || null,
      approvedAt: t.approvedAt || null,
      approvedBy: t.approvedBy || null,
      btcUsdRate: t.btcUsdRate || null,
      recipientType: t.recipientType || null,
      recipientId: t.recipientId || null,
      contact: t.contact || null,
      company: t.company || null,
      taxWithholding: t.taxWithholding ? JSON.stringify(t.taxWithholding) : null,
      relatedEmployeePayment: t.relatedEmployeePayment || null,
      taxType: t.taxType || null,
    });
  }
});
migrateTxns(transactions);
console.log(`✓ Transactions: ${transactions.length}`);

// ── Drafts ───────────────────────────────────────────────────────────────────
const drafts = readJson(path.join(DATA_DIR, "drafts.json"));
const insertDraft = db.prepare(`
  INSERT OR IGNORE INTO drafts (
    id, title, recipientEmail, company, contact, recipientLightningAddress,
    amount, note, createdBy, department, dateCreated, status,
    approvedAt, approvedBy, declinedAt, declinedBy
  ) VALUES (
    @id, @title, @recipientEmail, @company, @contact, @recipientLightningAddress,
    @amount, @note, @createdBy, @department, @dateCreated, @status,
    @approvedAt, @approvedBy, @declinedAt, @declinedBy
  )
`);
const migrateDrafts = db.transaction((rows) => {
  for (const d of rows) {
    insertDraft.run({
      id: d.id,
      title: d.title || null,
      recipientEmail: d.recipientEmail,
      company: d.company,
      contact: d.contact,
      recipientLightningAddress: d.recipientLightningAddress,
      amount: d.amount,
      note: d.note || "",
      createdBy: d.createdBy,
      department: d.department,
      dateCreated: d.dateCreated,
      status: d.status || "pending",
      approvedAt: d.approvedAt || null,
      approvedBy: d.approvedBy || null,
      declinedAt: d.declinedAt || null,
      declinedBy: d.declinedBy || null,
    });
  }
});
migrateDrafts(drafts);
console.log(`✓ Drafts:       ${drafts.length}`);

// ── Suppliers ────────────────────────────────────────────────────────────────
const suppliers = readJson(path.join(DATA_DIR, "suppliers.json"));
const insertSupplier = db.prepare(`
  INSERT OR IGNORE INTO suppliers
    (id, company, contact, email, lightningAddress, note, createdAt)
  VALUES
    (@id, @company, @contact, @email, @lightningAddress, @note, @createdAt)
`);
const migrateSuppliers = db.transaction((rows) => {
  for (const s of rows) {
    insertSupplier.run({
      id: s.id,
      company: s.company,
      contact: s.contact,
      email: s.email,
      lightningAddress: s.lightningAddress,
      note: s.note || "",
      createdAt: s.createdAt || new Date().toISOString(),
    });
  }
});
migrateSuppliers(suppliers);
console.log(`✓ Suppliers:    ${suppliers.length}`);

// ── Departments ──────────────────────────────────────────────────────────────
const departments = readJson(path.join(DATA_DIR, "departments.json"), []);
const insertDept = db.prepare(`INSERT OR IGNORE INTO departments (name) VALUES (?)`);
const migrateDepts = db.transaction((rows) => {
  for (const name of rows) {
    insertDept.run(name);
  }
});
migrateDepts(departments);
console.log(`✓ Departments:  ${departments.length}`);

console.log("\nMigration complete →", db.name);

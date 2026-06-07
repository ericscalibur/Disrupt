"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DISRUPT_DB_PATH || path.join(__dirname, "data", "disrupt.db");
const db = new Database(DB_PATH);

// WAL mode gives much better concurrent-read performance and crash safety
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000"); // wait up to 5s instead of failing on lock

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password         TEXT NOT NULL,
    role             TEXT NOT NULL,
    department       TEXT,
    lightningAddress TEXT,
    btcAddress       TEXT,
    dateAdded        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id                     TEXT PRIMARY KEY,
    date                   TEXT NOT NULL,
    type                   TEXT NOT NULL,
    receiver               TEXT,
    lightningAddress       TEXT,
    invoice                TEXT,
    amount                 REAL,
    currency               TEXT DEFAULT 'SATS',
    note                   TEXT DEFAULT '',
    direction              TEXT DEFAULT 'SENT',
    status                 TEXT,
    paymentHash            TEXT,
    preImage               TEXT,
    approvedStatus         TEXT,
    approvedAt             TEXT,
    approvedBy             TEXT,
    btcUsdRate             REAL,
    recipientType          TEXT,
    recipientId            TEXT,
    contact                TEXT,
    company                TEXT,
    taxWithholding         TEXT,
    relatedEmployeePayment TEXT,
    taxType                TEXT,
    draftId                TEXT,
    taxPaymentFailed       INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id                      TEXT PRIMARY KEY,
    title                   TEXT,
    recipientEmail          TEXT NOT NULL,
    company                 TEXT NOT NULL,
    contact                 TEXT NOT NULL,
    recipientLightningAddress TEXT NOT NULL,
    amount                  REAL NOT NULL,
    note                    TEXT DEFAULT '',
    createdBy               TEXT NOT NULL,
    department              TEXT NOT NULL,
    dateCreated             TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pending',
    approvedAt              TEXT,
    approvedBy              TEXT,
    declinedAt              TEXT,
    declinedBy              TEXT
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id               TEXT PRIMARY KEY,
    company          TEXT NOT NULL,
    contact          TEXT NOT NULL,
    email            TEXT NOT NULL,
    lightningAddress TEXT,
    btcAddress       TEXT,
    note             TEXT DEFAULT '',
    createdAt        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS departments (
    name TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token     TEXT PRIMARY KEY,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT    NOT NULL,
    actor     TEXT    NOT NULL,
    action    TEXT    NOT NULL,
    target    TEXT,
    detail    TEXT
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    originalName TEXT,
    mimeType     TEXT,
    sizeBytes    INTEGER,
    uploadedBy   TEXT NOT NULL,
    uploadedAt   TEXT NOT NULL
  );
`);

// Non-destructive schema additions for already-existing databases
const existingTxnCols = db.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name);
if (!existingTxnCols.includes("draftId"))          db.exec("ALTER TABLE transactions ADD COLUMN draftId TEXT");
if (!existingTxnCols.includes("taxPaymentFailed")) db.exec("ALTER TABLE transactions ADD COLUMN taxPaymentFailed INTEGER DEFAULT 0");
if (!existingTxnCols.includes("receiptId"))        db.exec("ALTER TABLE transactions ADD COLUMN receiptId TEXT REFERENCES receipts(id)");

const existingDraftCols = db.prepare("PRAGMA table_info(drafts)").all().map((c) => c.name);
if (!existingDraftCols.includes("receiptId")) db.exec("ALTER TABLE drafts ADD COLUMN receiptId TEXT REFERENCES receipts(id)");

const existingUserCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!existingUserCols.includes("btcAddress")) db.exec("ALTER TABLE users ADD COLUMN btcAddress TEXT");

// Suppliers migration: drop NOT NULL on lightningAddress (SQLite requires table recreation) and add btcAddress
const existingSupplierCols = db.prepare("PRAGMA table_info(suppliers)").all();
const supplierLnCol = existingSupplierCols.find((c) => c.name === "lightningAddress");
if (supplierLnCol && supplierLnCol.notnull === 1) {
  db.exec(`
    BEGIN TRANSACTION;
    ALTER TABLE suppliers RENAME TO suppliers_old;
    CREATE TABLE suppliers (
      id               TEXT PRIMARY KEY,
      company          TEXT NOT NULL,
      contact          TEXT NOT NULL,
      email            TEXT NOT NULL,
      lightningAddress TEXT,
      btcAddress       TEXT,
      note             TEXT DEFAULT '',
      createdAt        TEXT NOT NULL
    );
    INSERT INTO suppliers (id, company, contact, email, lightningAddress, note, createdAt)
      SELECT id, company, contact, email, lightningAddress, note, createdAt FROM suppliers_old;
    DROP TABLE suppliers_old;
    COMMIT;
  `);
} else if (!existingSupplierCols.find((c) => c.name === "btcAddress")) {
  db.exec("ALTER TABLE suppliers ADD COLUMN btcAddress TEXT");
}

module.exports = db;

# SQLite Migration Plan

A reference document for migrating Disrupt Portal's flat-file JSON storage to SQLite using `better-sqlite3`.

---

## Why Migrate?

Currently all data lives in JSON files on disk (`users.json`, `transactions.json`, `suppliers.json`, `drafts.json`, `departments.json`). Every read/write loads or rewrites the **entire file**. This works for a small team but has real problems:

| Problem | Detail |
|---|---|
| **Race conditions** | Two simultaneous requests both read the old file, make their change, and whoever writes last overwrites the other's data |
| **Performance** | Even reading one record loads the full file into memory and parses it |
| **No querying** | Filtering requires loading everything into JS and using `.filter()` |
| **Crash risk** | A server crash mid-write can corrupt or truncate a JSON file |
| **Sessions lost on restart** | `refreshTokensStore = new Set()` lives in RAM — all users get logged out when the server restarts |

---

## Target Stack

- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** — synchronous, fast, zero-config
- Single `disrupt.db` file replaces the entire `data/` directory
- WAL (Write-Ahead Log) mode enabled for crash safety and concurrent reads

---

## Step 1 — Install Dependency

```bash
npm install better-sqlite3
```

---

## Step 2 — Create `disrupt-portal/db.js`

This module initialises the database, creates all tables on first run, and is imported wherever `server.js` needs data access.

```js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data/disrupt.db'));

// Enable WAL mode — faster writes, crash-safe
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    email             TEXT NOT NULL UNIQUE,
    password          TEXT NOT NULL,
    role              TEXT NOT NULL,
    department        TEXT,
    lightning_address TEXT,
    date_added        TEXT
  );

  CREATE TABLE IF NOT EXISTS departments (
    name TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id                TEXT PRIMARY KEY,
    company           TEXT NOT NULL,
    contact           TEXT,
    email             TEXT,
    lightning_address TEXT,
    note              TEXT,
    created_at        TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id                       TEXT PRIMARY KEY,
    date                     TEXT,
    type                     TEXT,
    recipient_type           TEXT,
    recipient_id             TEXT,
    receiver                 TEXT,
    contact                  TEXT,
    company                  TEXT,
    lightning_address        TEXT,
    invoice                  TEXT,
    amount                   INTEGER,
    currency                 TEXT DEFAULT 'SATS',
    note                     TEXT,
    direction                TEXT,
    status                   TEXT,
    payment_hash             TEXT,
    approved_status          TEXT,
    approved_at              TEXT,
    approved_by              TEXT,
    related_employee_payment TEXT,
    tax_type                 TEXT,
    tax_original_amount      INTEGER,
    tax_amount               INTEGER,
    tax_net_amount           INTEGER
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id                          TEXT PRIMARY KEY,
    title                       TEXT,
    recipient_email             TEXT,
    company                     TEXT,
    contact                     TEXT,
    recipient_lightning_address TEXT,
    amount                      INTEGER,
    note                        TEXT,
    created_by                  TEXT,
    department                  TEXT,
    date_created                TEXT,
    status                      TEXT DEFAULT 'pending',
    approved_at                 TEXT,
    approved_by                 TEXT
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token      TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;
```

---

## Step 3 — One-Time Migration Script

Create `migrate.js` in the project root. Run it **once** to seed the SQLite DB from the existing JSON files. Delete it afterwards.

```js
const db = require('./disrupt-portal/db');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'disrupt-portal/data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

// ── Users ────────────────────────────────────────────────────────────────────
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users
  (id, name, email, password, role, department, lightning_address, date_added)
  VALUES (@id, @name, @email, @password, @role, @department, @lightning_address, @date_added)
`);
for (const u of read('users.json')) {
  insertUser.run({
    ...u,
    lightning_address: u.lightningAddress ?? null,
    date_added: u.dateAdded ?? null,
  });
}
console.log('✓ users');

// ── Departments ───────────────────────────────────────────────────────────────
const insertDept = db.prepare(`INSERT OR IGNORE INTO departments (name) VALUES (?)`);
for (const d of read('departments.json')) insertDept.run(d);
console.log('✓ departments');

// ── Suppliers ─────────────────────────────────────────────────────────────────
const insertSupplier = db.prepare(`
  INSERT OR IGNORE INTO suppliers
  (id, company, contact, email, lightning_address, note, created_at)
  VALUES (@id, @company, @contact, @email, @lightning_address, @note, @created_at)
`);
for (const s of read('suppliers.json')) {
  insertSupplier.run({
    ...s,
    lightning_address: s.lightningAddress ?? null,
    created_at: s.createdAt ?? null,
  });
}
console.log('✓ suppliers');

// ── Transactions ──────────────────────────────────────────────────────────────
const insertTxn = db.prepare(`
  INSERT OR IGNORE INTO transactions
  (id, date, type, recipient_type, recipient_id, receiver, contact, company,
   lightning_address, invoice, amount, currency, note, direction, status,
   payment_hash, approved_status, approved_at, approved_by,
   related_employee_payment, tax_original_amount, tax_amount, tax_net_amount)
  VALUES
  (@id, @date, @type, @recipient_type, @recipient_id, @receiver, @contact, @company,
   @lightning_address, @invoice, @amount, @currency, @note, @direction, @status,
   @payment_hash, @approved_status, @approved_at, @approved_by,
   @related_employee_payment, @tax_original_amount, @tax_amount, @tax_net_amount)
`);
for (const t of read('transactions.json')) {
  insertTxn.run({
    ...t,
    recipient_type:            t.recipientType ?? null,
    recipient_id:              t.recipientId ?? null,
    lightning_address:         t.lightningAddress ?? null,
    payment_hash:              t.paymentHash ?? null,
    approved_status:           t.approvedStatus ?? null,
    approved_at:               t.approvedAt ?? null,
    approved_by:               t.approvedBy ?? null,
    related_employee_payment:  t.relatedEmployeePayment ?? null,
    tax_original_amount:       t.taxWithholding?.originalAmount ?? null,
    tax_amount:                t.taxWithholding?.taxAmount ?? null,
    tax_net_amount:            t.taxWithholding?.netAmount ?? null,
  });
}
console.log('✓ transactions');

// ── Drafts ────────────────────────────────────────────────────────────────────
const insertDraft = db.prepare(`
  INSERT OR IGNORE INTO drafts
  (id, title, recipient_email, company, contact, recipient_lightning_address,
   amount, note, created_by, department, date_created, status, approved_at, approved_by)
  VALUES
  (@id, @title, @recipient_email, @company, @contact, @recipient_lightning_address,
   @amount, @note, @created_by, @department, @date_created, @status, @approved_at, @approved_by)
`);
for (const d of read('drafts.json')) {
  insertDraft.run({
    ...d,
    recipient_email:             d.recipientEmail ?? null,
    recipient_lightning_address: d.recipientLightningAddress ?? null,
    created_by:                  d.createdBy ?? null,
    date_created:                d.dateCreated ?? null,
    approved_at:                 d.approvedAt ?? null,
    approved_by:                 d.approvedBy ?? null,
  });
}
console.log('✓ drafts');

console.log('\nMigration complete ✓  →  disrupt-portal/data/disrupt.db');
```

Run it:

```bash
node migrate.js
```

---

## Step 4 — Swap File I/O in `server.js`

This is the bulk of the work. Every `fs.readFile` / `fs.writeFile` block gets replaced with a single DB statement. The pattern is very repetitive so it moves fast. Add `const db = require('./db');` at the top of `server.js` and remove all the `DATA_DIR` / `*_FILE` path constants.

### Reading a single record

```js
// BEFORE
const data = await fs.readFile(USERS_FILE, 'utf8');
const users = JSON.parse(data);
const user = users.find(u => u.email === email);

// AFTER
const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
```

### Reading all records

```js
// BEFORE
const data = await fs.readFile(USERS_FILE, 'utf8');
const users = JSON.parse(data);

// AFTER
const users = db.prepare('SELECT * FROM users').all();
```

### Inserting a record

```js
// BEFORE
const data = await fs.readFile(USERS_FILE, 'utf8');
const users = JSON.parse(data);
users.push(newUser);
await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));

// AFTER
db.prepare(`
  INSERT INTO users (id, name, email, password, role, department, lightning_address, date_added)
  VALUES (@id, @name, @email, @password, @role, @department, @lightning_address, @date_added)
`).run(newUser);
```

### Updating a record

```js
// BEFORE
const data = await fs.readFile(USERS_FILE, 'utf8');
const users = JSON.parse(data);
const index = users.findIndex(u => u.id === id);
users[index] = { ...users[index], ...updates };
await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));

// AFTER
db.prepare(`
  UPDATE users SET name = @name, role = @role, department = @department,
  lightning_address = @lightning_address WHERE id = @id
`).run({ ...updates, id });
```

### Deleting a record

```js
// BEFORE
const data = await fs.readFile(USERS_FILE, 'utf8');
const users = JSON.parse(data);
const remaining = users.filter(u => u.id !== id);
await fs.writeFile(USERS_FILE, JSON.stringify(remaining, null, 2));

// AFTER
db.prepare('DELETE FROM users WHERE id = ?').run(id);
```

### Refresh tokens

```js
// BEFORE — in-memory Set, lost on restart
refreshTokensStore.add(token);
refreshTokensStore.has(token);
refreshTokensStore.delete(token);

// AFTER — persisted in DB
db.prepare('INSERT INTO refresh_tokens (token) VALUES (?)').run(token);
db.prepare('SELECT 1 FROM refresh_tokens WHERE token = ?').get(token);
db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(token);
```

### Transactions (append-only, never rewrite history)

```js
// AFTER — just insert, no need to read first
db.prepare(`
  INSERT INTO transactions
  (id, date, type, receiver, amount, currency, note, direction, status, payment_hash, ...)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ...)
`).run(id, date, type, receiver, amount, currency, note, direction, status, paymentHash, ...);
```

---

## Step 5 — Map DB rows back to the API shape

The frontend expects camelCase keys (e.g. `lightningAddress`, `recipientType`). Add a small mapper so existing API responses don't change:

```js
function mapTransaction(row) {
  if (!row) return null;
  return {
    ...row,
    lightningAddress:       row.lightning_address,
    recipientType:          row.recipient_type,
    recipientId:            row.recipient_id,
    paymentHash:            row.payment_hash,
    approvedStatus:         row.approved_status,
    approvedAt:             row.approved_at,
    approvedBy:             row.approved_by,
    relatedEmployeePayment: row.related_employee_payment,
    taxWithholding: row.tax_original_amount ? {
      originalAmount: row.tax_original_amount,
      taxAmount:      row.tax_amount,
      netAmount:      row.tax_net_amount,
    } : null,
  };
}

// Usage
const txns = db.prepare('SELECT * FROM transactions ORDER BY date DESC').all();
res.json({ success: true, transactions: txns.map(mapTransaction) });
```

Write similar mappers for `mapUser`, `mapSupplier`, `mapDraft` as needed.

---

## What You Gain

| Problem | Before | After |
|---|---|---|
| Concurrent writes | Race condition, possible data loss | SQLite row-level locking |
| Read one record | Load & parse entire file | `SELECT WHERE id = ?` |
| Sessions survive restart | ❌ Lost on restart | ✅ Stored in `refresh_tokens` table |
| Crash safety | File can be corrupted mid-write | WAL mode prevents corruption |
| Filter / sort / paginate | JS `.filter()` on full in-memory array | SQL `WHERE`, `ORDER BY`, `LIMIT` |
| Backup | Copy 5 JSON files | Copy one `disrupt.db` file |

---

## Effort Estimate

| Task | Estimated Time |
|---|---|
| Write `db.js` schema | 30 min |
| Write & run migration script | 30 min |
| Swap file I/O in `server.js` | 3–5 hours (repetitive but mechanical) |
| Testing all routes | 1–2 hours |
| **Total** | **~1 day** |

---

## Notes

- Keep the JSON files around as a backup until the migration is fully tested
- `better-sqlite3` is synchronous — no need to change `async/await` patterns in routes, just remove the `await` on DB calls
- If the app ever needs to scale beyond a single server, the next step up would be **PostgreSQL** with the `pg` package — the table schema above would transfer almost unchanged
- Add `disrupt-portal/data/disrupt.db` to `.gitignore` (same as the JSON data files)
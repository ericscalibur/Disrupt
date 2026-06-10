#!/usr/bin/env node
/**
 * StartOS admin bootstrap for Disrupt.
 *
 * Replaces the interactive `npm run setup` wizard: if the database has no
 * users, create the Admin account from env vars (set via the Config tab).
 * Idempotent — exits without changes if any user already exists.
 *
 * Mirrors setup.js exactly: same id derivation, bcryptjs hash, role
 * "Admin", department "Executive", dateAdded YYYY-MM-DD.
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

// Uses the app's own connection — DISRUPT_DB_PATH is honored by db.js
const db = require("/app/disrupt-portal/db.js");

const name = process.env.ADMIN_NAME || "Admin";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const department = "Executive";

if (!email || !password) {
  console.log("create-admin: ADMIN_EMAIL/ADMIN_PASSWORD not set, skipping");
  process.exit(0);
}

const existing = db.prepare("SELECT COUNT(*) AS n FROM users").get();
if (existing.n > 0) {
  console.log("create-admin: users exist, nothing to do");
  process.exit(0);
}

const id = crypto
  .createHash("sha256")
  .update(`${name}|${email}|Admin|${department}`)
  .digest("hex");

db.prepare("INSERT OR IGNORE INTO departments (name) VALUES (?)").run(department);

db.prepare(`
  INSERT INTO users (id, name, email, password, role, department, lightningAddress, btcAddress, dateAdded)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  id,
  name,
  email,
  bcrypt.hashSync(password, 10),
  "Admin",
  department,
  "",
  "",
  new Date().toISOString().split("T")[0]
);

console.log(`create-admin: Admin account created for ${email}`);

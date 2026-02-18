#!/usr/bin/env node

/**
 * Disrupt Portal — First-Time Setup
 * Collects admin credentials and initializes all data files.
 * Run with: node setup.js  (or via: npm run setup)
 */

const readline = require("readline");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "disrupt-portal", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");
const DRAFTS_FILE = path.join(DATA_DIR, "drafts.json");
const SUPPLIERS_FILE = path.join(DATA_DIR, "suppliers.json");
const DEPARTMENTS_FILE = path.join(DATA_DIR, "departments.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askHidden(question) {
  // Fallback for non-TTY environments (e.g. piped input, CI)
  if (!process.stdin.isTTY) {
    return ask(question);
  }

  return new Promise((resolve) => {
    // Write the prompt manually so we can suppress echo
    process.stdout.write(question);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let input = "";

    const onData = (ch) => {
      if (ch === "\n" || ch === "\r" || ch === "\u0003") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        if (ch === "\u0003") process.exit(); // Ctrl+C
        resolve(input);
      } else if (ch === "\u007f" || ch === "\b") {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        input += ch;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function printLine() {
  console.log("─".repeat(50));
}

function printBanner() {
  console.log("");
  console.log("  ⚡ DISRUPT PORTAL — First-Time Setup");
  printLine();
  console.log("  This wizard will create your Admin account");
  console.log("  and initialize your data files.");
  printLine();
  console.log("");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  // Check if users.json already has users
  if (fs.existsSync(USERS_FILE)) {
    const raw = fs.readFileSync(USERS_FILE, "utf8").trim();
    let existing = [];
    try {
      existing = raw === "" ? [] : JSON.parse(raw);
    } catch {
      existing = [];
    }

    if (Array.isArray(existing) && existing.length > 0) {
      console.log("⚠️  A users.json file with existing users was detected.");
      console.log("");
      const confirm = await ask(
        "  Running setup will REPLACE all data files with fresh ones.\n" +
          "  Type YES to continue, or press Enter to cancel: ",
      );
      if (confirm !== "YES") {
        console.log("");
        console.log("  Setup cancelled. No files were changed.");
        console.log("");
        rl.close();
        process.exit(0);
      }
      console.log("");
    }
  }

  // ── Collect admin name ────────────────────────────────────────────────────

  let name = "";
  while (!name) {
    name = await ask("  Full name:       ");
    if (!name) console.log("  ⚠  Name cannot be empty.\n");
  }

  // ── Collect admin email ───────────────────────────────────────────────────

  let email = "";
  while (!isValidEmail(email)) {
    email = await ask("  Email:           ");
    if (!isValidEmail(email))
      console.log("  ⚠  Enter a valid email address.\n");
  }

  // ── Collect password ──────────────────────────────────────────────────────

  let password = "";
  while (true) {
    password = await askHidden("  Password:        ");
    if (password.length < 4) {
      console.log("  ⚠  Password must be at least 4 characters.\n");
      continue;
    }
    const confirm = await askHidden("  Confirm password: ");
    if (password !== confirm) {
      console.log("  ⚠  Passwords do not match. Try again.\n");
      continue;
    }
    break;
  }

  // ── Collect lightning address (optional) ──────────────────────────────────

  const lightningAddress = await ask(
    "  Lightning address (optional, press Enter to skip): ",
  );

  // ── Collect department ────────────────────────────────────────────────────

  let department = await ask("  Department       (default: Executive): ");
  if (!department) department = "Executive";

  // ── Confirm ───────────────────────────────────────────────────────────────

  console.log("");
  printLine();
  console.log("  Please confirm your details:");
  console.log("");
  console.log(`  Name:              ${name}`);
  console.log(`  Email:             ${email}`);
  console.log(`  Password:          ${"*".repeat(password.length)}`);
  console.log(`  Lightning address: ${lightningAddress || "(none)"}`);
  console.log(`  Department:        ${department}`);
  console.log(`  Role:              Admin`);
  console.log("");

  const go = await ask("  Look good? Type YES to create your account: ");
  if (go !== "YES") {
    console.log("");
    console.log("  Setup cancelled. No files were changed.");
    console.log("");
    rl.close();
    process.exit(0);
  }

  rl.close();

  // ── Build user object ─────────────────────────────────────────────────────

  const id = crypto
    .createHash("sha256")
    .update(`${name}|${email}|Admin|${department}|${lightningAddress}`)
    .digest("hex");

  const adminUser = {
    id,
    name,
    email,
    password,
    role: "Admin",
    department,
    lightningAddress: lightningAddress || "",
    dateAdded: new Date().toISOString().split("T")[0],
  };

  // ── Initialize data directory and files ───────────────────────────────────

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const departments = [department];
  // Always include Executive if user chose something else
  if (department !== "Executive") departments.push("Executive");

  fs.writeFileSync(USERS_FILE, JSON.stringify([adminUser], null, 2));
  fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify([], null, 2));
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify([], null, 2));
  fs.writeFileSync(SUPPLIERS_FILE, JSON.stringify([], null, 2));
  fs.writeFileSync(DEPARTMENTS_FILE, JSON.stringify(departments, null, 2));

  // ── Done ──────────────────────────────────────────────────────────────────

  console.log("");
  printLine();
  console.log("  ✅  Setup complete!");
  console.log("");
  console.log("  Data files initialized:");
  console.log(`    • ${path.relative(process.cwd(), USERS_FILE)}`);
  console.log(`    • ${path.relative(process.cwd(), TRANSACTIONS_FILE)}`);
  console.log(`    • ${path.relative(process.cwd(), DRAFTS_FILE)}`);
  console.log(`    • ${path.relative(process.cwd(), SUPPLIERS_FILE)}`);
  console.log(`    • ${path.relative(process.cwd(), DEPARTMENTS_FILE)}`);
  console.log("");
  console.log("  Next steps:");
  console.log("    1. Add your BLINK_API_KEY to .env");
  console.log("    2. Run: npm start");
  console.log(`    3. Login at http://localhost:3000`);
  console.log(`       Email:    ${email}`);
  console.log(`       Password: ${"*".repeat(password.length)}`);
  console.log("");
  printLine();
  console.log("");
}

main().catch((err) => {
  console.error("\n  ❌ Setup failed:", err.message);
  rl.close();
  process.exit(1);
});

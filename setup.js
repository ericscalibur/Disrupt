#!/usr/bin/env node

/**
 * Disrupt Portal — First-Time Setup
 * Collects admin credentials, generates JWT secrets, collects Blink API key, and initializes all data files.
 * Run with: node setup.js  (or via: npm run setup)
 */

const readline = require("readline");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const ENV_FILE = path.join(ROOT_DIR, ".env");
const ENV_EXAMPLE_FILE = path.join(ROOT_DIR, ".env.example");
const DATA_DIR = path.join(ROOT_DIR, "disrupt-portal", "data");
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
  console.log("  This wizard will:");
  console.log("    1. Create your Admin account");
  console.log("    2. Generate JWT secrets and write them to .env");
  console.log("    3. Add your Blink API key to .env");
  console.log("    4. Initialize all data files");
  printLine();
  console.log("");
}

// ── JWT / .env helpers ────────────────────────────────────────────────────────

function generateSecret() {
  return crypto.randomBytes(64).toString("hex");
}

function writeEnvValues({ blinkApiKey }) {
  const accessSecret = generateSecret();
  const refreshSecret = generateSecret();

  // Create .env from .env.example if it doesn't exist yet
  if (!fs.existsSync(ENV_FILE)) {
    if (fs.existsSync(ENV_EXAMPLE_FILE)) {
      fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
    } else {
      // Minimal fallback if .env.example is also missing
      fs.writeFileSync(
        ENV_FILE,
        [
          "ACCESS_TOKEN_SECRET=your-64-character-hex-string-here",
          "REFRESH_TOKEN_SECRET=your-different-64-character-hex-string-here",
          "BLINK_API_KEY=your-blink-api-key-here",
          "TAX_LIGHTNING_ADDRESS=example@blink.sv",
          "PORT=3000",
          "NODE_ENV=development",
        ].join("\n") + "\n",
      );
    }
  }

  let env = fs.readFileSync(ENV_FILE, "utf8");

  // Replace whatever is currently set for these two keys
  env = env.replace(
    /^ACCESS_TOKEN_SECRET=.*$/m,
    `ACCESS_TOKEN_SECRET=${accessSecret}`,
  );
  env = env.replace(
    /^REFRESH_TOKEN_SECRET=.*$/m,
    `REFRESH_TOKEN_SECRET=${refreshSecret}`,
  );

  // If lines didn't exist at all, append them
  if (!/^ACCESS_TOKEN_SECRET=/m.test(env)) {
    env += `\nACCESS_TOKEN_SECRET=${accessSecret}`;
  }
  if (!/^REFRESH_TOKEN_SECRET=/m.test(env)) {
    env += `\nREFRESH_TOKEN_SECRET=${refreshSecret}`;
  }

  // Replace BLINK_API_KEY
  env = env.replace(/^BLINK_API_KEY=.*$/m, `BLINK_API_KEY=${blinkApiKey}`);
  if (!/^BLINK_API_KEY=/m.test(env)) {
    env += `\nBLINK_API_KEY=${blinkApiKey}`;
  }

  fs.writeFileSync(ENV_FILE, env);
  return { accessSecret, refreshSecret };
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

  // ── Collect admin details ─────────────────────────────────────────────────
  console.log("  The account you create here will be the Admin.");
  console.log("  Your department will be set to Accounting.");
  console.log(
    "  Additional team members and departments can be added later from inside the portal.",
  );
  console.log("");

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

  // ── Collect Blink API key ─────────────────────────────────────────────────

  console.log("");
  console.log("  Your Blink API key can be found at https://blink.sv");
  const blinkApiKey = await askHidden(
    "  Blink API key    (optional, press Enter to skip): ",
  );

  const department = "Accounting";

  // ── Confirm ───────────────────────────────────────────────────────────────

  console.log("");
  printLine();
  console.log("  Please confirm your details:");
  console.log("");
  console.log(`  Name:              ${name}`);
  console.log(`  Email:             ${email}`);
  console.log(`  Password:          ${"*".repeat(password.length)}`);
  console.log(`  Lightning address: ${lightningAddress || "(none)"}`);
  console.log(
    `  Blink API key:     ${blinkApiKey ? blinkApiKey.slice(0, 6) + "..." : "(none — add to .env later)"}`,
  );
  console.log(
    `  Department:        Accounting  ← fixed, cannot be changed here`,
  );
  console.log(`  Role:              Admin  ← fixed, cannot be changed here`);
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

  // ── Generate JWT secrets and write to .env ────────────────────────────────

  console.log("");
  console.log("  🔐 Generating JWT secrets and writing .env...");
  const { accessSecret, refreshSecret } = writeEnvValues({ blinkApiKey });
  console.log("  ✅  .env updated");

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

  const departments = ["Accounting"];

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
  console.log("  Admin account created:");
  console.log(`    • Name:   ${name}`);
  console.log(`    • Email:  ${email}`);
  console.log(`    • Role:   Admin`);
  console.log("");
  console.log("  .env updated:");
  console.log(`    • ACCESS_TOKEN_SECRET  = ${accessSecret.slice(0, 12)}...`);
  console.log(`    • REFRESH_TOKEN_SECRET = ${refreshSecret.slice(0, 12)}...`);
  console.log(
    `    • BLINK_API_KEY        = ${blinkApiKey ? blinkApiKey.slice(0, 6) + "..." : "(not set — add manually)"}`,
  );
  console.log("");
  console.log("  Data files initialized:");
  console.log(`    • ${path.relative(process.cwd(), USERS_FILE)}`);
  console.log(`    • ${path.relative(process.cwd(), TRANSACTIONS_FILE)}`);
  console.log(`    • ${path.relative(process.cwd(), DRAFTS_FILE)}`);
  console.log(`    • ${path.relative(process.cwd(), SUPPLIERS_FILE)}`);
  console.log(`    • ${path.relative(process.cwd(), DEPARTMENTS_FILE)}`);
  console.log("");
  console.log("  Next steps:");
  if (!blinkApiKey) {
    console.log("    1. Add your BLINK_API_KEY to .env");
    console.log("    2. Optionally set TAX_LIGHTNING_ADDRESS in .env");
    console.log("    3. Run: npm start");
  } else {
    console.log("    1. Optionally set TAX_LIGHTNING_ADDRESS in .env");
    console.log("    2. Run: npm start");
  }
  console.log(`    4. Login at http://localhost:3000`);
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

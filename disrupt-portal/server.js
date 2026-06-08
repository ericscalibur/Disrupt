"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const express = require("express");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");

const db = require("./db");
const logger = require("./logger");
const { getBlinkTransactions } = require("./lib/blink");

const app = express();

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
if (!ACCESS_TOKEN_SECRET) {
  throw new Error("ACCESS_TOKEN_SECRET environment variable is not defined");
}

const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
if (!REFRESH_TOKEN_SECRET) {
  throw new Error("REFRESH_TOKEN_SECRET environment variable is not defined");
}

const PORT = process.env.PORT || 3000;

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
      ],
      scriptSrcElem: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://use.fontawesome.com",
      ],
      fontSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://use.fontawesome.com",
      ],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: [
        "'self'",
        "https://api.coingecko.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
      ],
    },
  }),
);

app.use(cookieParser());
app.use(express.json());
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin only in development (Postman, curl, etc.)
      if (!origin) {
        if (process.env.NODE_ENV !== "production") return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
      }

      // Allow localhost on any port for development
      if (origin.match(/^http:\/\/localhost:\d+$/)) {
        return callback(null, true);
      }

      // Allow specific origins
      const allowedOrigins = ["http://localhost:5500"];
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.static(path.join(__dirname, "public")));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "debug";
    logger[level]({ method: req.method, url: req.url, status: res.statusCode, ms }, "request");
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", require("./routes/auth"));
app.use("/api", require("./routes/users"));
app.use("/api", require("./routes/departments"));
app.use("/api", require("./routes/drafts"));
app.use("/api", require("./routes/payments"));
app.use("/api", require("./routes/suppliers"));
app.use("/api", require("./routes/receipts"));
app.use("/api", require("./routes/analytics"));

// Health check (no auth required — used by uptime monitors / load balancers)
app.get("/healthz", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// API 404 catch-all
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res
      .status(404)
      .json({ success: false, message: "API endpoint not found" });
  }
  next();
});

// Serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Startup ───────────────────────────────────────────────────────────────────

// Migrate any plaintext passwords to bcrypt hashes on startup
async function migratePasswords() {
  try {
    const users = db.prepare("SELECT id, password FROM users").all();
    for (const user of users) {
      if (user.password && !user.password.startsWith("$2")) {
        const hashed = await bcrypt.hash(user.password, 10);
        db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, user.id);
      }
    }
  } catch (err) {
    logger.error("Password migration error:", err.message);
  }
}

// ── On-chain confirmation polling ─────────────────────────────────────────────
let pollingActive = false;
async function pollOnchainConfirmations() {
  if (pollingActive) return;
  const pending = db.prepare(
    "SELECT id FROM transactions WHERE type = 'onchain' AND status = 'PENDING'"
  ).all();
  if (pending.length === 0) return;

  pollingActive = true;
  try {
    const blinkTxns = await getBlinkTransactions();
    const blinkById = new Map(blinkTxns.map((t) => [t.id, t]));
    for (const { id } of pending) {
      const blinkTxn = blinkById.get(id);
      if (blinkTxn && blinkTxn.status === "SUCCESS") {
        db.prepare("UPDATE transactions SET status = 'SUCCESS' WHERE id = ?").run(id);
        logger.info({ id }, "onchain transaction confirmed");
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, "onchain poll: failed to fetch Blink transactions");
  } finally {
    pollingActive = false;
  }
}

// Start server
async function startServer() {
  // Reset any drafts stuck in 'processing' from a previous crash
  const stuck = db.prepare(
    "UPDATE drafts SET status = 'pending' WHERE status = 'processing'"
  ).run();
  if (stuck.changes > 0) {
    logger.info({ count: stuck.changes }, "startup: reset stuck drafts from processing → pending");
  }

  await migratePasswords();
  app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV || "development" }, "server started");
  });

  // Poll for on-chain confirmations on startup, then every 5 minutes
  pollOnchainConfirmations();
  setInterval(pollOnchainConfirmations, 5 * 60 * 1000);
}

if (require.main === module) {
  startServer();
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, "unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err: err.message, stack: err.stack }, "uncaught exception — shutting down");
  process.exit(1);
});

module.exports = { app };

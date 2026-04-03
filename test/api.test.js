"use strict";

/**
 * Integration tests for the Disrupt Portal API.
 *
 * All tests run against an in-memory SQLite database seeded with known
 * fixtures, so no real files are touched and no Blink API calls are made.
 */

// ── Environment must be set before any require() loads db.js or server.js ────
process.env.DISRUPT_DB_PATH      = ":memory:";
process.env.ACCESS_TOKEN_SECRET  = "test-access-secret-at-least-32-chars!!";
process.env.REFRESH_TOKEN_SECRET = "test-refresh-secret-at-least-32-chars!";
process.env.BLINK_API_KEY        = "test-key";
process.env.NODE_ENV             = "test";

const { describe, it, before } = require("node:test");
const assert  = require("node:assert/strict");
const request = require("supertest");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");

const { app } = require("../disrupt-portal/server");
const db      = require("../disrupt-portal/db");

// ── Seed helpers ──────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = "AdminPass1!";
const EMPLOYEE_PASSWORD = "EmpPass1!";

async function seedUsers() {
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 1); // rounds=1 for speed
  const empHash   = await bcrypt.hash(EMPLOYEE_PASSWORD, 1);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, department, lightningAddress, dateAdded)
    VALUES
      ('admin-1',    'Test Admin',    'admin@test.com',    ?, 'Admin',    'Engineering', 'admin@getalby.com',    '2024-01-01'),
      ('employee-1', 'Test Employee', 'employee@test.com', ?, 'Employee', 'Engineering', 'emp@getalby.com',       '2024-01-01'),
      ('manager-1',  'Test Manager',  'manager@test.com',  ?, 'Manager',  'Engineering', 'manager@getalby.com',  '2024-01-01')
  `).run(adminHash, empHash, adminHash);
}

function seedDraft(status = "pending") {
  const id = `draft-test-${Date.now()}`;
  db.prepare(`
    INSERT INTO drafts
      (id, title, recipientEmail, company, contact, recipientLightningAddress,
       amount, note, createdBy, department, dateCreated, status)
    VALUES
      (?, 'Test Payment', 'vendor@test.com', 'ACME Corp', 'John Doe', 'vendor@getalby.com',
       1000, 'Test note', 'admin@test.com', 'Engineering', '2024-01-01T00:00:00.000Z', ?)
  `).run(id, status);
  return id;
}

function makeToken(payload) {
  return jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
}

const adminToken    = () => makeToken({ id: "admin-1",    email: "admin@test.com",    role: "Admin",    department: "Engineering" });
const managerToken  = () => makeToken({ id: "manager-1",  email: "manager@test.com",  role: "Manager",  department: "Engineering" });
const employeeToken = () => makeToken({ id: "employee-1", email: "employee@test.com", role: "Employee", department: "Engineering" });

// ── Setup ─────────────────────────────────────────────────────────────────────

before(async () => {
  await seedUsers();
});

// ── /healthz ──────────────────────────────────────────────────────────────────

describe("GET /healthz", () => {
  it("returns 200 and status ok without authentication", async () => {
    const res = await request(app).get("/healthz");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.ok(typeof res.body.ts === "string");
  });
});

// ── /api/login ────────────────────────────────────────────────────────────────

describe("POST /api/login", () => {
  it("returns accessToken on valid credentials", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ email: "admin@test.com", password: ADMIN_PASSWORD });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.accessToken === "string");
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ email: "admin@test.com", password: "wrongpassword" });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  it("returns 401 for unknown email", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ email: "nobody@test.com", password: "anything" });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  it("returns 400 when body fields are missing", async () => {
    const res = await request(app).post("/api/login").send({ email: "admin@test.com" });
    assert.equal(res.status, 400);
  });
});

// ── /api/me ───────────────────────────────────────────────────────────────────

describe("GET /api/me", () => {
  it("returns user info for authenticated request", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${adminToken()}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, "admin@test.com");
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/me");
    assert.equal(res.status, 401);
  });
});

// ── Role authorization ────────────────────────────────────────────────────────

describe("Role authorization", () => {
  it("Employee cannot POST to /api/users (Admin/Manager only)", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${employeeToken()}`)
      .send({ email: "new@test.com", name: "New User", role: "Employee" });
    assert.equal(res.status, 403);
  });

  it("Admin can GET /api/users", async () => {
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${adminToken()}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it("Employee cannot approve a draft", async () => {
    const draftId = seedDraft("pending");
    const res = await request(app)
      .post("/api/drafts/approve")
      .set("Authorization", `Bearer ${employeeToken()}`)
      .send({ draftId });
    assert.equal(res.status, 403);
  });
});

// ── Draft approval idempotency ────────────────────────────────────────────────

describe("Draft approval idempotency", () => {
  it("returns 409 when draft is already approved", async () => {
    const draftId = seedDraft("approved");
    const res = await request(app)
      .post("/api/drafts/approve")
      .set("Authorization", `Bearer ${managerToken()}`)
      .send({ draftId });
    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
  });

  it("returns 409 when draft is already declined", async () => {
    const draftId = seedDraft("declined");
    const res = await request(app)
      .post("/api/drafts/approve")
      .set("Authorization", `Bearer ${managerToken()}`)
      .send({ draftId });
    assert.equal(res.status, 409);
  });

  it("returns 404 for a non-existent draft", async () => {
    const res = await request(app)
      .post("/api/drafts/approve")
      .set("Authorization", `Bearer ${managerToken()}`)
      .send({ draftId: "draft-does-not-exist" });
    assert.equal(res.status, 404);
  });
});

// ── Draft creation ────────────────────────────────────────────────────────────

describe("POST /api/drafts", () => {
  it("creates a draft for authenticated user", async () => {
    const res = await request(app)
      .post("/api/drafts")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({
        recipientEmail: "vendor@test.com",
        company: "ACME Corp",
        contact: "Jane Doe",
        recipientLightningAddress: "vendor@getalby.com",
        amount: 5000,
        note: "Invoice #42",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.draft.status, "pending");
    assert.equal(res.body.draft.amount, 5000);
  });

  it("rejects draft with invalid lightning address", async () => {
    const res = await request(app)
      .post("/api/drafts")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({
        recipientEmail: "vendor@test.com",
        company: "ACME Corp",
        contact: "Jane Doe",
        recipientLightningAddress: "not-a-valid-address",
        amount: 5000,
      });

    assert.equal(res.status, 400);
  });

  it("rejects draft with zero amount", async () => {
    const res = await request(app)
      .post("/api/drafts")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({
        recipientEmail: "vendor@test.com",
        company: "ACME Corp",
        contact: "Jane Doe",
        recipientLightningAddress: "vendor@getalby.com",
        amount: 0,
      });

    assert.equal(res.status, 400);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("Input validation (Zod)", () => {
  it("rejects login with email exceeding max length", async () => {
    const longEmail = "a".repeat(250) + "@b.com";
    const res = await request(app)
      .post("/api/login")
      .send({ email: longEmail, password: "pass" });
    assert.equal(res.status, 400);
  });

  it("rejects /api/pay with negative amount", async () => {
    const res = await request(app)
      .post("/api/pay")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({
        recipientType: "supplier",
        recipientId: "sup-1",
        contact: "Jane",
        company: "ACME",
        lightningAddress: "jane@getalby.com",
        paymentAmount: -100,
      });
    assert.equal(res.status, 400);
  });
});

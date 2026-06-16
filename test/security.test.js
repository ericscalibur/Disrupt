"use strict";

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

before(async () => {
  const hash = await bcrypt.hash("pw", 1);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, department, lightningAddress, dateAdded)
    VALUES
      ('eng-emp',  'Eng Emp',  'eng@test.com',  ?, 'Employee', 'Engineering', 'e1@getalby.com', '2024-01-01'),
      ('sales-emp','Sales Emp','sales2@test.com',?, 'Employee', 'Sales',       'e2@getalby.com', '2024-01-01'),
      ('pay-emp',  'Pay Emp',  'pay@test.com',  ?, 'Employee', 'Engineering', 'pay@getalby.com','2024-01-01')
  `).run(hash, hash, hash);
  db.prepare("INSERT OR IGNORE INTO departments (name) VALUES ('Engineering'),('Sales')").run();
});

const tok = (p) => jwt.sign(p, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
const adminToken      = () => tok({ id: "a", email: "a@x.com", role: "Admin", department: "Engineering" });
const managerEng      = () => tok({ id: "m", email: "m@x.com", role: "Manager", department: "Engineering" });
const bookkeeperToken = () => tok({ id: "b", email: "b@x.com", role: "Bookkeeper", department: "Engineering" });
const employeeToken   = () => tok({ id: "e", email: "e@x.com", role: "Employee", department: "Engineering" });

const analytics = (recipientId, recipientType, t) =>
  request(app).get("/api/analytics/recipient")
    .query({ recipientId, recipientType }).set("Authorization", `Bearer ${t}`);

describe("GET /api/analytics/recipient — authorization", () => {
  it("forbids an Employee from reading payroll analytics", async () => {
    assert.equal((await analytics("eng@test.com", "employee", employeeToken())).status, 403);
  });
  it("allows an Admin", async () => {
    assert.equal((await analytics("eng@test.com", "employee", adminToken())).status, 200);
  });
  it("allows a Bookkeeper", async () => {
    assert.equal((await analytics("eng@test.com", "employee", bookkeeperToken())).status, 200);
  });
  it("allows a Manager for their own department", async () => {
    assert.equal((await analytics("eng@test.com", "employee", managerEng())).status, 200);
  });
  it("forbids a Manager from reading a recipient outside their department", async () => {
    const res = await analytics("sales2@test.com", "employee", managerEng());
    assert.equal(res.status, 403);
    assert.match(res.body.message, /department/i);
  });
});

describe("DELETE /api/departments — Manager scoping", () => {
  it("blocks a Manager from deleting another department", async () => {
    const res = await request(app).delete("/api/departments")
      .set("Authorization", `Bearer ${managerEng()}`)
      .send({ department: "Sales", confirmDelete: true });
    assert.equal(res.status, 403);
    assert.ok(db.prepare("SELECT name FROM departments WHERE name='Sales'").get(), "Sales must still exist");
  });
});

describe("Refresh-token revocation", () => {
  it("change-password revokes OTHER sessions but keeps the current one", async () => {
    const password = "OrigPass1!";
    const hash = await bcrypt.hash(password, 1);
    db.prepare(`INSERT OR REPLACE INTO users (id, name, email, password, role, department, lightningAddress, dateAdded)
      VALUES ('cp-user','CP','cp@test.com',?, 'Employee','Engineering','cp@getalby.com','2024-01-01')`).run(hash);
    db.prepare("INSERT INTO refresh_tokens (token, userId, createdAt) VALUES ('cur','cp-user','t'),('other','cp-user','t')").run();

    const access = tok({ id: "cp-user", email: "cp@test.com", role: "Employee", department: "Engineering" });
    const res = await request(app).post("/api/change-password")
      .set("Authorization", `Bearer ${access}`)
      .set("Cookie", ["refreshToken=cur"])
      .send({ currentPassword: password, newPassword: "BrandNew9#" });
    assert.equal(res.status, 200);

    assert.ok(db.prepare("SELECT 1 FROM refresh_tokens WHERE token='cur'").get(), "current session kept");
    assert.equal(db.prepare("SELECT 1 FROM refresh_tokens WHERE token='other'").get(), undefined, "other session revoked");
  });

  it("deleting a user revokes their refresh tokens", async () => {
    db.prepare(`INSERT OR REPLACE INTO users (id, name, email, password, role, department, lightningAddress, dateAdded)
      VALUES ('del-user','Del','del@test.com','x','Employee','Engineering','d@getalby.com','2024-01-01')`).run();
    db.prepare("INSERT INTO refresh_tokens (token, userId, createdAt) VALUES ('deltok','del-user','t')").run();

    const res = await request(app).post("/api/users")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ action: "remove", email: "del@test.com" });
    assert.equal(res.status, 200);
    assert.equal(db.prepare("SELECT 1 FROM refresh_tokens WHERE token='deltok'").get(), undefined);
  });
});

describe("POST /api/pay — idempotency & integer amounts", () => {
  const base = {
    recipientType: "employee", recipientId: "pay@test.com",
    contact: "Pay Emp", company: "ACME",
    lightningAddress: "pay@getalby.com", paymentAmount: 1000,
  };

  it("rejects a fractional sat amount", async () => {
    const res = await request(app).post("/api/pay")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ ...base, paymentAmount: 1000.5 });
    assert.equal(res.status, 400);
  });

  it("rejects a duplicate idempotency key with 409 (before any payment)", async () => {
    db.prepare("INSERT INTO processed_payments (idempotencyKey, createdAt) VALUES ('dupkey-123456','t')").run();
    const res = await request(app).post("/api/pay")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ ...base, idempotencyKey: "dupkey-123456" });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /duplicate/i);
  });
});

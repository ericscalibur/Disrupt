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
      ('edit-emp',  'Edit Me',  'edit-me@test.com',  ?, 'Employee', 'Engineering', 'em@getalby.com', '2024-01-01'),
      ('edit-emp2', 'Other',    'taken@test.com',    ?, 'Employee', 'Engineering', 'ot@getalby.com', '2024-01-01')
  `).run(hash, hash);
});

const adminToken = () =>
  jwt.sign({ id: "admin-x", email: "admin@x.com", role: "Admin", department: "Engineering" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
const managerToken = () =>
  jwt.sign({ id: "mgr-x", email: "mgr@x.com", role: "Manager", department: "Engineering" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
const employeeToken = () =>
  jwt.sign({ id: "emp-x", email: "emp@x.com", role: "Employee", department: "Engineering" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });

const put = (id, body, tok) =>
  request(app).put(`/api/team-members/${id}`).set("Authorization", `Bearer ${tok}`).send(body);

describe("PUT /api/team-members/:id — email editing", () => {
  it("lets an Admin change a team member's email and persists it", async () => {
    const res = await put("edit-emp", { email: "new-email@test.com" }, adminToken());
    assert.equal(res.status, 200);
    assert.equal(res.body.email, "new-email@test.com");

    const row = db.prepare("SELECT email FROM users WHERE id = 'edit-emp'").get();
    assert.equal(row.email, "new-email@test.com");
  });

  it("lets a Manager change a team member's email too", async () => {
    const res = await put("edit-emp", { email: "mgr-set@test.com" }, managerToken());
    assert.equal(res.status, 200);
    assert.equal(res.body.email, "mgr-set@test.com");
  });

  it("rejects an Employee (insufficient role)", async () => {
    const res = await put("edit-emp", { email: "nope@test.com" }, employeeToken());
    assert.equal(res.status, 403);
  });

  it("rejects changing to an email already used by another user", async () => {
    const res = await put("edit-emp", { email: "taken@test.com" }, adminToken());
    assert.equal(res.status, 400);
    assert.match(res.body.message, /already in use/i);
  });

  it("rejects a malformed email", async () => {
    const res = await put("edit-emp", { email: "not-an-email" }, adminToken());
    assert.equal(res.status, 400);
  });
});

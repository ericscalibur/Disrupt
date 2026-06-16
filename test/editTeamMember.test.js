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
      ('edit-emp',    'Edit Me',  'edit-me@test.com',  ?, 'Employee', 'Engineering', 'em@getalby.com',  '2024-01-01'),
      ('edit-emp2',   'Other',    'taken@test.com',    ?, 'Employee', 'Engineering', 'ot@getalby.com',  '2024-01-01'),
      ('sales-emp',   'Sales Person', 'sales@test.com', ?, 'Employee', 'Sales',      'sa@getalby.com',  '2024-01-01'),
      ('self-admin',  'Self Admin', 'selfadmin@test.com', ?, 'Admin',  'Engineering', 'sd@getalby.com', '2024-01-01')
  `).run(hash, hash, hash, hash);
});

const tok = (payload) => jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
const adminToken    = () => tok({ id: "admin-x", email: "admin@x.com", role: "Admin", department: "Engineering" });
const managerToken  = () => tok({ id: "mgr-x", email: "mgr@x.com", role: "Manager", department: "Engineering" });
const employeeToken = () => tok({ id: "emp-x", email: "emp@x.com", role: "Employee", department: "Engineering" });
const selfAdminToken = () => tok({ id: "self-admin", email: "selfadmin@test.com", role: "Admin", department: "Engineering" });

const put = (id, body, t) =>
  request(app).put(`/api/team-members/${id}`).set("Authorization", `Bearer ${t}`).send(body);

describe("PUT /api/team-members/:id — email editing", () => {
  it("lets an Admin change a team member's email and persists it", async () => {
    const res = await put("edit-emp", { email: "new-email@test.com" }, adminToken());
    assert.equal(res.status, 200);
    assert.equal(res.body.email, "new-email@test.com");
    assert.equal(db.prepare("SELECT email FROM users WHERE id='edit-emp'").get().email, "new-email@test.com");
  });

  it("lets a same-department Manager change a member's email", async () => {
    const res = await put("edit-emp", { email: "mgr-set@test.com" }, managerToken());
    assert.equal(res.status, 200);
  });

  it("rejects an Employee (insufficient role)", async () => {
    assert.equal((await put("edit-emp", { email: "nope@test.com" }, employeeToken())).status, 403);
  });

  it("rejects an email already used by another user", async () => {
    const res = await put("edit-emp", { email: "taken@test.com" }, adminToken());
    assert.equal(res.status, 400);
    assert.match(res.body.message, /already in use/i);
  });

  it("rejects a malformed email", async () => {
    assert.equal((await put("edit-emp", { email: "not-an-email" }, adminToken())).status, 400);
  });
});

describe("PUT /api/team-members/:id — RBAC guards", () => {
  it("blocks a Manager from granting the Admin role", async () => {
    const res = await put("edit-emp", { role: "Admin" }, managerToken());
    assert.equal(res.status, 403);
    assert.match(res.body.message, /Admin role/i);
    assert.equal(db.prepare("SELECT role FROM users WHERE id='edit-emp'").get().role, "Employee");
  });

  it("blocks a Manager from editing a user outside their department", async () => {
    const res = await put("sales-emp", { name: "Hacked" }, managerToken());
    assert.equal(res.status, 403);
    assert.match(res.body.message, /department/i);
  });

  it("blocks a Manager from moving a user into another department", async () => {
    const res = await put("edit-emp", { department: "Sales" }, managerToken());
    assert.equal(res.status, 403);
  });

  it("blocks changing your OWN role (self-escalation/demotion)", async () => {
    const res = await put("self-admin", { role: "Manager" }, selfAdminToken());
    assert.equal(res.status, 403);
    assert.match(res.body.message, /your own role/i);
  });

  it("lets an Admin grant the Admin role to someone else", async () => {
    const res = await put("edit-emp2", { role: "Admin" }, adminToken());
    assert.equal(res.status, 200);
    assert.equal(db.prepare("SELECT role FROM users WHERE id='edit-emp2'").get().role, "Admin");
  });
});

describe("PUT /api/team-members/:id — admin-set password", () => {
  it("hashes and persists a new password set via the edit modal", async () => {
    const res = await put("sales-emp", { password: "AdminSet9#" }, adminToken());
    assert.equal(res.status, 200);
    const row = db.prepare("SELECT password FROM users WHERE id='sales-emp'").get();
    assert.equal(await bcrypt.compare("AdminSet9#", row.password), true);

    // And the user can log in with it.
    const login = await request(app).post("/api/login").send({ email: "sales@test.com", password: "AdminSet9#" });
    assert.equal(login.status, 200);
  });

  it("rejects a weak admin-set password", async () => {
    assert.equal((await put("sales-emp", { password: "weak" }, adminToken())).status, 400);
  });
});

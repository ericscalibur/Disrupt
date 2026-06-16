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

const OLD_PASSWORD = "TempPass1!";

before(async () => {
  const hash = await bcrypt.hash(OLD_PASSWORD, 1);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, department, lightningAddress, dateAdded)
    VALUES ('cp-emp', 'CP Employee', 'cp@test.com', ?, 'Employee', 'Engineering', 'cp@getalby.com', '2024-01-01')
  `).run(hash);
});

const token = () =>
  jwt.sign({ id: "cp-emp", email: "cp@test.com", role: "Employee", department: "Engineering" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });

const post = (body, tok = token()) =>
  request(app).post("/api/change-password").set("Authorization", `Bearer ${tok}`).send(body);

describe("POST /api/change-password", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/change-password")
      .send({ currentPassword: OLD_PASSWORD, newPassword: "NewPass1!" });
    assert.equal(res.status, 401);
  });

  it("rejects a wrong current password", async () => {
    const res = await post({ currentPassword: "WrongPass1!", newPassword: "NewPass1!" });
    assert.equal(res.status, 401);
    assert.match(res.body.message, /current password is incorrect/i);
  });

  it("rejects a weak new password (no special char)", async () => {
    const res = await post({ currentPassword: OLD_PASSWORD, newPassword: "NoSpecial1" });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /special character/i);
  });

  it("rejects a weak new password (too short)", async () => {
    const res = await post({ currentPassword: OLD_PASSWORD, newPassword: "Ab1!" });
    assert.equal(res.status, 400);
  });

  it("rejects reusing the same password", async () => {
    const res = await post({ currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /different from your current/i);
  });

  it("changes the password and lets the user log in with the new one", async () => {
    const NEW_PASSWORD = "FreshPass9#";
    const res = await post({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    // The stored hash now matches the new password, not the old one.
    const row = db.prepare("SELECT password FROM users WHERE id = 'cp-emp'").get();
    assert.equal(await bcrypt.compare(NEW_PASSWORD, row.password), true);
    assert.equal(await bcrypt.compare(OLD_PASSWORD, row.password), false);

    // And login succeeds with the new password.
    const login = await request(app).post("/api/login")
      .send({ email: "cp@test.com", password: NEW_PASSWORD });
    assert.equal(login.status, 200);
    assert.ok(login.body.accessToken);
  });
});

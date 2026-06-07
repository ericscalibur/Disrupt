"use strict";

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const logger = require("../logger");
const { schemas, validate } = require("../validators");
const { authenticateToken, authorizeRoles, authorizedRoles } = require("../middleware/auth");
const { getEmployeeById, updateEmployeeById } = require("../lib/db-helpers");

router.get(
  "/users",
  authenticateToken,
  authorizeRoles("Admin", "Manager", "Employee", "Bookkeeper"),
  async (req, res) => {
    try {
      const cols = "id, name, email, role, department, lightningAddress, btcAddress, dateAdded";
      let users;
      if (req.user.role !== "Admin" && req.user.department) {
        users = db.prepare(`SELECT ${cols} FROM users WHERE department = ?`).all(req.user.department);
      } else {
        users = db.prepare(`SELECT ${cols} FROM users`).all();
      }
      res.json(users);
    } catch (err) {
      logger.error("Error in /api/users:", err);
      res.status(500).json({
        success: false,
        message: "Failed to load users",
        error: err.message,
      });
    }
  },
);

// ADD USER
router.post(
  "/users",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  validate(schemas.addUser),
  async (req, res) => {
    try {
      const { action, email, ...rest } = req.body;
      if (!req.user || !req.user.role) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized: user information missing",
        });
      }

      // Only Admins and Managers allowed to manage users
      if (!["Admin", "Manager"].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: "Access denied: insufficient permissions",
        });
      }

      // For Managers, restrict actions to their own department
      if (
        req.user.role === "Manager" &&
        rest.department &&
        rest.department !== req.user.department
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied: Managers can only manage users within their department",
        });
      }

      if (action === "remove") {
        if (!email || typeof email !== "string") {
          return res.status(400).json({
            success: false,
            message: "Valid email is required to remove user.",
          });
        }

        const userToRemove = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
        if (!userToRemove) {
          return res.status(404).json({ success: false, message: "User not found." });
        }

        if (
          req.user.role === "Manager" &&
          userToRemove.department !== req.user.department
        ) {
          return res.status(403).json({
            success: false,
            message: "Access denied: Managers can only remove users within their department",
          });
        }

        db.prepare("DELETE FROM users WHERE email = ? COLLATE NOCASE").run(email);
        return res.json({ success: true });
      }

      // Default action: add user
      const { name, role, department, lightningAddress, btcAddress } = rest;
      if (!name || !email || !role) {
        return res.status(400).json({
          success: false,
          message: "Name, email, and role are required.",
        });
      }

      // H-4: Managers cannot create Admin-role users
      if (req.user.role === "Manager" && role === "Admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied: Managers cannot create Admin users.",
        });
      }

      if (req.user.role === "Manager" && department !== req.user.department) {
        return res.status(403).json({
          success: false,
          message: "Access denied: Managers can only add users within their department",
        });
      }

      if (db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
        return res.status(400).json({ success: false, message: "User already exists" });
      }

      const id = crypto
        .createHash("sha256")
        .update(`${name}|${email}|${role}|${department}|${lightningAddress}`)
        .digest("hex");

      const newUser = {
        id,
        name,
        email,
        role,
        department: department || null,
        lightningAddress: lightningAddress || null,
        btcAddress: btcAddress || null,
        password: await bcrypt.hash(crypto.randomBytes(8).toString("hex"), 10),
        dateAdded: new Date().toISOString().split("T")[0],
      };
      db.prepare(`
        INSERT INTO users (id, name, email, password, role, department, lightningAddress, btcAddress, dateAdded)
        VALUES (@id, @name, @email, @password, @role, @department, @lightningAddress, @btcAddress, @dateAdded)
      `).run(newUser);
      const { password: _pw, ...safeUser } = newUser;
      return res.json({ success: true, user: safeUser });
    } catch (err) {
      logger.error("Error in /api/users:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

/////  EDIT EMPLOYEE DETAILS ////
router.put("/team-members/:id", authenticateToken, authorizeRoles(...authorizedRoles), validate(schemas.editUser), async (req, res) => {
  const id = req.params.id;
  const updates = req.body;

  try {
    const user = getEmployeeById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const updated = updateEmployeeById(id, updates);
    const { password: _pw, ...safeUser } = updated;
    res.json(safeUser);
  } catch (err) {
    logger.error("Error updating user:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// FOR ADMIN/MANAGER
router.get(
  "/employees",
  authenticateToken,
  authorizeRoles("Admin", "Manager"),
  async (req, res) => {
    try {
      const cols = "id, name, email, role, department, lightningAddress, btcAddress, dateAdded";
      let employees;
      if (req.user.role === "Manager" && req.user.department) {
        employees = db.prepare(`SELECT ${cols} FROM users WHERE department = ?`).all(req.user.department);
      } else {
        employees = db.prepare(`SELECT ${cols} FROM users`).all();
      }
      res.json({ success: true, employees });
    } catch (err) {
      logger.error("Error in /api/employees:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to load employees" });
    }
  },
);

// BULK IMPORT EMPLOYEES FROM CSV
router.post("/import/employees", authenticateToken, authorizeRoles("Admin", "Manager"), async (req, res) => {
  const { employees } = req.body;
  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ success: false, message: "No employee data provided." });
  }

  const validRoles = ["Admin", "Manager", "Bookkeeper", "Employee"];
  const results = [];

  for (const row of employees) {
    const name = (row.name || "").trim();
    const email = (row.email || "").trim().toLowerCase();
    const role = (row.role || "").trim();
    const department = (row.department || "").trim();
    const lightningAddress = (row.lightningAddress || "").trim();
    const btcAddress = (row.btcAddress || "").trim();
    const label = name || email || "(unnamed)";

    if (!name || !email || !role) {
      results.push({ label, status: "skipped", reason: "Missing name, email, or role" }); continue;
    }
    if (!validRoles.includes(role)) {
      results.push({ label, status: "skipped", reason: `Invalid role "${role}"` }); continue;
    }
    if (req.user.role === "Manager" && role === "Admin") {
      results.push({ label, status: "skipped", reason: "Managers cannot import Admin-role users" }); continue;
    }
    if (req.user.role === "Manager" && department && department !== req.user.department) {
      results.push({ label, status: "skipped", reason: "Managers can only import to their own department" }); continue;
    }
    if (db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
      results.push({ label, status: "skipped", reason: "Email already exists" }); continue;
    }

    try {
      if (department) {
        db.prepare("INSERT OR IGNORE INTO departments (name) VALUES (?)").run(department);
      }
      const id = crypto.createHash("sha256").update(`${name}|${email}|${role}|${department}|${lightningAddress}`).digest("hex");
      db.prepare(`
        INSERT INTO users (id, name, email, password, role, department, lightningAddress, btcAddress, dateAdded)
        VALUES (@id, @name, @email, @password, @role, @department, @lightningAddress, @btcAddress, @dateAdded)
      `).run({
        id, name, email,
        password: await bcrypt.hash(crypto.randomBytes(8).toString("hex"), 10),
        role,
        department: department || null,
        lightningAddress: lightningAddress || null,
        btcAddress: btcAddress || null,
        dateAdded: new Date().toISOString().split("T")[0],
      });
      results.push({ label, status: "imported" });
    } catch (err) {
      results.push({ label, status: "failed", reason: err.message });
    }
  }

  const imported = results.filter((r) => r.status === "imported").length;
  logger.info({ imported, total: employees.length, by: req.user.email }, "employee CSV import");
  res.json({ success: true, results });
});

module.exports = router;

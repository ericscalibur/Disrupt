"use strict";

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../logger");
const { schemas, validate } = require("../validators");
const { authenticateToken, authorizeRoles, authorizedRoles } = require("../middleware/auth");

router.get(
  "/departments",
  authenticateToken,
  authorizeRoles("Admin", "Manager", "Employee", "Bookkeeper"),
  async (req, res) => {
    try {
      const departments = db.prepare("SELECT name FROM departments").all().map((r) => r.name);
      res.json({ success: true, departments });
    } catch (err) {
      logger.error("Error reading departments:", err);
      return res
        .status(500)
        .json({ success: false, error: "Could not read departments." });
    }
  },
);

// POST: Add a new department
router.post(
  "/departments",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  validate(schemas.addDepartment),
  async (req, res) => {
    try {
      const { department } = req.body;
      if (!department || typeof department !== "string" || !department.trim()) {
        return res
          .status(400)
          .json({ error: "Valid department name is required." });
      }

      if (db.prepare("SELECT name FROM departments WHERE name = ?").get(department)) {
        return res.status(400).json({ error: "Department already exists." });
      }

      db.prepare("INSERT INTO departments (name) VALUES (?)").run(department);

      const departments = db.prepare("SELECT name FROM departments").all().map((r) => r.name);
      res.json({ success: true, departments });
    } catch (err) {
      logger.error("Error adding department:", err);
      res.status(500).json({ error: "Could not add department." });
    }
  },
);

// DELETE: Remove a department
router.delete(
  "/departments",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  validate(schemas.deleteDepartment),
  async (req, res) => {
    try {
      const { department, confirmDelete } = req.body;
      if (!department || typeof department !== "string" || !department.trim()) {
        return res
          .status(400)
          .json({ error: "Valid department name is required." });
      }

      if (!db.prepare("SELECT name FROM departments WHERE name = ?").get(department)) {
        return res
          .status(404)
          .json({ success: false, message: "Department not found." });
      }

      const employeesInDepartment = db
        .prepare("SELECT name, email FROM users WHERE department = ?")
        .all(department);

      if (employeesInDepartment.length > 0 && !confirmDelete) {
        return res.json({
          success: false,
          requiresConfirmation: true,
          employeeCount: employeesInDepartment.length,
          employees: employeesInDepartment,
          message: `This department has ${employeesInDepartment.length} employee(s). Deleting this department will also remove these employees.`,
        });
      }

      // Atomically delete employees + department
      db.transaction(() => {
        if (employeesInDepartment.length > 0) {
          db.prepare("DELETE FROM users WHERE department = ?").run(department);
        }
        db.prepare("DELETE FROM departments WHERE name = ?").run(department);
      })();

      const departments = db.prepare("SELECT name FROM departments").all().map((r) => r.name);
      res.json({
        success: true,
        departments,
        deletedEmployees: employeesInDepartment.length,
        message:
          employeesInDepartment.length > 0
            ? `Department deleted along with ${employeesInDepartment.length} employee(s).`
            : "Department deleted successfully.",
      });
    } catch (err) {
      logger.error("Error removing department:", err);
      res.status(500).json({ error: "Could not remove department." });
    }
  },
);

module.exports = router;

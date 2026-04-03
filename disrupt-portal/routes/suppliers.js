"use strict";

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../logger");
const { schemas, validate } = require("../validators");
const { authenticateToken, authorizeRoles, authorizedRoles } = require("../middleware/auth");

// GET Suppliers
router.get("/suppliers", authenticateToken, async (req, res) => {
  try {
    const suppliers = db.prepare("SELECT * FROM suppliers").all();
    res.json({ success: true, suppliers });
  } catch (err) {
    logger.error("Failed to load suppliers:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load suppliers." });
  }
});

// Add Supplier
router.post("/suppliers", authenticateToken, validate(schemas.addSupplier), async (req, res) => {
  const { company, contact, email, lightningAddress, note } = req.body;
  if (!company || !contact || !email || !lightningAddress) {
    return res.status(400).json({
      success: false,
      message: "Company, contact, email, and lightning address are required.",
    });
  }

  try {
    const existing = db
      .prepare("SELECT id FROM suppliers WHERE email = ? OR lightningAddress = ?")
      .get(email, lightningAddress);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Supplier with this email or lightning address already exists.",
      });
    }

    const newSupplier = {
      id: "sup" + Date.now(),
      company,
      contact,
      email,
      lightningAddress,
      note: note || "",
      createdAt: new Date().toISOString(),
    };
    db.prepare(`
      INSERT INTO suppliers (id, company, contact, email, lightningAddress, note, createdAt)
      VALUES (@id, @company, @contact, @email, @lightningAddress, @note, @createdAt)
    `).run(newSupplier);
    res.json({ success: true, supplier: newSupplier });
  } catch (err) {
    logger.error("Error adding supplier:", err);
    res.status(500).json({ success: false, message: "Error adding supplier." });
  }
});

// FOR DRAFT MODAL
router.get("/suppliers/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id);
    if (!supplier) {
      return res
        .status(404)
        .json({ success: false, message: "Supplier not found." });
    }

    res.json({ success: true, supplier });
  } catch (err) {
    logger.error("Failed to load supplier:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load supplier." });
  }
});

// Remove Supplier
router.delete("/suppliers/:id", authenticateToken, authorizeRoles(...authorizedRoles), async (req, res) => {
  const supplierId = req.params.id;
  try {
    const result = db.prepare("DELETE FROM suppliers WHERE id = ?").run(supplierId);
    if (result.changes === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Supplier not found." });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error("Error removing supplier:", err);
    res
      .status(500)
      .json({ success: false, message: "Error removing supplier." });
  }
});

//// EDIT SUPPLIER /////
router.put("/suppliers/:id", authenticateToken, authorizeRoles(...authorizedRoles), validate(schemas.editSupplier), async (req, res) => {
  const id = req.params.id;
  const updates = req.body;

  try {
    const original = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id);
    if (!original) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    const allowed = ["company", "contact", "email", "lightningAddress", "note"];
    const fields = Object.keys(updates).filter((k) => allowed.includes(k));
    if (fields.length > 0) {
      const setClause = fields.map((k) => `${k} = @${k}`).join(", ");
      db.prepare(`UPDATE suppliers SET ${setClause} WHERE id = @id`).run({ ...updates, id });
    }

    const updated = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id);
    res.json(updated);
  } catch (err) {
    logger.error("Error updating supplier:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;

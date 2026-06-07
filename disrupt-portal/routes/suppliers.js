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
router.post("/suppliers", authenticateToken, authorizeRoles("Admin", "Manager"), validate(schemas.addSupplier), async (req, res) => {
  const { company, contact, email, lightningAddress, btcAddress, note } = req.body;

  try {
    const byEmail = db.prepare("SELECT id FROM suppliers WHERE email = ?").get(email);
    const byLn = lightningAddress
      ? db.prepare("SELECT id FROM suppliers WHERE lightningAddress = ?").get(lightningAddress)
      : null;
    if (byEmail || byLn) {
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
      lightningAddress: lightningAddress || null,
      btcAddress: btcAddress || null,
      note: note || "",
      createdAt: new Date().toISOString(),
    };
    db.prepare(`
      INSERT INTO suppliers (id, company, contact, email, lightningAddress, btcAddress, note, createdAt)
      VALUES (@id, @company, @contact, @email, @lightningAddress, @btcAddress, @note, @createdAt)
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

    const allowed = ["company", "contact", "email", "lightningAddress", "btcAddress", "note"];
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

// BULK IMPORT SUPPLIERS FROM CSV
router.post("/import/suppliers", authenticateToken, authorizeRoles("Admin", "Manager"), async (req, res) => {
  const { suppliers } = req.body;
  if (!Array.isArray(suppliers) || suppliers.length === 0) {
    return res.status(400).json({ success: false, message: "No supplier data provided." });
  }

  const results = [];

  for (const row of suppliers) {
    const company = (row.company || "").trim();
    const contact = (row.contact || "").trim();
    const email = (row.email || "").trim().toLowerCase();
    const lightningAddress = (row.lightningAddress || "").trim();
    const btcAddress = (row.btcAddress || "").trim();
    const note = (row.note || "").trim();
    const label = company || email || "(unnamed)";

    if (!company || !contact || !email) {
      results.push({ label, status: "skipped", reason: "Missing company, contact, or email" }); continue;
    }
    if (!lightningAddress && !btcAddress) {
      results.push({ label, status: "skipped", reason: "At least one payment address required" }); continue;
    }
    if (db.prepare("SELECT id FROM suppliers WHERE email = ?").get(email)) {
      results.push({ label, status: "skipped", reason: "Email already exists" }); continue;
    }

    try {
      db.prepare(`
        INSERT INTO suppliers (id, company, contact, email, lightningAddress, btcAddress, note, createdAt)
        VALUES (@id, @company, @contact, @email, @lightningAddress, @btcAddress, @note, @createdAt)
      `).run({
        id: "sup" + Date.now() + Math.random().toString(36).slice(2),
        company, contact, email,
        lightningAddress: lightningAddress || null,
        btcAddress: btcAddress || null,
        note,
        createdAt: new Date().toISOString(),
      });
      results.push({ label, status: "imported" });
    } catch (err) {
      results.push({ label, status: "failed", reason: err.message });
    }
  }

  const imported = results.filter((r) => r.status === "imported").length;
  logger.info({ imported, total: suppliers.length, by: req.user.email }, "supplier CSV import");
  res.json({ success: true, results });
});

module.exports = router;

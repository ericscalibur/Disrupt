"use strict";

const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { fromFile } = require("file-type");
const db = require("../db");
const logger = require("../logger");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { upload, UPLOAD_DIR } = require("../middleware/upload");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

// POST /api/receipts — upload a receipt file
router.post(
  "/receipts",
  authenticateToken,
  upload.single("receipt"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    // Validate magic bytes — don't trust Content-Type header alone
    const detected = await fromFile(req.file.path);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: "File content does not match an allowed type." });
    }

    try {
      const receiptId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO receipts (id, filename, originalName, mimeType, sizeBytes, uploadedBy, uploadedAt)
        VALUES (@id, @filename, @originalName, @mimeType, @sizeBytes, @uploadedBy, @uploadedAt)
      `).run({
        id: receiptId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: detected.mime,
        sizeBytes: req.file.size,
        uploadedBy: req.user.email,
        uploadedAt: new Date().toISOString(),
      });

      logger.info({ receiptId, uploadedBy: req.user.email, size: req.file.size }, "receipt uploaded");
      res.json({ success: true, receiptId });
    } catch (err) {
      fs.unlink(req.file.path, () => {});
      logger.error("Error saving receipt metadata:", err);
      res.status(500).json({ success: false, message: "Failed to save receipt." });
    }
  },
);

// GET /api/receipts/:id — serve a receipt file (authenticated)
router.get("/receipts/:id", authenticateToken, (req, res) => {
  const { id } = req.params;

  const receipt = db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
  if (!receipt) {
    return res.status(404).json({ success: false, message: "Receipt not found." });
  }

  // Only uploader, Admin, or Manager can view receipts
  const { role, email } = req.user;
  if (role !== "Admin" && role !== "Manager" && role !== "Bookkeeper" && email !== receipt.uploadedBy) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }

  const filePath = path.join(UPLOAD_DIR, receipt.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "File not found on disk." });
  }

  res.setHeader("Content-Type", receipt.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(receipt.originalName)}"`);
  res.sendFile(filePath);
});

// DELETE /api/receipts/:id — remove an unattached receipt (uploader only, before draft is submitted)
router.delete("/receipts/:id", authenticateToken, (req, res) => {
  const { id } = req.params;

  const receipt = db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
  if (!receipt) {
    return res.status(404).json({ success: false, message: "Receipt not found." });
  }

  // Only the uploader can delete their own pending receipt
  if (receipt.uploadedBy !== req.user.email && req.user.role !== "Admin") {
    return res.status(403).json({ success: false, message: "Access denied." });
  }

  // Prevent deleting receipts already attached to a draft
  const draft = db.prepare("SELECT id FROM drafts WHERE receiptId = ?").get(id);
  if (draft) {
    return res.status(409).json({ success: false, message: "Cannot delete a receipt attached to a draft." });
  }

  fs.unlink(path.join(UPLOAD_DIR, receipt.filename), (err) => {
    if (err) logger.warn({ receiptId: id }, "Could not delete receipt file from disk");
  });
  db.prepare("DELETE FROM receipts WHERE id = ?").run(id);

  res.json({ success: true });
});

module.exports = router;

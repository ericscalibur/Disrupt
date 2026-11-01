"use strict";

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../logger");
const { schemas, validate } = require("../validators");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { auditLog } = require("../lib/db-helpers");

// GET CATEGORIES — active only by default; ?includeArchived=1 returns all
router.get("/categories", authenticateToken, (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "1";
    const categories = db
      .prepare(
        includeArchived
          ? "SELECT * FROM categories ORDER BY sortOrder, name"
          : "SELECT * FROM categories WHERE archived = 0 ORDER BY sortOrder, name"
      )
      .all();
    res.json({ success: true, categories });
  } catch (err) {
    logger.error("Error retrieving categories:", err);
    res.status(500).json({ success: false, message: "Failed to retrieve categories." });
  }
});

// ADD CATEGORY
router.post(
  "/categories",
  authenticateToken,
  authorizeRoles("Admin"),
  validate(schemas.addCategory),
  (req, res) => {
    try {
      const { name, kind } = req.body;
      const maxSort = db.prepare("SELECT COALESCE(MAX(sortOrder), 0) AS m FROM categories").get().m;
      const category = {
        id: "cat_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name: name.trim(),
        kind,
        sortOrder: maxSort + 1,
        archived: 0,
      };
      db.prepare(
        "INSERT INTO categories (id, name, kind, sortOrder, archived) VALUES (@id, @name, @kind, @sortOrder, @archived)"
      ).run(category);
      auditLog(req.user.email, "category_added", category.id, { name: category.name, kind });
      res.json({ success: true, category });
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        return res.status(409).json({ success: false, message: "A category with that name already exists." });
      }
      logger.error("Error adding category:", err);
      res.status(500).json({ success: false, message: "Failed to add category." });
    }
  }
);

// EDIT CATEGORY (rename, change kind, archive/unarchive — never delete:
// historical transactions keep referencing it)
router.patch(
  "/categories/:id",
  authenticateToken,
  authorizeRoles("Admin"),
  validate(schemas.editCategory),
  (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: "Category not found." });
      }

      const { name, kind, archived } = req.body;
      const updated = {
        id: existing.id,
        name: name !== undefined ? name.trim() : existing.name,
        kind: kind !== undefined ? kind : existing.kind,
        archived: archived !== undefined ? (archived ? 1 : 0) : existing.archived,
      };
      db.prepare("UPDATE categories SET name = @name, kind = @kind, archived = @archived WHERE id = @id").run(updated);
      auditLog(req.user.email, "category_edited", existing.id, req.body);
      res.json({ success: true, category: { ...existing, ...updated } });
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        return res.status(409).json({ success: false, message: "A category with that name already exists." });
      }
      logger.error("Error editing category:", err);
      res.status(500).json({ success: false, message: "Failed to edit category." });
    }
  }
);

module.exports = router;

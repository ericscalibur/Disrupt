"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const UPLOAD_DIR = path.join(__dirname, "../uploads/receipts");

// Ensure the uploads directory exists on first load (safe on all platforms)
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, _file, cb) => {
    const ext = path.extname(_file.originalname).toLowerCase() || ".bin";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error("Only JPEG, PNG, WebP, and PDF files are allowed."), { code: "INVALID_FILE_TYPE" }));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = { upload, UPLOAD_DIR };

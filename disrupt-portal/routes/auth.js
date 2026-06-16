"use strict";

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const logger = require("../logger");
const { schemas, validate } = require("../validators");
const { authenticateToken } = require("../middleware/auth");

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { success: false, message: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { success: false, message: "Too many password reset requests. Try again in 1 hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Set up nodemailer (replace with your actual email service and credentials)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// User Authentication
router.post("/login", loginRateLimit, validate(schemas.login), async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const userByEmail = db
      .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
      .get(email);

    const passwordMatch =
      userByEmail && (await bcrypt.compare(password, userByEmail.password));

    if (!userByEmail || !passwordMatch) {
      logger.warn({ email }, "login failed");
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = userByEmail;

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      department: user.department,
    };

    // Generate access token (short-lived)
    const accessToken = jwt.sign(tokenPayload, process.env.ACCESS_TOKEN_SECRET, {
      expiresIn: "15m", // 15 minutes
    });

    // Generate refresh token (long-lived)
    const refreshToken = jwt.sign(tokenPayload, process.env.REFRESH_TOKEN_SECRET, {
      expiresIn: "7d", // 7 days
    });

    // Store refresh token in DB
    db.prepare("INSERT OR REPLACE INTO refresh_tokens (token, createdAt) VALUES (?, ?)").run(refreshToken, new Date().toISOString());

    // Set refresh token as HttpOnly cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    });

    logger.info({ email: user.email, role: user.role }, "login");

    // Send access token in response body
    res.json({
      success: true,
      accessToken,
      message: "Login successful",
    });
  } catch (err) {
    logger.error("Login error:", err);
    res.status(500).json({ success: false, message: "Server error during login" });
  }
});

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Exclude password before sending
    const { password, ...userData } = user;
    res.json({ success: true, user: userData });
  } catch (err) {
    logger.error("Error fetching user profile:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching user profile" });
  }
});

//// REFRESH ////
router.post("/refresh", (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res
      .status(401)
      .json({ success: false, message: "No refresh token provided" });
  }

  if (!db.prepare("SELECT token FROM refresh_tokens WHERE token = ?").get(refreshToken)) {
    return res
      .status(403)
      .json({ success: false, message: "Invalid refresh token" });
  }

  jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(403)
        .json({ success: false, message: "Invalid refresh token" });
    }

    // Re-validate user exists and use live role/department (not stale JWT payload)
    const user = db.prepare("SELECT id, email, role, department FROM users WHERE id = ?").get(decoded.id);
    if (!user) {
      db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(refreshToken);
      return res.status(403).json({ success: false, message: "User not found" });
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      department: user.department,
    };

    const newAccessToken = jwt.sign(tokenPayload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
    const newRefreshToken = jwt.sign(tokenPayload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: "7d" });

    // Atomically rotate: only one concurrent request wins the DELETE
    const rotated = db.transaction(() => {
      const result = db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(refreshToken);
      if (result.changes === 0) return false;
      db.prepare("INSERT INTO refresh_tokens (token, createdAt) VALUES (?, ?)").run(newRefreshToken, new Date().toISOString());
      return true;
    })();

    if (!rotated) {
      return res.status(403).json({ success: false, message: "Invalid refresh token" });
    }

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true, accessToken: newAccessToken });
  });
});

// Logout route to revoke refresh token
router.post("/logout", (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (refreshToken) {
    db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(refreshToken);
  }
  res.clearCookie("refreshToken");
  res.sendStatus(204);
});

router.post("/forgot-password", forgotPasswordRateLimit, validate(schemas.forgotPassword), async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email required." });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
  if (!user) {
    // Avoid user enumeration by always responding success
    return res.json({
      success: true,
      message: "If that email exists, a reset PIN has been sent.",
    });
  }

  // Generate a cryptographically random temporary password (16 hex chars = 64 bits of entropy)
  const tempPassword = crypto.randomBytes(8).toString("hex");
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  // Send the email BEFORE writing to the DB — if the send fails, the user's
  // existing password is preserved and they are not locked out.
  try {
    await transporter.sendMail({
      from: '"Disrupt Portal" <support@disrupt.com>',
      to: user.email,
      subject: "Your Temporary Password",
      text: `Your temporary password is: ${tempPassword}\n\nPlease log in and change your password immediately.`,
    });
  } catch (err) {
    logger.error("Failed to send email:", err);
    return res.status(500).json({ success: false, message: "Failed to send email." });
  }

  db.prepare("UPDATE users SET password = ? WHERE email = ? COLLATE NOCASE").run(hashedPassword, email);

  res.json({
    success: true,
    message: "If that email exists, a reset PIN has been sent.",
  });
});

// Authenticated user changes their own password
router.post("/change-password", authenticateToken, validate(schemas.changePassword), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      logger.warn({ email: user.email }, "change-password failed: wrong current password");
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from your current password.",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, user.id);

    logger.info({ email: user.email }, "password changed");
    res.json({ success: true, message: "Password changed successfully." });
  } catch (err) {
    logger.error("Change password error:", err);
    res.status(500).json({ success: false, message: "Server error changing password." });
  }
});

module.exports = router;

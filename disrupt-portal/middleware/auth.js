"use strict";

const jwt = require("jsonwebtoken");
const logger = require("../logger");

const authorizedRoles = ["Admin", "Manager"];

// Middleware to authenticate JWT and attach user info to req.user
function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
      return res
        .status(401)
        .json({ success: false, message: "Authorization header missing" });
    }

    const tokenParts = authHeader.split(" ");

    if (tokenParts.length !== 2 || tokenParts[0] !== "Bearer") {
      return res
        .status(401)
        .json({ success: false, message: "Malformed authorization header" });
    }

    const token = tokenParts[1];

    if (!token) {
      return res.status(401).json({ success: false, message: "Token missing" });
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
      if (err) {
        logger.warn({ err: err.message }, "jwt verification failed");
        return res
          .status(401)
          .json({ success: false, message: "Invalid or expired token" });
      }
      req.user = user;
      next();
    });
  } catch (err) {
    logger.error("Authentication middleware error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

// Middleware to authorize based on allowed roles
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: insufficient permissions",
      });
    }
    next();
  };
}

module.exports = { authenticateToken, authorizeRoles, authorizedRoles };

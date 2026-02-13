const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const nodemailer = require("nodemailer");
const app = express();
const axios = require("axios");
const crypto = require("crypto");
const bolt11 = require("bolt11");
const jwt = require("jsonwebtoken");
const lnurlPay = require("lnurl-pay");
const authorizedRoles = ["Admin", "Manager"];
const refreshTokensStore = new Set();
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdnjs.cloudflare.com",
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://use.fontawesome.com",
      ],
      fontSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://use.fontawesome.com",
      ],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      // Add other directives as needed
    },
  }),
);

app.use(cookieParser());
app.use(express.json());
require("dotenv").config({ path: path.join(__dirname, "../.env") });
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, Postman, or file://)
      if (!origin) return callback(null, true);

      // Allow localhost on any port for development
      if (origin.match(/^http:\/\/localhost:\d+$/)) {
        return callback(null, true);
      }

      // Allow specific origins
      const allowedOrigins = ["http://localhost:5500"];
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

const fetch = require("node-fetch");
const BLINK_API_KEY = process.env.BLINK_API_KEY;

// Path configuration
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");
const SUPPLIERS_FILE = path.join(DATA_DIR, "suppliers.json");
const DEPARTMENTS_FILE = path.join(DATA_DIR, "departments.json");
const DRAFTS_FILE = path.join(DATA_DIR, "drafts.json");
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;

if (!ACCESS_TOKEN_SECRET) {
  throw new Error("ACCESS_TOKEN_SECRET environment variable is not defined");
}

async function getBlinkWallets() {
  const apiKey = BLINK_API_KEY;
  const query = `
    query {
      me {
        defaultAccount {
          wallets {
            id
            walletCurrency
            balance
          }
        }
      }
    }
  `;
  const response = await axios.post(
    "https://api.blink.sv/graphql",
    { query },
    {
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
    },
  );
  // Returns an array of wallet objects (BTC and/or USD)
  return response.data.data.me.defaultAccount.wallets;
}

async function getBlinkTransactions() {
  const apiKey = BLINK_API_KEY;
  const query = `
    query {
      me {
        defaultAccount {
          transactions(first: 50) {
            edges {
              node {
                id
                initiationVia { __typename }
                settlementAmount
                settlementCurrency
                createdAt
                status
                direction
                memo
              }
            }
          }
        }
      }
    }
  `;
  const response = await axios.post(
    "https://api.blink.sv/graphql",
    { query },
    {
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
    },
  );
  // Flatten the edges array to get an array of transactions
  return response.data.data.me.defaultAccount.transactions.edges.map(
    (edge) => edge.node,
  );
}

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
        console.error("JWT verification error:", err);
        return res
          .status(401)
          .json({ success: false, message: "Invalid or expired token" });
      }
      req.user = user;
      next();
    });
  } catch (err) {
    console.error("Authentication middleware error:", err);
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

async function getEmployeeById(id) {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    const users = JSON.parse(data);
    return users.find((user) => String(user.id) === String(id)) || null;
  } catch (err) {
    console.error("Error reading users.json:", err);
    return null;
  }
}

async function getSupplierById(id) {
  try {
    const data = await fs.readFile(SUPPLIERS_FILE, "utf8");
    const suppliers = JSON.parse(data);
    return (
      suppliers.find((supplier) => String(supplier.id) === String(id)) || null
    );
  } catch (err) {
    console.error("Error reading suppliers.json:", err);
    return null;
  }
}

async function updateEmployeeById(id, updates) {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    const users = JSON.parse(data);
    const index = users.findIndex((user) => String(user.id) === String(id));
    if (index === -1) return null;

    users[index] = { ...users[index], ...updates };
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    return users[index];
  } catch (err) {
    console.error("Error updating users.json:", err);
    throw err;
  }
}

//////// ROUTES ////////

// User Authentication
app.post("/api/login", async (req, res) => {
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

    const data = await fs.readFile(USERS_FILE, "utf8");
    let users = [];
    try {
      const parsed = data.trim() === "" ? [] : JSON.parse(data);
      users = Array.isArray(parsed) ? parsed : [];
    } catch {
      console.warn("Invalid JSON in users.json, initializing empty array");
    }

    const user = users.find(
      (u) =>
        u.email.toLowerCase() === email.toLowerCase() &&
        u.password === password,
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      department: user.department,
    };

    // Generate access token (short-lived)
    const accessToken = jwt.sign(tokenPayload, ACCESS_TOKEN_SECRET, {
      expiresIn: "15m", // 15 minutes
    });

    // Generate refresh token (long-lived)
    const refreshToken = jwt.sign(tokenPayload, REFRESH_TOKEN_SECRET, {
      expiresIn: "7d", // 7 days
    });

    // Store refresh token in memory (replace with DB in production)
    refreshTokensStore.add(refreshToken);

    // Set refresh token as HttpOnly cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    });

    // Send access token in response body
    res.json({
      success: true,
      accessToken,
      message: "Login successful",
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error during login",
      error: err.message,
    });
  }
});

app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    const users = JSON.parse(data);
    const user = users.find(
      (u) => u.id === req.user.id || u.email === req.user.email,
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Exclude password before sending
    const { password, ...userData } = user;
    res.json({ success: true, user: userData });
  } catch (err) {
    console.error("Error fetching user profile:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching user profile" });
  }
});

//// REFRESH ////
app.post("/api/refresh", (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res
      .status(401)
      .json({ success: false, message: "No refresh token provided" });
  }

  if (!refreshTokensStore.has(refreshToken)) {
    return res
      .status(403)
      .json({ success: false, message: "Invalid refresh token" });
  }

  jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
    if (err) {
      return res
        .status(403)
        .json({ success: false, message: "Invalid refresh token" });
    }

    // Remove old refresh token and optionally generate a new refresh token (refresh token rotation)
    refreshTokensStore.delete(refreshToken);

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      department: user.department,
    };

    const newAccessToken = jwt.sign(
      tokenPayload,
      process.env.ACCESS_TOKEN_SECRET,
      {
        expiresIn: "15m",
      },
    );

    const newRefreshToken = jwt.sign(
      tokenPayload,
      process.env.REFRESH_TOKEN_SECRET,
      {
        expiresIn: "7d",
      },
    );

    // Store new refresh token
    refreshTokensStore.add(newRefreshToken);

    // Set new refresh token cookie
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      accessToken: newAccessToken,
    });
  });
});

// User Management
app.get(
  "/api/users",
  authenticateToken,
  authorizeRoles("Admin", "Manager", "Employee"),
  async (req, res) => {
    try {
      const data = await fs.readFile(USERS_FILE, "utf8");
      let users = [];
      try {
        const parsed = data.trim() === "" ? [] : JSON.parse(data);
        users = Array.isArray(parsed) ? parsed : [];
      } catch (parseError) {
        console.warn("Invalid JSON in users.json, initializing empty array");
      }

      if (req.user.role !== "Admin" && req.user.department) {
        users = users.filter((user) => user.department === req.user.department);
      }

      const sanitizedUsers = users.map(({ password, ...rest }) => rest);

      res.json(sanitizedUsers);
    } catch (err) {
      console.error("Error in /api/users:", err);
      res.status(500).json({
        success: false,
        message: "Failed to load users",
        error: err.message,
      });
    }
  },
);

app.get(
  "/api/departments",
  authenticateToken,
  authorizeRoles("Admin", "Manager", "Employee"),
  async (req, res) => {
    try {
      const data = await fs.readFile(DEPARTMENTS_FILE, "utf8");
      const departments = data.trim() ? JSON.parse(data) : [];
      res.json({ success: true, departments });
    } catch (err) {
      console.error("Error reading departments:", err);
      return res
        .status(500)
        .json({ success: false, error: "Could not read departments." });
    }
  },
);

// POST: Add a new department
app.post(
  "/api/departments",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  async (req, res) => {
    try {
      const { department } = req.body;
      if (!department || typeof department !== "string" || !department.trim()) {
        return res
          .status(400)
          .json({ error: "Valid department name is required." });
      }

      // Read current departments safely
      let departments = [];
      try {
        const data = await fs.readFile(DEPARTMENTS_FILE, "utf8");
        departments = data.trim() ? JSON.parse(data) : [];
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }

      // Check for duplicates
      if (departments.includes(department)) {
        return res.status(400).json({ error: "Department already exists." });
      }

      // Add new department
      departments.push(department);

      // Save back to file
      await fs.writeFile(
        DEPARTMENTS_FILE,
        JSON.stringify(departments, null, 2),
      );

      res.json({ success: true, departments });
    } catch (err) {
      console.error("Error adding department:", err);
      res.status(500).json({ error: "Could not add department." });
    }
  },
);

// DELETE: Remove a department
app.delete(
  "/api/departments",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  async (req, res) => {
    try {
      const { department, confirmDelete } = req.body;
      if (!department || typeof department !== "string" || !department.trim()) {
        return res
          .status(400)
          .json({ error: "Valid department name is required." });
      }

      // Read current departments safely
      let departments = [];
      try {
        const data = await fs.readFile(DEPARTMENTS_FILE, "utf8");
        departments = data.trim() ? JSON.parse(data) : [];
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }

      // Check if department exists
      if (!departments.includes(department)) {
        return res
          .status(404)
          .json({ success: false, message: "Department not found." });
      }

      // Read users to check for employees in this department
      let users = [];
      try {
        const userData = await fs.readFile(USERS_FILE, "utf8");
        users = userData.trim() ? JSON.parse(userData) : [];
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }

      // Find employees in this department
      const employeesInDepartment = users.filter(
        (user) => user.department === department,
      );

      // If there are employees and no confirmation, return warning
      if (employeesInDepartment.length > 0 && !confirmDelete) {
        return res.json({
          success: false,
          requiresConfirmation: true,
          employeeCount: employeesInDepartment.length,
          employees: employeesInDepartment.map((emp) => ({
            name: emp.name,
            email: emp.email,
          })),
          message: `This department has ${employeesInDepartment.length} employee(s). Deleting this department will also remove these employees.`,
        });
      }

      // If confirmed or no employees, proceed with deletion
      // Remove employees from the department
      if (employeesInDepartment.length > 0) {
        const remainingUsers = users.filter(
          (user) => user.department !== department,
        );
        await fs.writeFile(USERS_FILE, JSON.stringify(remainingUsers, null, 2));
      }

      // Remove the department
      departments = departments.filter((dep) => dep !== department);

      // Save updated departments list
      await fs.writeFile(
        DEPARTMENTS_FILE,
        JSON.stringify(departments, null, 2),
      );

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
      console.error("Error removing department:", err);
      res.status(500).json({ error: "Could not remove department." });
    }
  },
);

// ADD USER
app.post(
  "/api/users",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
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

      // Read users once
      const data = await fs.readFile(USERS_FILE, "utf8");
      let users = [];
      try {
        const parsed = data.trim() === "" ? [] : JSON.parse(data);
        users = Array.isArray(parsed) ? parsed : [];
      } catch {
        console.warn("Invalid JSON in users.json, initializing empty array");
      }

      if (action === "remove") {
        if (!email || typeof email !== "string") {
          return res.status(400).json({
            success: false,
            message: "Valid email is required to remove user.",
          });
        }

        // Check if user to remove exists and belongs to allowed department
        const userToRemove = users.find((user) => user.email === email);
        if (!userToRemove) {
          return res.status(404).json({
            success: false,
            message: "User not found.",
          });
        }

        if (
          req.user.role === "Manager" &&
          userToRemove.department !== req.user.department
        ) {
          return res.status(403).json({
            success: false,
            message:
              "Access denied: Managers can only remove users within their department",
          });
        }

        const updatedUsers = users.filter((user) => user.email !== email);
        await fs.writeFile(USERS_FILE, JSON.stringify(updatedUsers, null, 2));
        return res.json({ success: true });
      }

      // Default action: add user
      const { name, role, department, lightningAddress } = rest;
      if (!name || !email || !role) {
        return res.status(400).json({
          success: false,
          message: "Name, email, and role are required.",
        });
      }

      // For Managers, ensure new user is in their department
      if (req.user.role === "Manager" && department !== req.user.department) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied: Managers can only add users within their department",
        });
      }

      if (users.some((user) => user.email === email)) {
        return res
          .status(400)
          .json({ success: false, message: "User already exists" });
      }

      const id = crypto
        .createHash("sha256")
        .update(`${name}|${email}|${role}|${department}|${lightningAddress}`)
        .digest("hex");

      const newUser = {
        ...rest,
        email,
        lightningAddress, // add this line
        password: "1234",
        dateAdded: new Date().toISOString().split("T")[0],
        id,
      };
      users.push(newUser);
      await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
      return res.json({ success: true, user: newUser });
    } catch (err) {
      console.error("Error in /api/users:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

/////  EDIT EMPLOYEE DETAILS ////
app.put("/api/team-members/:id", async (req, res) => {
  const id = req.params.id;
  const updates = req.body;

  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    const users = JSON.parse(data);
    const index = users.findIndex((user) => String(user.id) === String(id));
    if (index === -1) {
      return res.status(404).json({ message: "User not found" });
    }

    users[index] = { ...users[index], ...updates };
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");

    res.json(users[index]);
  } catch (err) {
    console.error("Error updating user:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// FOR ADMIN/MANGER
app.get(
  "/api/employees",
  authenticateToken,
  authorizeRoles("Admin", "Manager"),
  async (req, res) => {
    try {
      const data = await fs.readFile(USERS_FILE, "utf8");
      let employees = [];
      try {
        const parsed = data.trim() === "" ? [] : JSON.parse(data);
        employees = Array.isArray(parsed) ? parsed : [];
      } catch {
        console.warn(
          "Invalid JSON in employees.json, initializing empty array",
        );
      }

      if (req.user.role === "Manager" && req.user.department) {
        const beforeFilterCount = employees.length;
        employees = employees.filter(
          (emp) => emp.department === req.user.department,
        );
      } else {
        // unhandled
      }

      const sanitizedEmployees = employees.map(({ password, ...rest }) => rest);

      res.json({ success: true, employees: sanitizedEmployees });
    } catch (err) {
      console.error("Error in /api/employees:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to load employees" });
    }
  },
);

app.get("/api/lightning-balance", authenticateToken, async (req, res) => {
  try {
    const wallets = await getBlinkWallets();
    const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
    res.json({ success: true, balanceSats: btcWallet.balance });
  } catch (err) {
    console.error("Failed to fetch lightning balance:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch balance" });
  }
});

// GET DRAFTS
app.get("/api/drafts", authenticateToken, async (req, res) => {
  try {
    const userRole = req.user.role;
    const userDepartment = req.user.department;

    let drafts = [];
    try {
      const data = await fs.readFile(DRAFTS_FILE, "utf8");
      drafts = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      drafts = [];
    }

    // Filter drafts by department for non-admin users
    if (userRole !== "Admin") {
      drafts = drafts.filter((draft) => draft.department === userDepartment);
    }

    // Sort drafts by dateCreated descending (most recent first)
    drafts.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));

    res.json({ success: true, drafts });
  } catch (err) {
    console.error("Error retrieving drafts:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to retrieve drafts." });
  }
});

// NEW DRAFT
app.post("/api/drafts", authenticateToken, async (req, res) => {
  try {
    const {
      title,
      recipientEmail,
      company,
      contact,
      recipientLightningAddress,
      amount,
      note,
    } = req.body;

    // Basic validation
    if (!title || typeof title !== "string" || title.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Draft title is required and must be a non-empty string.",
      });
    }

    if (
      !recipientEmail ||
      typeof recipientEmail !== "string" ||
      recipientEmail.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Recipient email is required and must be a non-empty string.",
      });
    }

    if (!company || typeof company !== "string" || company.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Company is required and must be a non-empty string.",
      });
    }

    if (!contact || typeof contact !== "string" || contact.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Contact is required and must be a non-empty string.",
      });
    }

    if (
      !recipientLightningAddress ||
      typeof recipientLightningAddress !== "string" ||
      recipientLightningAddress.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Recipient Lightning Address is required and must be a non-empty string.",
      });
    }

    if (amount === undefined || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount is required and must be a positive number.",
      });
    }

    // Validate user department from authenticated token
    if (!req.user.department) {
      return res.status(400).json({
        success: false,
        message: "User department is required.",
      });
    }

    // Create new draft object
    const newDraft = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      title: title.trim(),
      recipientEmail: recipientEmail.trim(),
      company: company.trim(),
      contact: contact.trim(),
      recipientLightningAddress: recipientLightningAddress.trim(),
      amount: Number(amount),
      note: note ? note.trim() : "",
      createdBy: req.user.email,
      department: req.user.department,
      dateCreated: new Date().toISOString(),
      status: "pending",
    };

    // Read existing drafts from file
    let drafts = [];
    try {
      const data = await fs.readFile(DRAFTS_FILE, "utf8");
      drafts = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      drafts = [];
    }

    // Save new draft
    drafts.push(newDraft);
    await fs.writeFile(DRAFTS_FILE, JSON.stringify(drafts, null, 2));

    // Respond with success and new draft
    res.json({ success: true, draft: newDraft });
  } catch (err) {
    console.error("Error saving draft:", err);
    res.status(500).json({ success: false, message: "Failed to save draft." });
  }
});

// APPROVE DRAFT
app.post(
  "/api/drafts/approve",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  async (req, res) => {
    const { draftId } = req.body;

    try {
      // 1. Load drafts
      const draftsData = await fs.readFile(DRAFTS_FILE, "utf8");
      let drafts = draftsData.trim() ? JSON.parse(draftsData) : [];

      // 2. Find the draft
      const draftIndex = drafts.findIndex((d) => d.id === draftId);
      if (draftIndex === -1) {
        return res
          .status(404)
          .json({ success: false, message: "Draft not found." });
      }

      // 3. Get recipient, amount, memo
      const draft = drafts[draftIndex];
      const lightningAddress =
        draft.recipientLightningAddress || draft.lnAddress;
      const amount = Number(draft.amountSats || draft.amount);
      const note = draft.note || draft.memo || "Disrupt Portal Payment";

      if (!lightningAddress || !amount) {
        return res.status(400).json({
          success: false,
          message: "Draft is missing a Lightning Address or amount.",
        });
      }

      // 4. Resolve Lightning Address to invoice
      let invoice;
      try {
        const lnurlResp = await lnurlPay.requestInvoice({
          lnUrlOrAddress: lightningAddress,
          tokens: amount,
          comment: note,
        });
        invoice = lnurlResp.invoice;
        if (!invoice)
          throw new Error("Could not resolve invoice from Lightning Address.");
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to resolve Lightning Address: " + err.message,
        });
      }

      // 5. Get BTC wallet ID from Blink (GraphQL)
      let walletId;
      try {
        const apiKey = process.env.BLINK_API_KEY;
        const walletQuery = `
          query {
            me {
              defaultAccount {
                wallets {
                  id
                  walletCurrency
                }
              }
            }
          }
        `;
        const walletResp = await axios.post(
          "https://api.blink.sv/graphql",
          { query: walletQuery },
          {
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": apiKey,
            },
          },
        );
        const wallets = walletResp.data.data.me.defaultAccount.wallets;
        const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
        if (!btcWallet) throw new Error("No BTC wallet found");
        walletId = btcWallet.id;
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch wallet: " + err.message,
        });
      }

      // 6. Decode the invoice for payment_hash
      let paymentHash = null;
      try {
        const decoded = bolt11.decode(invoice);
        paymentHash =
          decoded.tags.find((tag) => tag.tagName === "payment_hash")?.data ||
          null;
      } catch (err) {
        paymentHash = null;
      }

      // 7. Pay the invoice via Blink (GraphQL)
      let paymentResult = null;
      try {
        const apiKey = process.env.BLINK_API_KEY;
        const mutation = `
          mutation payInvoice($input: LnInvoicePaymentInput!) {
            lnInvoicePaymentSend(input: $input) {
              status
              errors { message }
            }
          }
        `;
        const variables = {
          input: {
            walletId,
            paymentRequest: invoice,
          },
        };
        const payResp = await axios.post(
          "https://api.blink.sv/graphql",
          { query: mutation, variables },
          {
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": apiKey,
            },
          },
        );
        const result = payResp.data.data.lnInvoicePaymentSend;
        if (result.errors && result.errors.length > 0) {
          return res.json({
            success: false,
            message: result.errors[0].message,
          });
        }
        paymentResult = result;
      } catch (err) {
        let blinkError = "";
        if (err.response && err.response.data) {
          blinkError = JSON.stringify(err.response.data);
        }
        return res.status(500).json({
          success: false,
          message: "Payment failed: " + err.message + " " + blinkError,
        });
      }

      // 8. Approve the draft
      draft.status = "approved";
      draft.approvedAt = new Date().toISOString();
      draft.approvedBy = req.user.email;

      // 9. Save updated drafts
      await fs.writeFile(DRAFTS_FILE, JSON.stringify(drafts, null, 2));

      // 10. Add to transactions
      let transactions = [];
      try {
        const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
        transactions = data.trim() ? JSON.parse(data) : [];
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }

      const transaction = {
        id: paymentHash || Date.now(),
        date: new Date().toISOString(),
        type: "lightning",
        receiver: draft.company || draft.contact || "Unknown",
        lightningAddress: lightningAddress || null,
        invoice: invoice || null,
        amount: amount || 0,
        currency: "SATS",
        note: note || "",
        direction: "SENT",
        status: paymentResult?.status || "complete",
        paymentHash: paymentHash,
        approvedStatus: draft.status,
        approvedAt: draft.approvedAt,
        approvedBy: draft.approvedBy,
      };

      transactions.unshift(transaction);
      await fs.writeFile(
        TRANSACTIONS_FILE,
        JSON.stringify(transactions, null, 2),
      );

      res.json({ success: true, transaction });
    } catch (err) {
      console.error("Error approving draft:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  },
);

app.post(
  "/api/drafts/decline",
  authenticateToken,
  authorizeRoles(...authorizedRoles),
  async (req, res) => {
    const { draftId } = req.body;

    if (!draftId || typeof draftId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "Valid draftId is required." });
    }

    try {
      const draftsData = await fs.readFile(DRAFTS_FILE, "utf8");
      let drafts = draftsData.trim() ? JSON.parse(draftsData) : [];

      const draftIndex = drafts.findIndex((d) => d.id === draftId);
      if (draftIndex === -1) {
        return res
          .status(404)
          .json({ success: false, message: "Draft not found" });
      }

      drafts[draftIndex].status = "declined";
      drafts[draftIndex].declinedAt = new Date().toISOString();
      drafts[draftIndex].declinedBy = req.user.email;

      await fs.writeFile(DRAFTS_FILE, JSON.stringify(drafts, null, 2));

      res.json({ success: true });
    } catch (err) {
      console.error("Error declining draft:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

app.get("/api/transactions", async (req, res) => {
  try {
    let blinkTxns = [];
    try {
      blinkTxns = await getBlinkTransactions();
    } catch (blinkErr) {
      console.error("Error fetching Blink transactions:", blinkErr.message);
    }

    let localTxns = [];
    try {
      const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
      if (data.trim()) {
        const parsed = JSON.parse(data);
        localTxns = Array.isArray(parsed) ? parsed : parsed.transactions || [];
      }
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    const getReceiver = (txn) =>
      txn.recipient_name ||
      txn.receiver ||
      txn.contact ||
      txn.company ||
      txn.memo ||
      "Unknown";

    const mergedTxns = blinkTxns.map((blinkTxn) => {
      const local = localTxns.find((t) => t.id === blinkTxn.id);

      let amount, currency;
      if (blinkTxn.settlementCurrency === "BTC") {
        amount = blinkTxn.settlementAmount; // sats
        currency = "SATS";
      } else if (blinkTxn.settlementCurrency === "USD") {
        amount = (blinkTxn.settlementAmount / 100).toFixed(2); // dollars
        currency = "USD";
      } else {
        amount = blinkTxn.settlementAmount;
        currency = blinkTxn.settlementCurrency || "";
      }

      return {
        id: blinkTxn.id,
        date: blinkTxn.createdAt,
        receiver: local ? getReceiver(local) : blinkTxn.memo || "Unknown",
        amount,
        currency,
        note: blinkTxn.memo || "",
        type: "lightning",
      };
    });

    // Include local transactions not in Blink
    const blinkTxnIds = new Set(blinkTxns.map((txn) => txn.id));
    const uniqueLocalTxns = localTxns.filter((txn) => !blinkTxnIds.has(txn.id));

    const formattedLocalTxns = uniqueLocalTxns.map((txn) => ({
      id: txn.id,
      date: txn.date,
      receiver: getReceiver(txn),
      amount: txn.amount,
      currency: txn.currency,
      note: txn.note || "",
      type: txn.type || "local",
    }));

    const allTxns = [...mergedTxns, ...formattedLocalTxns];

    // Sort by date descending
    allTxns.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      transactions: allTxns,
    });
  } catch (err) {
    console.error("Error reading transactions:", err);
    res.status(500).json({
      success: false,
      message: "Error reading transactions",
      error: err.message,
    });
  }
});

app.post("/api/transactions", authenticateToken, async (req, res) => {
  const { recipient, amountSats, memo } = req.body;
  const apiKey = BLINK_API_KEY;

  if (!recipient || !amountSats) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: recipient and amountSats",
    });
  }

  try {
    // Fetch wallets from Blink API
    const wallets = await getBlinkWallets();
    const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");

    if (!btcWallet) {
      return res.status(400).json({
        success: false,
        message: "No BTC wallet found",
      });
    }

    // Prepare GraphQL mutation for Lightning Address payment
    const query = `
      mutation lnLightningAddressPaymentSend($input: LnLightningAddressPaymentInput!) {
        lnLightningAddressPaymentSend(input: $input) {
          status
          errors { message }
          payment {
            id
            status
            paymentHash
          }
        }
      }
    `;

    const variables = {
      input: {
        walletId: btcWallet.id,
        paymentRequest: null,
        lnAddress: recipient,
        amount: Number(amountSats),
        memo: memo || "",
      },
    };

    // Send payment request to Blink API
    const response = await axios.post(
      "https://api.blink.sv/graphql",
      { query, variables },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
      },
    );

    const result = response.data.data.lnLightningAddressPaymentSend;

    if (result.errors && result.errors.length > 0) {
      return res.json({
        success: false,
        message: result.errors[0].message,
      });
    }

    // Prepare new transaction object
    const newTxn = {
      id: result.payment.id,
      date: new Date().toISOString(),
      receiver: recipient,
      amount: amountSats,
      currency: "SATS",
      note: memo || "",
      type: "lightning",
      direction: "SENT",
      status: result.payment.status,
    };

    // Read existing transactions
    let txns = [];
    try {
      const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
      txns = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
      // If file doesn't exist, start with empty array
      txns = [];
    }

    // Add new transaction to beginning (newest first)
    txns.unshift(newTxn);

    // Write updated transactions back to file
    await fs.writeFile(TRANSACTIONS_FILE, JSON.stringify(txns, null, 2));

    // Respond with success and payment info
    res.json({
      success: true,
      payment: result.payment,
      transaction: newTxn,
    });
  } catch (err) {
    console.error("Error processing Lightning payment:", err);
    res.status(500).json({
      success: false,
      message: "Failed to process Lightning payment",
      error: err.message,
    });
  }
});

// GET EXCHANGE RATE
app.get("/api/btc-usd-rate", authenticateToken, async (req, res) => {
  const url = "https://api.blink.sv/graphql";
  const query = { query: "query { btcPrice { base offset } }" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    const result = await response.json();
    if (
      result.data &&
      result.data.btcPrice &&
      typeof result.data.btcPrice.base === "number" &&
      typeof result.data.btcPrice.offset === "number"
    ) {
      const { base, offset } = result.data.btcPrice;
      const rate = base / Math.pow(10, offset);
      return res.json({ success: true, rate });
    }
    res.json({ success: false, rate: null });
  } catch (err) {
    res.json({ success: false, rate: null, error: err.message });
  }
});

app.post("/api/transactions/local", authenticateToken, async (req, res) => {
  try {
    const newTransaction = req.body;

    // Read existing transactions
    let transactions = [];
    try {
      const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
      if (data.trim()) {
        const parsed = JSON.parse(data);
        transactions = Array.isArray(parsed)
          ? parsed
          : parsed.transactions || [];
      }
    } catch (err) {
      if (err.code === "ENOENT") {
      } else {
        throw err;
      }
    }

    // Add new transaction with ID and timestamp
    const transactionWithId = {
      id: `txn_${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      ...newTransaction,
    };

    // Add to beginning of array (newest first)
    transactions.unshift(transactionWithId);

    // Write back to file as a raw array
    await fs.writeFile(
      TRANSACTIONS_FILE,
      JSON.stringify(transactions, null, 2),
      { flag: "w" },
    );

    res.json({
      success: true,
      transaction: transactionWithId,
    });
  } catch (err) {
    console.error("Error saving transaction:", err);
    res.status(500).json({
      success: false,
      message: "Failed to save transaction",
    });
  }
});

// Set up nodemailer (replace with your actual email service and credentials)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email required." });
  }

  let users;
  try {
    const usersData = await fs.readFile(USERS_FILE, "utf-8");
    users = JSON.parse(usersData);
    if (!Array.isArray(users)) {
      throw new Error("Users data is not an array");
    }
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to load users." });
  }

  const user = users.find((u) => u.email === email);
  if (!user) {
    // Avoid user enumeration by always responding success
    return res.json({
      success: true,
      message: "If that email exists, a reset PIN has been sent.",
    });
  }

  // Generate a new 4-digit PIN (string with leading zeros if needed)
  const newPin = Math.floor(1000 + Math.random() * 9000).toString();

  // TODO: Ideally hash the password before storing, but for now storing plaintext as per your choice
  user.password = newPin;

  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to update user password." });
  }

  try {
    await transporter.sendMail({
      from: '"Disrupt Portal" <support@disrupt.com>',
      to: user.email,
      subject: "Your New Password",
      text: `Your new password is: ${newPin}\n\nPlease log in.`,
    });

    res.json({
      success: true,
      message: "If that email exists, a reset PIN has been sent.",
    });
  } catch (err) {
    console.error("Failed to send email:", err);
    res.status(500).json({ success: false, message: "Failed to send email." });
  }
});

// Suppliers
app.get("/api/suppliers", authenticateToken, async (req, res) => {
  try {
    const data = await fs.readFile(SUPPLIERS_FILE, "utf8");
    const suppliers = data.trim() === "" ? [] : JSON.parse(data);
    res.json({ success: true, suppliers });
  } catch (err) {
    console.error("Failed to load suppliers:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load suppliers." });
  }
});

// Add Supplier
app.post("/api/suppliers", authenticateToken, async (req, res) => {
  const { company, contact, email, lightningAddress, note } = req.body;
  if (!company || !contact || !email || !lightningAddress) {
    return res.status(400).json({
      success: false,
      message: "Company, contact, email, and lightning address are required.",
    });
  }

  try {
    let suppliers = [];
    try {
      const data = await fs.readFile(SUPPLIERS_FILE, "utf8");
      suppliers = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    if (
      suppliers.some(
        (s) => s.email === email || s.lightningAddress === lightningAddress,
      )
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Supplier with this email or lightning address already exists.",
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
    suppliers.push(newSupplier);

    await fs.writeFile(SUPPLIERS_FILE, JSON.stringify(suppliers, null, 2));
    res.json({ success: true, supplier: newSupplier });
  } catch (err) {
    console.error("Error adding supplier:", err);
    res.status(500).json({ success: false, message: "Error adding supplier." });
  }
});

// FOR DRAFT MODAL
app.get("/api/suppliers/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await fs.readFile(SUPPLIERS_FILE, "utf8");
    const suppliers = data.trim() ? JSON.parse(data) : [];

    const supplier = suppliers.find((s) => s.id === id);
    if (!supplier) {
      return res
        .status(404)
        .json({ success: false, message: "Supplier not found." });
    }

    res.json({ success: true, supplier });
  } catch (err) {
    console.error("Failed to load supplier:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load supplier." });
  }
});

// Remove Supplier
app.delete("/api/suppliers/:id", authenticateToken, async (req, res) => {
  const supplierId = req.params.id;
  try {
    let suppliers = [];
    try {
      const data = await fs.readFile(SUPPLIERS_FILE, "utf8");
      suppliers = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    const originalLength = suppliers.length;
    suppliers = suppliers.filter((s) => s.id !== supplierId);

    if (suppliers.length === originalLength) {
      return res
        .status(404)
        .json({ success: false, message: "Supplier not found." });
    }

    await fs.writeFile(SUPPLIERS_FILE, JSON.stringify(suppliers, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("Error removing supplier:", err);
    res
      .status(500)
      .json({ success: false, message: "Error removing supplier." });
  }
});

//// EDIT SUPPLIER /////
app.put("/api/suppliers/:id", async (req, res) => {
  const id = req.params.id;
  const updates = req.body;

  try {
    const data = await fs.readFile(SUPPLIERS_FILE, "utf8");
    const suppliers = JSON.parse(data);

    const index = suppliers.findIndex((s) => String(s.id) === String(id));
    if (index === -1) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    const originalSupplier = suppliers[index];
    suppliers[index] = {
      ...originalSupplier,
      ...updates,
      id: originalSupplier.id,
      createdAt: originalSupplier.createdAt,
    };

    await fs.writeFile(
      SUPPLIERS_FILE,
      JSON.stringify(suppliers, null, 2),
      "utf8",
    );

    res.json(suppliers[index]);
  } catch (err) {
    console.error("Error updating supplier:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

//// NEW PAYMENT /////
app.post("/api/pay", authenticateToken, async (req, res) => {
  try {
    const {
      recipientType,
      recipientId,
      contact,
      company,
      email,
      lightningAddress,
      paymentAmount,
      paymentNote,
      taxWithholding,
    } = req.body;

    // Validate required fields
    if (!recipientType || !recipientId || !paymentAmount) {
      return res.status(400).json({
        success: false,
        message: "Missing recipient type, recipient ID, or amount.",
      });
    }

    if (!contact || !company) {
      return res.status(400).json({
        success: false,
        message: "Missing contact or company information.",
      });
    }

    if (!lightningAddress) {
      return res.status(400).json({
        success: false,
        message: "Recipient does not have a Lightning Address.",
      });
    }

    const amount = Number(paymentAmount);
    const note = paymentNote || "";

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment amount.",
      });
    }

    // Lookup recipient for validation (optional but recommended)
    let recipient;
    if (recipientType === "employee") {
      recipient = await getEmployeeById(recipientId);
    } else if (recipientType === "supplier") {
      recipient = await getSupplierById(recipientId);
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid recipient type.",
      });
    }

    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: "Recipient not found.",
      });
    }

    // Handle tax withholding logic
    const isTaxWithholding = taxWithholding && taxWithholding.applied;
    let employeeInvoice, taxInvoice;
    let employeeAmount = amount;
    let taxAmount = 0;

    if (isTaxWithholding) {
      employeeAmount = taxWithholding.netAmount;
      taxAmount = taxWithholding.taxAmount;
    }

    // Resolve Lightning Address to invoice for employee payment
    try {
      const lnurlResp = await lnurlPay.requestInvoice({
        lnUrlOrAddress: lightningAddress,
        tokens: employeeAmount,
        comment: note,
      });
      employeeInvoice = lnurlResp.invoice;
      if (!employeeInvoice) {
        throw new Error("Could not resolve invoice from Lightning Address.");
      }
    } catch (err) {
      console.error("LNURL-pay error for employee:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to resolve employee Lightning Address: " + err.message,
      });
    }

    // If tax withholding, resolve tax invoice
    if (isTaxWithholding && taxAmount > 0) {
      try {
        const taxLnurlResp = await lnurlPay.requestInvoice({
          lnUrlOrAddress: taxWithholding.taxAddress,
          tokens: taxAmount,
          comment: `Tax withholding for ${contact} - ${note}`,
        });
        taxInvoice = taxLnurlResp.invoice;
        if (!taxInvoice) {
          throw new Error("Could not resolve tax withholding invoice.");
        }
      } catch (err) {
        console.error("LNURL-pay error for tax:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to resolve tax Lightning Address: " + err.message,
        });
      }
    }

    // Fetch BTC wallet ID from Blink
    let walletId;
    try {
      const walletQuery = `
        query {
          me {
            defaultAccount {
              wallets {
                id
                walletCurrency
              }
            }
          }
        }
      `;
      const walletResp = await axios.post(
        "https://api.blink.sv/graphql",
        { query: walletQuery },
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": BLINK_API_KEY,
          },
        },
      );
      const wallets = walletResp.data.data.me.defaultAccount.wallets;
      const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
      if (!btcWallet) throw new Error("No BTC wallet found");
      walletId = btcWallet.id;
    } catch (err) {
      console.error("Failed to fetch wallet:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch wallet: " + err.message,
      });
    }

    // Decode employee invoice to get payment_hash
    let employeePaymentHash = null;
    try {
      const decodedInvoice = bolt11.decode(employeeInvoice);
      employeePaymentHash =
        decodedInvoice.tags.find((t) => t.tagName === "payment_hash")?.data ||
        null;
    } catch (err) {
      console.warn("Failed to decode employee invoice:", err);
    }

    // Pay the employee invoice via Blink
    let employeePaymentResult;
    try {
      const mutation = `
        mutation payInvoice($input: LnInvoicePaymentInput!) {
          lnInvoicePaymentSend(input: $input) {
            status
            errors { message }
          }
        }
      `;
      const variables = {
        input: {
          walletId,
          paymentRequest: employeeInvoice,
        },
      };
      const payResp = await axios.post(
        "https://api.blink.sv/graphql",
        { query: mutation, variables },
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": BLINK_API_KEY,
          },
        },
      );

      const result = payResp.data.data.lnInvoicePaymentSend;
      if (result.errors && result.errors.length > 0) {
        return res.json({ success: false, message: result.errors[0].message });
      }
      employeePaymentResult = result;
    } catch (err) {
      let blinkError = "";
      if (err.response && err.response.data) {
        blinkError = JSON.stringify(err.response.data);
      }
      console.error("Employee payment failed:", err);
      return res.status(500).json({
        success: false,
        message: "Employee payment failed: " + err.message + " " + blinkError,
      });
    }

    // Handle tax payment if withholding is applied
    let taxPaymentResult = null;
    let taxPaymentHash = null;

    if (isTaxWithholding && taxInvoice) {
      try {
        const decodedTaxInvoice = bolt11.decode(taxInvoice);
        taxPaymentHash =
          decodedTaxInvoice.tags.find((t) => t.tagName === "payment_hash")
            ?.data || null;
      } catch (err) {
        console.warn("Failed to decode tax invoice:", err);
      }

      try {
        const mutation = `
          mutation payInvoice($input: LnInvoicePaymentInput!) {
            lnInvoicePaymentSend(input: $input) {
              status
              errors { message }
            }
          }
        `;
        const variables = {
          input: {
            walletId,
            paymentRequest: taxInvoice,
          },
        };
        const taxPayResp = await axios.post(
          "https://api.blink.sv/graphql",
          { query: mutation, variables },
          {
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": BLINK_API_KEY,
            },
          },
        );

        const taxResult = taxPayResp.data.data.lnInvoicePaymentSend;
        if (taxResult.errors && taxResult.errors.length > 0) {
          console.error("Tax payment failed:", taxResult.errors[0].message);
          // Continue with employee payment success even if tax fails
        } else {
          taxPaymentResult = taxResult;
        }
      } catch (err) {
        console.error("Tax withholding payment failed:", err);
        // Continue with employee payment success even if tax fails
      }
    }

    // Read existing transactions
    let transactions = [];
    try {
      const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
      transactions = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error("Failed to read transactions file:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to read transactions.",
        });
      }
    }

    // Create employee transaction record
    const employeeTransaction = {
      id: employeePaymentHash || Date.now(),
      date: new Date().toISOString(),
      type: "payment",
      recipientType,
      recipientId,
      contact,
      company,
      lightningAddress,
      invoice: employeeInvoice,
      amount: employeeAmount,
      currency: "SATS",
      note: isTaxWithholding ? `${note} (Net after tax withholding)` : note,
      direction: "SENT",
      status: (employeePaymentResult?.status || "SUCCESS").toUpperCase(),
      paymentHash: employeePaymentHash,
      taxWithholding: isTaxWithholding
        ? {
            originalAmount: taxWithholding.originalAmount,
            taxAmount: taxAmount,
            netAmount: employeeAmount,
          }
        : null,
    };

    // Create tax transaction record if applicable
    let taxTransaction = null;
    if (isTaxWithholding && taxPaymentResult) {
      taxTransaction = {
        id: taxPaymentHash || `tax_${Date.now()}`,
        date: new Date().toISOString(),
        type: "tax_withholding",
        recipientType: "government",
        recipientId: "tax_authority",
        contact: "Tax Authority",
        company: "Government",
        lightningAddress: taxWithholding.taxAddress,
        invoice: taxInvoice,
        amount: taxAmount,
        currency: "SATS",
        note: `Tax withholding for ${contact} - ${note}`,
        direction: "SENT",
        status: (taxPaymentResult?.status || "SUCCESS").toUpperCase(),
        paymentHash: taxPaymentHash,
        relatedEmployeePayment: employeePaymentHash,
      };
    }

    // Save transactions
    transactions.unshift(employeeTransaction);
    if (taxTransaction) {
      transactions.unshift(taxTransaction);
    }
    try {
      await fs.writeFile(
        TRANSACTIONS_FILE,
        JSON.stringify(transactions, null, 2),
      );
    } catch (err) {
      console.error("Failed to write transactions file:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save transaction.",
      });
    }

    // Respond success
    const response = {
      success: true,
      employeeTransaction,
      taxTransaction: taxTransaction || null,
      taxWithholding: isTaxWithholding
        ? {
            applied: true,
            originalAmount: taxWithholding.originalAmount,
            employeeAmount: employeeAmount,
            taxAmount: taxAmount,
            taxPaymentSuccess: !!taxPaymentResult,
          }
        : null,
    };

    return res.json(response);
  } catch (err) {
    console.error("Internal server error in /api/pay:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// PAY INVOICE
app.post("/api/pay-invoice", authenticateToken, async (req, res) => {
  const { invoice, note, receiverName, lightningAddress } = req.body;

  if (!invoice) {
    return res
      .status(400)
      .json({ success: false, message: "Missing invoice." });
  }

  // Step 1: Fetch BTC wallet ID from Blink
  let walletId;
  try {
    const walletQuery = `
        query {
          me {
            defaultAccount {
              wallets {
                id
                walletCurrency
              }
            }
          }
        }
      `;
    const walletResp = await axios.post(
      "https://api.blink.sv/graphql",
      { query: walletQuery },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": BLINK_API_KEY,
        },
      },
    );
    const wallets = walletResp.data.data.me.defaultAccount.wallets;
    const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
    if (!btcWallet) throw new Error("No BTC wallet found");
    walletId = btcWallet.id;
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet: " + err.message,
    });
  }

  // Step 2: Decode invoice to extract payment_hash, amount
  let paymentHash = null;
  let amount = 0;
  let currency = "SATS";
  let receiver =
    receiverName && receiverName.trim() !== "" ? receiverName.trim() : null;

  try {
    const decodedInvoice = bolt11.decode(invoice);

    paymentHash =
      decodedInvoice.tags.find((t) => t.tagName === "payment_hash")?.data ||
      null;

    amount = decodedInvoice.satoshis || 0;

    // Only use payee node key if recipientName not provided
    if (!receiver) {
      const payeeTag = decodedInvoice.tags.find((t) =>
        ["payee_node_key", "pubkey", "node_id"].includes(t.tagName),
      );
      if (payeeTag && payeeTag.data) {
        receiver = payeeTag.data;
      } else {
        receiver = "Unknown";
      }
    }
  } catch (err) {
    console.warn("Failed to decode invoice:", err);
    if (!receiver) receiver = "Unknown";
  }

  // Step 3: Pay the invoice via Blink (simplified mutation)
  let paymentResult;
  try {
    const mutation = `
        mutation payInvoice($input: LnInvoicePaymentInput!) {
          lnInvoicePaymentSend(input: $input) {
            status
            errors { message }
          }
        }
      `;

    const variables = {
      input: {
        walletId,
        paymentRequest: invoice,
      },
    };

    const payResp = await axios.post(
      "https://api.blink.sv/graphql",
      { query: mutation, variables },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": BLINK_API_KEY,
        },
      },
    );

    const result = payResp.data.data.lnInvoicePaymentSend;

    if (result.errors && result.errors.length > 0) {
      return res.json({ success: false, message: result.errors[0].message });
    }

    paymentResult = result;
  } catch (err) {
    let blinkError = "";
    if (err.response && err.response.data) {
      blinkError = JSON.stringify(err.response.data);
    }
    return res.status(500).json({
      success: false,
      message: "Payment failed: " + err.message + " " + blinkError,
    });
  }

  // Step 4: Read existing transactions
  let transactions = [];
  try {
    const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
    transactions = data.trim() ? JSON.parse(data) : [];
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Failed to read transactions file:", err);
      return res
        .status(500)
        .json({ success: false, message: "Failed to read transactions." });
    }
  }

  // Step 5: Create new transaction record
  const transaction = {
    id: paymentHash || Date.now(),
    date: new Date().toISOString(),
    type: "lightning",
    receiver,
    lightningAddress: lightningAddress || null,
    invoice: invoice || null,
    amount: Number(amount) || 0,
    currency,
    note: note || "",
    direction: "SENT",
    status: paymentResult?.status || "complete",
    paymentHash,
  };

  transactions.unshift(transaction);

  // Step 6: Save transactions
  try {
    await fs.writeFile(
      TRANSACTIONS_FILE,
      JSON.stringify(transactions, null, 2),
    );
    return res.json({ success: true, transaction });
  } catch (err) {
    console.error("Failed to write transactions file:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to save transaction." });
  }
});

app.post(
  "/api/batch-payment",
  authenticateToken,
  authorizeRoles("Admin", "Manager"),
  async (req, res) => {
    const { payments } = req.body;
    if (!payments || !Array.isArray(payments)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid batch payment data." });
    }

    const paymentStatuses = [];
    const apiKey = BLINK_API_KEY;
    let walletId;

    try {
      const wallets = await getBlinkWallets();
      const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
      if (!btcWallet) {
        return res
          .status(400)
          .json({ success: false, message: "No BTC wallet found" });
      }
      walletId = btcWallet.id;
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch wallet information.",
      });
    }

    for (const payment of payments) {
      try {
        const { lightningAddress, amount } = payment;
        const query = `
              mutation lnLightningAddressPaymentSend($input: LnLightningAddressPaymentInput!) {
                lnLightningAddressPaymentSend(input: $input) {
                  status
                  errors { message }
                }
              }
            `;
        const variables = {
          input: {
            walletId: walletId,
            lnAddress: lightningAddress,
            amount: Number(amount),
          },
        };

        const response = await axios.post(
          "https://api.blink.sv/graphql",
          { query, variables },
          {
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": apiKey,
            },
          },
        );

        const result = response.data.data.lnLightningAddressPaymentSend;
        if (result.errors && result.errors.length > 0) {
          paymentStatuses.push({
            ...payment,
            status: "Failed",
            error: result.errors[0].message,
          });
        } else {
          paymentStatuses.push({ ...payment, status: "Success" });
        }
      } catch (error) {
        paymentStatuses.push({
          ...payment,
          status: "Failed",
          error: error.message,
        });
      }
    }

    res.json({ success: true, paymentStatuses });
  },
);

app.post("/api/decode-invoice", authenticateToken, (req, res) => {
  const { invoice } = req.body;

  if (!invoice || typeof invoice !== "string") {
    return res.status(400).json({
      success: false,
      error: "Invoice is required and must be a string.",
    });
  }

  try {
    const decoded = bolt11.decode(invoice);

    const expiryTag = decoded.tags.find((t) => t.tagName === "expire_time");
    const expirySeconds = expiryTag ? parseInt(expiryTag.data, 10) : 3600;
    const invoiceTimestamp = decoded.timestamp;
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = invoiceTimestamp + expirySeconds - now;

    res.json({
      success: true,
      decoded,
      expiry: expirySeconds,
      timestamp: invoiceTimestamp,
      expiresIn,
      isExpired: expiresIn <= 0,
    });
  } catch (err) {
    console.error("Error decoding invoice:", err);
    res
      .status(400)
      .json({ success: false, error: "Invalid or unsupported invoice." });
  }
});

// Logout route to revoke refresh token
app.post("/api/logout", (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (refreshToken) {
    refreshTokensStore.delete(refreshToken);
  }
  res.clearCookie("refreshToken");
  res.sendStatus(204);
});

// Serve frontend
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res
      .status(404)
      .json({ success: false, message: "API endpoint not found" });
  }
  next();
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
async function startServer() {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const app = express();
const axios = require("axios");
const crypto = require("crypto");
const { decode } = require("light-bolt11-decoder");
const bolt11 = require("bolt11");
const jwt = require("jsonwebtoken");
const lnurlPay = require("lnurl-pay");
const authorizedRoles = ["Admin", "Manager"];
app.use(express.json());
require("dotenv").config();
app.use(
  cors({
    origin: "http://localhost:5500",
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const fetch = require("node-fetch");
const BLINK_API_KEY = process.env.BLINK_API_KEY;
const BLINK_WALLET_ID = process.env.BLINK_WALLET_ID;

// Path configuration
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");
const SUPPLIERS_FILE = path.join(DATA_DIR, "suppliers.json");
const DEPARTMENTS_FILE = path.join(DATA_DIR, "departments.json");
const DRAFTS_FILE = path.join(DATA_DIR, "drafts.json");
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not defined");
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
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
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

//////// ROUTES ////////

// User Authentication
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const data = await fs.readFile(USERS_FILE, "utf8");
    let users = [];
    try {
      const parsed = data.trim() === "" ? [] : JSON.parse(data);
      users = Array.isArray(parsed) ? parsed : [];
    } catch {
      console.warn("Invalid JSON in users.json, initializing empty array");
    }

    const user = users.find(
      (u) => u.email === email && u.password === password,
    );

    if (user) {
      const tokenPayload = {
        id: user.id,
        email: user.email,
        role: user.role,
        department: user.department, // Include department here
      };

      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });

      res.json({
        success: true,
        token,
        message: "Login successful",
      });
    } else {
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }
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

// User Management
app.get(
  "/api/users",
  authenticateToken,
  authorizeRoles("Admin", "Manager", "Employee"), // Adjust roles as needed
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

      // Filter users by department if user is not Admin
      if (req.user.role !== "Admin" && req.user.department) {
        const beforeFilterCount = users.length;
        users = users.filter((user) => user.department === req.user.department);
      } else {
        // unhandled
      }

      // Remove passwords before sending
      const sanitizedUsers = users.map(({ password, ...rest }) => rest);

      // Respond with naked array to match users.json structure
      res.json(sanitizedUsers);
    } catch (err) {
      console.error("Error in /api/users:", err);

      if (err.code === "ENOENT") {
        res.json([]);
      } else {
        res.status(500).json({
          success: false,
          message: "Failed to load users",
          error: err.message,
        });
      }
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

      // Check if department exists
      if (!departments.includes(department)) {
        return res
          .status(404)
          .json({ success: false, message: "Department not found." });
      }

      // Remove the department
      departments = departments.filter((dep) => dep !== department);

      // Save updated list
      await fs.writeFile(
        DEPARTMENTS_FILE,
        JSON.stringify(departments, null, 2),
      );

      res.json({ success: true, departments });
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
    console.log("Received /api/users payload:", req.body);
    try {
      const { action, email, ...rest } = req.body;
      console.log("rest object:", rest);
      // Ensure req.user is populated by authenticateToken middleware
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
      console.log("New user object to save:", newUser);
      users.push(newUser);
      await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
      return res.json({ success: true, user: newUser });
    } catch (err) {
      console.error("Error in /api/users:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

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
    if (userRole !== "admin") {
      drafts = drafts.filter((draft) => draft.department === userDepartment);
    }

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
    const newDraft = req.body;

    // Basic validation
    if (!newDraft.title || typeof newDraft.title !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "Draft title is required." });
    }

    // Add department from authenticated user info
    if (!req.user.department) {
      return res
        .status(400)
        .json({ success: false, message: "User department is required." });
    }

    newDraft.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    newDraft.createdBy = req.user.email;
    newDraft.department = req.user.department; // Assign department here
    newDraft.dateCreated = new Date().toISOString();
    newDraft.status = "pending";

    let drafts = [];
    try {
      const data = await fs.readFile(DRAFTS_FILE, "utf8");
      drafts = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      drafts = [];
    }

    drafts.push(newDraft);
    await fs.writeFile(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
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
        receiver: draft.recipientName || draft.name || "Unknown",
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

app.get("/api/transactions", authenticateToken, async (req, res) => {
  try {
    // 1. Read local transactions.json
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

    // 2. Normalize transactions to ensure 'receiver' field exists
    localTxns = localTxns.map((txn) => ({
      ...txn,
      receiver: txn.receiver || txn.recipientName || "Unknown",
    }));

    // 3. Filter for valid, real transactions
    const validTxns = localTxns
      .filter(
        (txn) =>
          typeof txn.date === "string" &&
          !isNaN(new Date(txn.date).getTime()) &&
          txn.receiver &&
          txn.receiver !== "Unknown",
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20); // Only show the 20 most recent

    // 4. Send response
    res.json({
      success: true,
      transactions: validTxns,
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

  // Get your BTC wallet ID from Blink
  let wallets;
  try {
    wallets = await getBlinkWallets();
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch wallets" });
  }
  const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
  if (!btcWallet) {
    return res
      .status(400)
      .json({ success: false, message: "No BTC wallet found" });
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

  try {
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
      return res.json({ success: false, message: result.errors[0].message });
    }

    // Save to transactions.json (optional, but recommended)
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
    // Read, append, and write
    let txns = [];
    try {
      const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
      txns = data.trim() ? JSON.parse(data) : [];
    } catch (err) {}
    txns.push(newTxn);
    await fs.writeFile(TRANSACTIONS_FILE, JSON.stringify(txns, null, 2));

    res.json({ success: true, payment: result.payment });
  } catch (err) {
    res.json({ success: false, message: err.message });
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

app.post("/api/transactions", authenticateToken, async (req, res) => {
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
      message: "Error saving transaction",
      error: err.message,
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

app.post("/api/forgot-password", authenticateToken, async (req, res) => {
  const { email } = req.body;
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
  if (!user)
    return res.status(404).json({ success: false, message: "User not found" });

  // Generate a new 4-digit PIN
  const newPin = Math.floor(1000 + Math.random() * 9000).toString();

  // Update the user's password
  user.password = newPin;

  // Save updated users array back to file
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to update user." });
  }

  // Send the email
  try {
    await transporter.sendMail({
      from: '"Disrupt Portal" <noreply@company.com>',
      to: user.email,
      subject: "Your New Password",
      text: `Your new password is: ${newPin}`,
    });
    res.json({ success: true });
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
app.post(
  "/api/suppliers",
  authenticateToken,
  express.json(),
  async (req, res) => {
    const { name, contact, email, lightningAddress, note } = req.body;
    if (!name || !contact || !email || !lightningAddress) {
      return res.status(400).json({
        success: false,
        message: "Name, contact, email, and lightning address are required.",
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
        name,
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
      res
        .status(500)
        .json({ success: false, message: "Error adding supplier." });
    }
  },
);

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

// NEW PAYMENT
app.post("/api/pay", authenticateToken, express.json(), async (req, res) => {
  try {
    const { recipientType, recipientId, paymentAmount, paymentNote } = req.body;

    // Validate required fields
    if (!recipientType || !recipientId || !paymentAmount) {
      return res.status(400).json({
        success: false,
        message: "Missing recipient type, recipient ID, or amount.",
      });
    }

    // Lookup recipient - replace these with your actual data access methods
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

    if (!recipient.lightningAddress) {
      return res.status(400).json({
        success: false,
        message: "Recipient does not have a Lightning Address.",
      });
    }

    const name = recipient.name;
    const lightningAddress = recipient.lightningAddress;
    const amount = paymentAmount;
    const note = paymentNote || "";

    // 1. Resolve Lightning Address to invoice via LNURL-pay
    let invoice;
    try {
      const lnurlResp = await lnurlPay.requestInvoice({
        lnUrlOrAddress: lightningAddress,
        tokens: parseInt(amount, 10),
        comment: note,
      });
      invoice = lnurlResp.invoice;
      if (!invoice) {
        throw new Error("Could not resolve invoice from Lightning Address.");
      }
    } catch (err) {
      console.error("LNURL-pay error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to resolve Lightning Address: " + err.message,
      });
    }

    // 2. Fetch BTC wallet ID from Blink
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

    // 3. Decode invoice to get payment_hash
    let paymentHash = null;
    try {
      const decodedInvoice = bolt11.decode(invoice);
      paymentHash =
        decodedInvoice.tags.find((t) => t.tagName === "payment_hash")?.data ||
        null;
    } catch (err) {
      console.warn("Failed to decode invoice:", err);
    }

    // 4. Pay the invoice via Blink
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
      console.error("Payment failed:", err);
      return res.status(500).json({
        success: false,
        message: "Payment failed: " + err.message + " " + blinkError,
      });
    }

    // 5. Read existing transactions
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

    // 6. Create new transaction record
    const transaction = {
      id: paymentHash || Date.now(),
      date: new Date().toISOString(),
      type: "payment",
      recipientType,
      recipientId,
      recipientName: name,
      lightningAddress,
      invoice,
      amount: Number(amount) || 0,
      currency: "SATS",
      note,
      direction: "SENT",
      status: paymentResult?.status || "complete",
      paymentHash,
    };

    // 7. Save transactions
    transactions.unshift(transaction);
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

    // 8. Respond success
    return res.json({ success: true, transaction });
  } catch (err) {
    console.error("Internal server error in /api/pay:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

// PAY INVOICE
app.post(
  "/api/pay-invoice",
  authenticateToken,
  express.json(),
  async (req, res) => {
    const { invoice, note, recipientName, name, lightningAddress } = req.body;

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

    // Step 2: Decode invoice to extract payment_hash, receiver, amount
    let paymentHash = null;
    let receiver = recipientName || name || "Unknown";
    let amount = 0;
    let currency = "SATS";

    try {
      const decodedInvoice = bolt11.decode(invoice);

      paymentHash =
        decodedInvoice.tags.find((t) => t.tagName === "payment_hash")?.data ||
        null;

      const payeeTag = decodedInvoice.tags.find((t) =>
        ["payee_node_key", "pubkey", "node_id"].includes(t.tagName),
      );
      if (payeeTag && payeeTag.data) {
        receiver = payeeTag.data;
      }

      amount = decodedInvoice.satoshis || 0;
    } catch (err) {
      console.warn("Failed to decode invoice:", err);
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

// Serve frontend
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

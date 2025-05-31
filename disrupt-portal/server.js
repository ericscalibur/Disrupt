const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const app = express();
app.use(express.json());
require("dotenv").config();

// Path configuration
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");
const SUPPLIERS_FILE = path.join(DATA_DIR, "suppliers.json");

// Middleware to avoid CORS error
app.use(
  cors({
    origin: "http://localhost:5500",
    credentials: true,
  }),
);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Ensure data directory exists and initialize files
async function initDataFiles() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Initialize users.json if it doesn't exist
    try {
      await fs.access(USERS_FILE);
    } catch {
      await fs.writeFile(
        USERS_FILE,
        JSON.stringify(
          {
            users: [
              {
                email: "ceo@company.com",
                password: "1234",
                name: "John Doe",
                role: "Admin",
                department: "Executive",
                address: "ericscalibur@blink.sv",
                dateAdded: new Date().toISOString().split("T")[0],
              },
            ],
          },
          null,
          2,
        ),
      );
    }

    // Initialize transactions.json if it doesn't exist
    try {
      await fs.access(TRANSACTIONS_FILE);
    } catch {
      await fs.writeFile(
        TRANSACTIONS_FILE,
        JSON.stringify(
          {
            transactions: [],
          },
          null,
          2,
        ),
      );
    }
  } catch (err) {
    console.error("Error initializing data files:", err);
  }
}

// User Authentication
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const data = await fs.readFile(USERS_FILE, "utf8");
    let users = [];
    try {
      const parsed = data.trim() === "" ? [] : JSON.parse(data);
      users = Array.isArray(parsed) ? parsed : [];
    } catch (parseError) {
      console.warn("Invalid JSON in users.json, initializing empty array");
    }

    const user = users.find(
      (u) => u.email === email && u.password === password,
    );

    if (user) {
      const { password, ...userData } = user;
      res.json({
        success: true,
        user: userData,
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

// User Management
app.get("/users", async (req, res) => {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    let users = [];
    try {
      const parsed = data.trim() === "" ? [] : JSON.parse(data);
      users = Array.isArray(parsed) ? parsed : [];
    } catch (parseError) {
      console.warn("Invalid JSON in users.json, initializing empty array");
    }

    // Remove passwords before sending
    const sanitizedUsers = users.map(({ password, ...rest }) => rest);

    res.json({
      success: true,
      users: sanitizedUsers,
    });
  } catch (err) {
    console.error("Error in /users:", err);

    if (err.code === "ENOENT") {
      // File doesn't exist - return empty array
      res.json({
        success: true,
        users: [],
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to load users",
        error: err.message,
      });
    }
  }
});

// ADD USER
app.post("/users", async (req, res) => {
  // console.log("Received body:", req.body);

  try {
    const { action, ...rest } = req.body;

    // Read current users
    const data = await fs.readFile(USERS_FILE, "utf8");
    let users = [];
    try {
      const parsed = data.trim() === "" ? [] : JSON.parse(data);
      users = Array.isArray(parsed) ? parsed : [];
    } catch (parseError) {
      console.warn("Invalid JSON in users.json, initializing empty array");
    }

    if (action === "remove") {
      // Remove user by email
      const { email } = rest; // email is in rest when action is "remove"
      const updatedUsers = users.filter((user) => user.email !== email);
      await fs.writeFile(
        USERS_FILE,
        JSON.stringify({ users: updatedUsers }, null, 2),
      );
      return res.json({ success: true });
    } else if (!action) {
      // Add new user (no action means add)
      // Check if user already exists
      if (users.some((user) => user.email === rest.email)) {
        return res
          .status(400)
          .json({ success: false, message: "User already exists" });
      }
      // Add default password and date
      const newUser = {
        ...rest,
        password: "1234", // Default password as per your HTML
        dateAdded: new Date().toISOString().split("T")[0],
      };
      users.push(newUser);
      await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2));
      return res.json({ success: true, user: newUser });
    }

    res.status(400).json({ success: false, message: "Invalid action" });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// REMOVE USER
app.post("/users", async (req, res) => {
  try {
    const { action, email } = req.body;

    if (action === "remove") {
      // Read current users
      const data = await fs.readFile(USERS_FILE, "utf8");
      let users = [];
      try {
        const parsed = data.trim() === "" ? [] : JSON.parse(data);
        users = Array.isArray(parsed) ? parsed : [];
      } catch (parseError) {
        console.warn("Invalid JSON in users.json, initializing empty array");
      }

      // Filter out the user to remove
      const updatedUsers = users.filter((user) => user.email !== email);

      // Save back to file
      await fs.writeFile(
        USERS_FILE,
        JSON.stringify({ users: updatedUsers }, null, 2),
      );

      return res.json({ success: true });
    }

    res.status(400).json({ success: false, message: "Invalid action" });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.get("/employees", async (req, res) => {
  try {
    let employees = [];
    try {
      const data = await fs.readFile(USERS_FILE, "utf8");
      employees = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    res.json({ success: true, employees });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Error loading employees." });
  }
});

// Transaction Management
app.get("/transactions", async (req, res) => {
  try {
    const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
    let transactions = [];
    if (data.trim()) {
      const parsed = JSON.parse(data);
      // Support both formats for backward compatibility
      transactions = Array.isArray(parsed) ? parsed : parsed.transactions || [];
    }
    res.json({
      success: true,
      transactions,
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      res.json({ success: true, transactions: [] });
    } else {
      console.error("Error reading transactions:", err);
      res.status(500).json({
        success: false,
        message: "Error reading transactions",
        error: err.message,
      });
    }
  }
});

app.post("/transactions", async (req, res) => {
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
        console.log("Creating new transactions file");
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

app.post("/forgot-password", async (req, res) => {
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
app.get("/suppliers", async (req, res) => {
  try {
    const data = await fs.readFile(SUPPLIERS_FILE, "utf8");
    const suppliers = data.trim() === "" ? [] : JSON.parse(data);
    res.json({ success: true, suppliers });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to load suppliers." });
  }
});

// Add Supplier
app.post("/suppliers", express.json(), async (req, res) => {
  const { name, contact, email, lightningAddress, note } = req.body;
  if (!name || !contact || !email || !lightningAddress) {
    return res.status(400).json({
      success: false,
      message: "Name, contact, email, and lightning address are required.",
    });
  }

  try {
    // Read existing suppliers
    let suppliers = [];
    try {
      const data = await fs.readFile(SUPPLIERS_FILE, "utf8");
      suppliers = data.trim() ? JSON.parse(data) : [];
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    // Check for duplicates by email or lightning address
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

    // Add new supplier
    const newSupplier = {
      id: "sup" + Date.now(),
      name,
      contact, // NEW
      email,
      lightningAddress,
      note: note || "",
    };
    suppliers.push(newSupplier);

    // Save
    await fs.writeFile(SUPPLIERS_FILE, JSON.stringify(suppliers, null, 2));
    res.json({ success: true, supplier: newSupplier });
  } catch (err) {
    console.error("Error adding supplier:", err);
    res.status(500).json({ success: false, message: "Error adding supplier." });
  }
});

// Remove Supplier
app.delete("/suppliers/:id", async (req, res) => {
  const supplierId = req.params.id;
  try {
    // Read existing suppliers
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

    // Save updated list
    await fs.writeFile(SUPPLIERS_FILE, JSON.stringify(suppliers, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("Error removing supplier:", err);
    res
      .status(500)
      .json({ success: false, message: "Error removing supplier." });
  }
});

// PAY SUPPLIER OR EMPLOYEE
app.post("/pay", express.json(), async (req, res) => {
  const { name, lightningAddress, amount, note } = req.body;
  if (!name || !lightningAddress || !amount) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields." });
  }
  // TODO: Integrate with BlinkAPI here
  // For now, just simulate:
  const transaction = {
    id: "txn_" + Date.now(),
    date: new Date().toISOString(),
    type: "lightning",
    receiver: name,
    lightningAddress,
    amount,
    note: note || "",
  };
  // Save transaction to transactions.json (as before)
  // ... (see previous answers)
  res.json({ success: true, transaction });
});

// PAY INVOICE
app.post("/pay-invoice", express.json(), async (req, res) => {
  const { invoice, note } = req.body;
  if (!invoice) {
    return res
      .status(400)
      .json({ success: false, message: "Missing invoice." });
  }
  // Simulate payment
  const transaction = {
    id: "txn_" + Date.now(),
    date: new Date().toISOString(),
    type: "lightning_invoice",
    receiver: "Invoice Payment",
    invoice,
    amount: "TBD",
    note: note || "",
  };

  // Read existing transactions
  let transactions = [];
  try {
    const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
    transactions = data.trim() ? JSON.parse(data) : [];
  } catch (err) {
    if (err.code !== "ENOENT") throw err; // Ignore file not found
  }

  // Append new transaction
  transactions.push(transaction);

  // Write back to file
  try {
    await fs.writeFile(
      TRANSACTIONS_FILE,
      JSON.stringify(transactions, null, 2),
    );
    res.json({ success: true, transaction });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to write transaction." });
  }
});

// Serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
async function startServer() {
  await initDataFiles();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Data files:`);
    console.log(`- Users: ${USERS_FILE}`);
    console.log(`- Transactions: ${TRANSACTIONS_FILE}`);
  });
}

startServer();

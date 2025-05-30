const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const app = express();
app.use(express.json());
require("dotenv").config();

const PORT = process.env.PORT || 3001;

// Middleware
app.use(
  cors({
    origin: "http://localhost:5500",
    credentials: true,
  }),
);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Path configuration
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");

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

// Transaction Management
app.get("/transactions", async (req, res) => {
  try {
    const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
    const { transactions } = JSON.parse(data);
    res.json({
      success: true,
      transactions: transactions || [],
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      // File doesn't exist - return empty array
      res.json({
        success: true,
        transactions: [],
      });
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
      transactions = JSON.parse(data).transactions || [];
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

    // Write back to file
    await fs.writeFile(
      TRANSACTIONS_FILE,
      JSON.stringify({ transactions }, null, 2),
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

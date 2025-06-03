const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const app = express();
const axios = require("axios");
const { decode } = require("light-bolt11-decoder");
app.use(express.json());
require("dotenv").config();

// Path configuration
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");
const SUPPLIERS_FILE = path.join(DATA_DIR, "suppliers.json");
const DEPARTMENTS_FILE = path.join(DATA_DIR, "departments.json");

async function getBlinkWallets() {
  const apiKey = process.env.BLINK_API_KEY;
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
  const apiKey = process.env.BLINK_API_KEY;
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

// Middleware to avoid CORS error
app.use(
  cors({
    origin: "http://localhost:5500",
    credentials: true,
  }),
);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

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

// GET: Fetch all departments
app.get("/api/departments", async (req, res) => {
  try {
    const data = await fs.readFile(DEPARTMENTS_FILE, "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    console.error(err); // Log the error for debugging
    return res.status(500).json({ error: "Could not read departments." });
  }
});

// POST: Add a new department
app.post("/api/departments", async (req, res) => {
  try {
    const { department } = req.body;
    if (!department) {
      return res.status(400).json({ error: "Department name is required." });
    }

    // Read current departments
    const data = await fs.readFile(DEPARTMENTS_FILE, "utf8");
    let departments = JSON.parse(data);

    // Check for duplicates
    if (departments.includes(department)) {
      return res.status(400).json({ error: "Department already exists." });
    }

    // Add new department
    departments.push(department);

    // Save back to file
    await fs.writeFile(DEPARTMENTS_FILE, JSON.stringify(departments, null, 2));

    res.json({ success: true, departments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add department." });
  }
});

// DELETE: Remove a department
app.delete("/api/departments", async (req, res) => {
  try {
    const { department } = req.body;
    if (!department) {
      return res.status(400).json({ error: "Department name is required." });
    }

    // Read current departments
    const data = await fs.readFile(DEPARTMENTS_FILE, "utf8");
    let departments = JSON.parse(data);

    // Check if department exists
    if (!departments.includes(department)) {
      return res.status(404).json({ error: "Department not found." });
    }

    // Remove the department
    departments = departments.filter((dep) => dep !== department);

    // Save updated list
    await fs.writeFile(DEPARTMENTS_FILE, JSON.stringify(departments, null, 2));

    res.json({ success: true, departments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove department." });
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

app.get("/lightning-balance", async (req, res) => {
  try {
    const wallets = await getBlinkWallets();
    const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
    res.json({ success: true, balanceSats: btcWallet.balance });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch balance" });
  }
});

// Transaction Management
app.get("/transactions", async (req, res) => {
  try {
    // 1. Fetch Blink transactions
    let blinkTxns = [];
    try {
      blinkTxns = await getBlinkTransactions();
    } catch (blinkErr) {
      console.error("Error fetching Blink transactions:", blinkErr.message);
    }

    // 2. Read local transactions.json
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

    const mergedTxns = blinkTxns.map((blinkTxn) => {
      const local = localTxns.find((t) => t.id === blinkTxn.id);
      // Determine if USD or BTC
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
        receiver: local?.recipient_name || blinkTxn.memo || "Unknown",
        amount,
        currency,
        note: blinkTxn.memo || "",
        type: "lightning",
      };
    });

    res.json({
      success: true,
      transactions: mergedTxns,
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

app.post("/new-transaction", async (req, res) => {
  const { recipient, amountSats, memo } = req.body;
  const apiKey = process.env.BLINK_API_KEY;

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

async function submitNewPayment() {
  const recipient = document.getElementById("newPaymentRecipient").value.trim();
  const amountSats = document.getElementById("newPaymentAmount").value.trim();
  const memo = document.getElementById("newPaymentMemo").value.trim();

  // Optional: Validate inputs here

  try {
    const response = await fetch(`${API_BASE}/new-transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient, amountSats, memo }),
    });
    const data = await response.json();
    if (data.success) {
      alert("Payment sent!");
      closeNewPaymentModal();
      await loadTransactions();
      await updateLightningBalance();
    } else {
      alert("Payment failed: " + data.message);
    }
  } catch (err) {
    alert("Payment failed: " + err.message);
  }
}

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

  // 1. Get BTC wallet ID from Blink
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

  // 2. Send payment via Blink
  let paymentResult;
  try {
    const apiKey = process.env.BLINK_API_KEY;
    const mutation = `
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
        walletId,
        lnAddress: lightningAddress,
        amount: Number(amount),
        memo: note || "",
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

    const result = payResp.data.data.lnLightningAddressPaymentSend;
    if (result.errors && result.errors.length > 0) {
      return res.json({ success: false, message: result.errors[0].message });
    }
    paymentResult = result.payment;
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Payment failed: " + err.message });
  }

  // 3. Save transaction locally
  let transactions = [];
  try {
    const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
    transactions = data.trim() ? JSON.parse(data) : [];
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const transaction = {
    id: paymentResult.id,
    date: new Date().toISOString(),
    type: "lightning",
    receiver: name,
    lightningAddress,
    amount: Number(amount),
    currency: "SATS",
    note: note || "",
    direction: "SENT",
    status: paymentResult.status,
    paymentHash: paymentResult.paymentHash,
  };
  transactions.unshift(transaction);
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

// PAY INVOICE
app.post("/pay-invoice", express.json(), async (req, res) => {
  const { invoice, note } = req.body;
  if (!invoice) {
    return res
      .status(400)
      .json({ success: false, message: "Missing invoice." });
  }

  // 1. Get BTC wallet ID from Blink
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

  // 2. Decode the invoice (optional but gives you amount & description)
  let invoiceDetails = {};
  try {
    const apiKey = process.env.BLINK_API_KEY;
    const decodeQuery = `
      query decodeInvoice($input: LnInvoiceDecodeInput!) {
        lnInvoiceDecode(input: $input) {
          invoice {
            description
            amount
            paymentHash
            destination
          }
          errors {
            message
          }
        }
      }
    `;
    const decodeVariables = {
      input: {
        paymentRequest: invoice,
      },
    };
    const decodeResp = await axios.post(
      "https://api.blink.sv/graphql",
      { query: decodeQuery, variables: decodeVariables },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
      },
    );
    const decodeResult = decodeResp.data.data.lnInvoiceDecode;
    if (decodeResult.errors && decodeResult.errors.length > 0) {
      return res.json({
        success: false,
        message: "Invalid invoice: " + decodeResult.errors[0].message,
      });
    }
    invoiceDetails = decodeResult.invoice;
  } catch (err) {
    // If decoding fails, still try to pay the invoice
    invoiceDetails = {};
  }

  // 3. Pay the invoice via Blink
  let paymentResult;
  try {
    const apiKey = process.env.BLINK_API_KEY;
    const mutation = `
      mutation payInvoice($input: LnInvoicePaymentInput!) {
        lnInvoicePaymentSend(input: $input) {
          status
          errors { message }
          payment {
            id
            status
            paymentHash
            settlementAmount
            settlementCurrency
          }
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
      return res.json({ success: false, message: result.errors[0].message });
    }
    paymentResult = result.payment;
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Payment failed: " + err.message });
  }

  // 4. Save transaction locally
  let transactions = [];
  try {
    const data = await fs.readFile(TRANSACTIONS_FILE, "utf8");
    transactions = data.trim() ? JSON.parse(data) : [];
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  // Format amount based on currency
  let amount = paymentResult.settlementAmount;
  let currency = paymentResult.settlementCurrency;
  if (currency === "USD") {
    amount = (amount / 100).toFixed(2);
  }

  const transaction = {
    id: paymentResult.id,
    date: new Date().toISOString(),
    type: "lightning_invoice",
    receiver: invoiceDetails.description || "Invoice Payment",
    invoice,
    amount,
    currency: currency === "BTC" ? "SATS" : currency,
    note: note || invoiceDetails.description || "",
    direction: "SENT",
    status: paymentResult.status,
    paymentHash: paymentResult.paymentHash,
  };

  transactions.unshift(transaction);

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

app.post("/decode-invoice", (req, res) => {
  const { invoice } = req.body;
  try {
    const decoded = decode(invoice);
    res.json({ success: true, decoded });
  } catch (err) {
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
    console.log(`Data files:`);
    console.log(`- Users: ${USERS_FILE}`);
    console.log(`- Transactions: ${TRANSACTIONS_FILE}`);
  });
}

startServer();

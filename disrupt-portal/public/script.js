const API_BASE = "http://localhost:3001/api";
let currentUser = null;
let membersToRemove = [];
let selectedMemberEmail = null;
let invoiceDecodeTimeout = null;
let employeesList = [];
let suppliersList = [];
let pendingDraftsSortColumn = "dateCreated"; // default sort column
let pendingDraftsSortAsc = true; // default sort order
let allPendingDrafts = []; // store all drafts for sorting/filtering
let showOnlyPending = true; // filter state
let allDrafts = [];
let pendingDraftsSort = { column: null, asc: true };
let employeeDrafts = [];
let employeeDraftsSort = { column: null, asc: true };
let currentBalanceBTC = 0.0;
let currentBalanceSATS = 0;
let btcToUsdRate = 70000; // fallback value
const balanceDisplayModes = ["BTC", "SATS", "USD"];
let currentBalanceMode = 0;

// Restore currentUser from sessionStorage if available
if (!currentUser) {
  const userStr = sessionStorage.getItem("user");
  if (userStr) {
    currentUser = JSON.parse(userStr);
  }
}

// Login function
async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errorMessage = document.getElementById("errorMessage");
  errorMessage.style.display = "none";
  errorMessage.textContent = "";

  if (!email || !password) {
    errorMessage.textContent = "Please enter both email and password.";
    errorMessage.style.display = "block";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `Login failed with status ${response.status}`,
      );
    }

    const data = await response.json();

    if (data.success && data.token) {
      sessionStorage.setItem("token", data.token);

      const profileResp = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });

      if (!profileResp.ok) {
        throw new Error("Failed to load user profile.");
      }

      const profile = await profileResp.json();

      if (profile.success) {
        currentUser = profile.user;

        // Call populateDepartmentsList only after currentUser is set and token stored
        await populateDepartmentsList();

        showDashboard();
        await loadEmployeeDrafts();
      } else {
        throw new Error("Failed to load user profile.");
      }
    } else {
      throw new Error(data.message || "Invalid email or password.");
    }
  } catch (err) {
    console.error("Login error:", err);
    errorMessage.textContent = err.message || "Login failed. Please try again.";
    errorMessage.style.display = "block";
  }
}

function showLoadingSpinner() {
  const spinner = document.getElementById("loadingSpinner");
  if (spinner) spinner.style.display = "block";
}

function hideLoadingSpinner() {
  const spinner = document.getElementById("loadingSpinner");
  if (spinner) spinner.style.display = "none";
}

// Show dashboard after login
function showDashboard() {
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.body.classList.remove("volcano-mode");
  document.getElementById("userGreeting").textContent =
    `Welcome, ${currentUser.name} (${currentUser.role})`;
  document.getElementById("displayEmail").textContent = currentUser.email;
  document.getElementById("displayRole").textContent = currentUser.role;
  document.getElementById("displayDept").textContent = currentUser.department;
  const firstName = currentUser.name.split(" ")[0];
  document.getElementById("welcomeh2").textContent = `Welcome, ${firstName}!`;
  updateDepartmentsSection();
  updateNavigationForRole();
  showContent("welcome");
}

// Logout function
function logout() {
  currentUser = null;
  sessionStorage.removeItem("user");
  sessionStorage.removeItem("token");
  document.getElementById("email").value = "";
  document.getElementById("password").value = "";
  document.getElementById("loginPage").style.display = "flex";
  document.getElementById("dashboard").style.display = "none";
  document.body.classList.remove("volcano-mode");
  const dashboard = document.getElementById("dashboard");
  if (dashboard) dashboard.classList.remove("volcano-mode");
  localStorage.removeItem("volcanoMode");
  const toggleText = document.getElementById("volcanoToggleText");
  const volcanoSwitch = document.getElementById("volcanoSwitch");
  if (toggleText) toggleText.textContent = "🌋 Volcano";
  if (volcanoSwitch) volcanoSwitch.checked = false;
}

// ===== Main Accounting Loader =====
function sortEmployeeDraftsByColumn(columnIdx) {
  // Adjust these if your columns are ordered differently
  const columns = ["dateCreated", "recipientName", "note", "amount", "status"];
  const column = columns[columnIdx];
  if (!column) return;

  // Toggle sort direction
  if (employeeDraftsSort.column === column) {
    employeeDraftsSort.asc = !employeeDraftsSort.asc;
  } else {
    employeeDraftsSort.column = column;
    employeeDraftsSort.asc = true;
  }

  employeeDrafts.sort((a, b) => {
    let aVal = a[column] || "";
    let bVal = b[column] || "";
    if (column === "dateCreated") {
      aVal = new Date(aVal);
      bVal = new Date(bVal);
    }
    if (column === "amount") {
      aVal = Number(aVal);
      bVal = Number(bVal);
    }
    // For status, sort by status text
    if (column === "status") {
      aVal = (a.status || "").toLowerCase();
      bVal = (b.status || "").toLowerCase();
    }
    if (aVal < bVal) return employeeDraftsSort.asc ? -1 : 1;
    if (aVal > bVal) return employeeDraftsSort.asc ? 1 : -1;
    return 0;
  });

  renderPendingDraftsTable(employeeDrafts, false);
  addEmployeeDraftsTableSortHandlers();
}

function renderPendingDraftsTable(drafts, showActions = true) {
  const tbody = document.querySelector("#pendingDraftsTable tbody");
  tbody.innerHTML = "";

  if (!drafts || drafts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-message">No drafts found.</td></tr>`;
    return;
  }

  drafts.forEach((draft) => {
    let actionCell = "";
    let statusText = "";
    let statusClass = "";

    if (draft.status === "pending") {
      if (showActions) {
        actionCell = `
          <div class="action-buttons">
            <button class="approve-btn" data-draft-id="${draft.id}">Approve</button>
            <button class="decline-btn" data-draft-id="${draft.id}">Decline</button>
          </div>
        `;
      } else {
        actionCell = `<span class="status-label status-pending">Pending</span>`;
      }
      statusText = "Pending";
      statusClass = "status-pending";
    } else if (draft.status === "paid" || draft.status === "approved") {
      actionCell = `<span class="status-label status-paid">Paid</span>`;
      statusText = "Paid";
      statusClass = "status-paid";
    } else if (draft.status === "declined") {
      actionCell = `<span class="status-label status-declined">Declined</span>`;
      statusText = "Declined";
      statusClass = "status-declined";
    } else {
      actionCell = `<span class="status-label">${draft.status}</span>`;
      statusText = draft.status;
      statusClass = "";
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(draft.dateCreated).toLocaleString()}</td>
      <td>${draft.recipientName || draft.payee || ""}</td>
      <td>${draft.note || draft.description || ""}</td>
      <td class="amount-cell">${draft.amount}</td>
      <td>${actionCell}</td>
    `;
    tbody.appendChild(row);
  });

  // Attach event listeners to buttons AFTER rendering
  tbody.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", handleDraftApproval);
  });
  tbody.querySelectorAll(".decline-btn").forEach((btn) => {
    btn.addEventListener("click", handleDraftDecline);
  });
}

function showSettingsPage() {
  // Hide all other content sections (optional if handled by showContent)
  document.querySelectorAll(".content-section").forEach((section) => {
    section.style.display = "none";
  });

  // Show the settings container
  const settingsDiv = document.getElementById("settingsContent");
  if (!settingsDiv) {
    console.error("Settings container not found!");
    return;
  }
  settingsDiv.style.display = "block";

  // Clear any previous messages
  const msgDiv = document.getElementById("forgotPasswordMessage");
  if (msgDiv) msgDiv.textContent = "";
}

async function loadAccountingPage() {
  try {
    const transactionsTable = document.getElementById("transactionsTable");
    const transactionsTitle = document.getElementById(
      "transactionsHistoryTitle",
    );
    const draftsTable = document.getElementById("draftsTable");
    const draftsTitle = document.getElementById("draftsHistoryTitle");

    if (
      !transactionsTable ||
      !transactionsTitle ||
      !draftsTable ||
      !draftsTitle
    ) {
      console.error("One or more accounting page elements are missing");
      return;
    }

    if (currentUser.role === "Admin" || currentUser.role === "Manager") {
      // Show transactions, hide drafts
      transactionsTable.style.display = "";
      transactionsTitle.style.display = "";
      draftsTable.style.display = "none";
      draftsTitle.style.display = "none";

      await loadTransactions();
      await loadPendingDrafts();
    } else {
      // Show drafts, hide transactions
      transactionsTable.style.display = "none";
      transactionsTitle.style.display = "none";
      draftsTable.style.display = "";
      draftsTitle.style.display = "";

      await loadEmployeeDrafts();
    }

    await updateLightningBalance();
    updateAccountingActionsVisibility();
  } catch (err) {
    console.error("Failed to load accounting data", err);
  }
}

function renderPendingDraftsTable(drafts) {
  const tbody = document.querySelector("#pendingDraftsTable tbody");
  tbody.innerHTML = "";

  if (!drafts || drafts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-message">No drafts found.</td></tr>`;
    return;
  }

  drafts.forEach((draft) => {
    let statusText = "";
    let statusClass = "";

    if (draft.status === "paid" || draft.status === "approved") {
      statusText = "Paid";
      statusClass = "status-paid";
    } else if (draft.status === "declined") {
      statusText = "Declined";
      statusClass = "status-declined";
    } else {
      statusText = "Pending";
      statusClass = "status-pending";
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(draft.dateCreated).toLocaleString()}</td>
      <td>${draft.recipientName || draft.payee || ""}</td>
      <td>${draft.note || draft.description || ""}</td>
      <td class="amount-cell">${draft.amount}</td>
      <td><span class="status-label ${statusClass}">${statusText}</span></td>
    `;
    tbody.appendChild(row);
  });
}

// LOADS SUPPLIERS IN DROPDOWN
async function populateDraftRecipientDropdown() {
  const select = document.getElementById("draftRecipientSelect");
  select.innerHTML = '<option value="">Select supplier...</option>';

  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      alert("Please log in to load suppliers.");
      return;
    }

    const response = await fetch(`${API_BASE}/suppliers`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load suppliers: ${response.status}`);
    }

    const data = await response.json();
    suppliersList = data.suppliers || [];

    suppliersList.forEach((supplier) => {
      const option = document.createElement("option");
      option.value = supplier.id;
      option.textContent = supplier.name;
      select.appendChild(option);
    });

    // Optionally, select the first supplier and fill details
    if (suppliersList.length > 0) {
      select.value = suppliersList[0].id;
      populateDraftRecipientDetails();
    } else {
      document.getElementById("draftRecipientName").value = "";
      document.getElementById("draftRecipientEmail").value = "";
      document.getElementById("draftRecipientLightningAddress").value = "";
    }
  } catch (err) {
    console.error("Failed to load suppliers:", err);
    select.innerHTML = '<option value="">Unable to load suppliers</option>';
  }
}

// LOADS REMAINING DATA FIELDS AFTER RECIPIENT SELECTED
async function populateDraftRecipientDetails() {
  const id = document.getElementById("draftRecipientSelect").value;

  if (!id) {
    // Clear fields if no recipient selected
    document.getElementById("draftRecipientName").value = "";
    document.getElementById("draftRecipientEmail").value = "";
    document.getElementById("draftRecipientLightningAddress").value = "";
    return;
  }

  let recipient = await fetchSupplierById(id);

  if (recipient) {
    document.getElementById("draftRecipientName").value = recipient.name || "";
    document.getElementById("draftRecipientEmail").value =
      recipient.email || "";
    document.getElementById("draftRecipientLightningAddress").value =
      recipient.lightningAddress || "";
  }
}

// Fetch employee/user data by ID
async function fetchUserById(id) {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Not authenticated");

    const response = await fetch(`${API_BASE}/users/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user: ${response.status}`);
    }

    const data = await response.json();
    return data.user || null;
  } catch (err) {
    console.error("Error fetching user by ID:", err);
    return null;
  }
}

// Fetch supplier data by ID
async function fetchSupplierById(id) {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Not authenticated");

    const response = await fetch(`${API_BASE}/suppliers/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch supplier: ${response.status}`);
    }

    const data = await response.json();
    return data.supplier || null;
  } catch (err) {
    console.error("Error fetching supplier by ID:", err);
    return null;
  }
}

async function showContent(contentId, event) {
  // List of all content container IDs
  const contentIds = [
    "welcomeContent",
    "accountingContent",
    "teamPageContent",
    "settingsContent",
    "suppliersContent",
    "pendingContent",
  ];

  // Hide all content sections
  contentIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  // Restrict pendingContent to Admin/Manager only
  if (contentId === "pending") {
    if (currentUser.role !== "Admin" && currentUser.role !== "Manager") {
      alert("You do not have permission to view this page.");
      return;
    }
    const pendingContent = document.getElementById("pendingContent");
    if (pendingContent) pendingContent.style.display = "block";
  }

  // Show selected content container
  const containerId =
    (contentId === "team" ? "teamPage" : contentId) + "Content";
  const contentElement = document.getElementById(containerId);
  if (contentElement) {
    contentElement.style.display = "block";
  } else {
    console.warn(`Content container not found for ID: ${containerId}`);
  }

  // Special case for welcome page styling
  if (contentId === "welcome") {
    document.body.classList.remove("volcano-mode");
  }

  // Update active nav item
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => item.classList.remove("active"));
  if (event && event.currentTarget) {
    event.currentTarget.classList.add("active");
  }

  // Load data based on the selected tab
  try {
    switch (contentId) {
      case "accounting":
        await loadAccountingPage();
        break;
      case "team":
        await loadTeamMembers();
        await loadDepartments();
        await updateTeamActionsVisibility();
        break;
      case "pending":
        await loadPendingDrafts();
        break;
      case "settings":
        await showSettingsPage();
        break;
      case "suppliers":
        await loadSuppliers();
        break;
      case "welcome":
        // No data to load for welcome page
        break;
      default:
        console.warn(`No data loader defined for contentId: ${contentId}`);
    }
  } catch (err) {
    console.error(`Error loading ${contentId} data:`, err);
  }
}

// Function to format and show transaction details in modal
function showTransactionDetails(txn) {
  const detailsContainer = document.getElementById("transactionDetails");
  if (!detailsContainer) {
    console.error("Details container element not found");
    return;
  }

  const details = `
<span class="label">Receiver:</span> <span class="data">${txn.receiver}</span>
<span class="label">Amount:</span> <span class="data">${txn.amount} ${txn.currency}</span>
<span class="label">Date:</span> <span class="data">${new Date(txn.date).toLocaleString()}</span>
<span class="label">Note:</span> <span class="data">${txn.note || "N/A"}</span>
<span class="label">Status:</span> <span class="data">${txn.status || "N/A"}</span>
<span class="label">Approved Status:</span> <span class="data">${txn.approvedStatus || "N/A"}</span>
<span class="label">Approved At:</span> <span class="data">${txn.approvedAt ? new Date(txn.approvedAt).toLocaleString() : "N/A"}</span>
<span class="label">Approved By:</span> <span class="data">${txn.approvedBy || "N/A"}</span>
<span class="label">Lightning Address:</span> <span class="data">${txn.lightningAddress || "N/A"}</span>
<span class="label">Invoice:</span> <span class="data">${txn.invoice || "N/A"}</span>
<span class="label">Payment Hash:</span> <span class="data">${txn.paymentHash || "N/A"}</span>
  `.trim();

  detailsContainer.innerHTML = details;
  document.getElementById("transactionModal").style.display = "flex";
}

function setupTransactionRowClicks(allTransactions) {
  const modal = document.getElementById("transactionModal");
  const detailsContainer = document.getElementById("transactionDetails");
  const closeButton = document.getElementById("closeTransactionModal");

  if (!modal || !detailsContainer || !closeButton) {
    console.error("Transaction modal elements missing");
    return;
  }

  // Close modal on close button click
  closeButton.addEventListener("click", () => {
    modal.style.display = "none";
  });

  // Function to populate and show modal
  function showTransactionDetails(txn) {
    const details = `
      <span class="label">Receiver:</span> <span class="data">${txn.receiver}</span><br>
      <span class="label">Amount:</span> <span class="data">${txn.amount} ${txn.currency || "N/A"}</span><br>
      <span class="label">Date:</span> <span class="data">${new Date(txn.date).toLocaleString()}</span><br>
      <span class="label">Note:</span> <span class="data">${txn.note || "N/A"}</span><br>
      <span class="label">Status:</span> <span class="data">${txn.status || "N/A"}</span><br>
      <span class="label">Approved Status:</span> <span class="data">${txn.approvedStatus || "N/A"}</span><br>
      <span class="label">Approved At:</span> <span class="data">${txn.approvedAt ? new Date(txn.approvedAt).toLocaleString() : "N/A"}</span><br>
      <span class="label">Approved By:</span> <span class="data">${txn.approvedBy || "N/A"}</span><br>
      <span class="label">Lightning Address:</span> <span class="data">${txn.lightningAddress || "N/A"}</span><br>
      <span class="label">Invoice:</span> <span class="data">${txn.invoice || "N/A"}</span><br>
      <span class="label">Payment Hash:</span> <span class="data">${txn.paymentHash || "N/A"}</span>
    `.trim();

    detailsContainer.innerHTML = details;
    modal.style.display = "flex";
  }

  // Attach click handlers to each transaction row
  document.querySelectorAll("#transactionsTable tbody tr").forEach((row) => {
    row.addEventListener("click", () => {
      const txnId = row.getAttribute("data-txn-id");
      const txn = allTransactions.find((t) => t.id === txnId);
      if (txn) {
        showTransactionDetails(txn);
      } else {
        console.warn(`Transaction with id ${txnId} not found`);
      }
    });
  });
}

function addPendingDraftsTableSortHandlers() {
  const table = document.getElementById("pendingDraftsTable");
  if (!table) return;
  const headers = table.querySelectorAll("th");
  headers.forEach((th, idx) => {
    th.style.cursor = "pointer";
    th.onclick = () => sortPendingDraftsByColumn(idx);
  });
}

function sortPendingDraftsByColumn(columnIdx) {
  // Adjust these if your columns are ordered differently
  const columns = ["dateCreated", "recipientName", "note", "amount", "status"];
  const column = columns[columnIdx];
  if (!column) return;

  // Toggle sort direction
  if (pendingDraftsSort.column === column) {
    pendingDraftsSort.asc = !pendingDraftsSort.asc;
  } else {
    pendingDraftsSort.column = column;
    pendingDraftsSort.asc = true;
  }

  // Choose the correct array to sort
  const draftsToSort = showOnlyPending ? allPendingDrafts : allDrafts;

  draftsToSort.sort((a, b) => {
    let aVal = a[column] || "";
    let bVal = b[column] || "";
    if (column === "dateCreated") {
      aVal = new Date(aVal);
      bVal = new Date(bVal);
    }
    if (column === "amount") {
      aVal = Number(aVal);
      bVal = Number(bVal);
    }
    if (aVal < bVal) return pendingDraftsSort.asc ? -1 : 1;
    if (aVal > bVal) return pendingDraftsSort.asc ? 1 : -1;
    return 0;
  });

  renderPendingDraftsTable(draftsToSort, true);
  addPendingDraftsTableSortHandlers();
}

async function loadPendingDrafts() {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      throw new Error("Authentication token missing. Please log in.");
    }

    const response = await fetch(`${API_BASE}/drafts`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Unauthorized access. Please log in again.");
      }
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      allDrafts = data.drafts || [];
      allPendingDrafts = allDrafts.filter((d) => d.status === "pending");
      document.getElementById("pendingDraftsCount").textContent =
        allPendingDrafts.length;
      renderPendingDraftsTable(
        showOnlyPending ? allPendingDrafts : allDrafts,
        true,
      );
      addPendingDraftsTableSortHandlers();
    } else {
      allDrafts = [];
      allPendingDrafts = [];
      renderPendingDraftsTable([], true);
      console.warn("Failed to load drafts:", data.message);
    }
  } catch (err) {
    allDrafts = [];
    allPendingDrafts = [];
    renderPendingDraftsTable([], true);
    console.error("Error loading pending drafts:", err);
  }
}

async function loadEmployeeDrafts() {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      alert("Please log in to view drafts.");
      return;
    }

    const response = await fetch(`${API_BASE}/drafts`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load drafts: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      // Trust backend filtering - no client-side filtering needed
      renderEmployeeDraftsTable(data.drafts || []);

      // Optional: Initialize sorting if needed
      if (typeof addEmployeeDraftsTableSortHandlers === "function") {
        addEmployeeDraftsTableSortHandlers();
      }
    } else {
      renderEmployeeDraftsTable([]);
      console.warn("Failed to load drafts:", data.message);
    }
  } catch (err) {
    renderEmployeeDraftsTable([]);
    console.error("Error loading drafts:", err);
  }
}

function addEmployeeDraftsTableSortHandlers() {
  const table = document.getElementById("draftsTable");
  if (!table) return;
  const headers = table.querySelectorAll("th");
  headers.forEach((th, idx) => {
    th.style.cursor = "pointer";
    th.onclick = () => sortEmployeeDraftsByColumn(idx);
  });
}

function sortEmployeeDraftsByColumn(columnIdx) {
  const columns = ["dateCreated", "recipientName", "note", "amount", "status"];
  const column = columns[columnIdx];
  if (!column) return;

  if (employeeDraftsSort.column === column) {
    employeeDraftsSort.asc = !employeeDraftsSort.asc;
  } else {
    employeeDraftsSort.column = column;
    employeeDraftsSort.asc = true;
  }

  employeeDrafts.sort((a, b) => {
    let aVal = a[column] || "";
    let bVal = b[column] || "";

    if (column === "dateCreated") {
      aVal = new Date(aVal);
      bVal = new Date(bVal);
    } else if (column === "amount") {
      aVal = Number(aVal);
      bVal = Number(bVal);
    } else {
      aVal = aVal.toString().toLowerCase();
      bVal = bVal.toString().toLowerCase();
    }

    if (aVal < bVal) return employeeDraftsSort.asc ? -1 : 1;
    if (aVal > bVal) return employeeDraftsSort.asc ? 1 : -1;
    return 0;
  });

  renderEmployeeDraftsTable(employeeDrafts);
  addEmployeeDraftsTableSortHandlers();
}

// For managers/admins
function renderPendingDraftsTable(drafts, showActions = true) {
  const tbody = document.querySelector("#pendingDraftsTable tbody");
  tbody.innerHTML = "";

  if (!drafts || drafts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-message">No drafts found.</td></tr>`;
    return;
  }

  drafts.forEach((draft) => {
    let actionCell = "";
    let statusText = "";
    let statusClass = "";

    if (draft.status === "pending") {
      if (showActions) {
        actionCell = `
          <div class="action-buttons">
            <button class="approve-btn" data-draft-id="${draft.id}">Approve</button>
            <button class="decline-btn" data-draft-id="${draft.id}">Decline</button>
          </div>
        `;
      } else {
        actionCell = `<span class="status-label status-pending">Pending</span>`;
      }
      statusText = "Pending";
      statusClass = "status-pending";
    } else if (draft.status === "paid" || draft.status === "approved") {
      actionCell = `<span class="status-label status-paid">Paid</span>`;
      statusText = "Paid";
      statusClass = "status-paid";
    } else if (draft.status === "declined") {
      actionCell = `<span class="status-label status-declined">Declined</span>`;
      statusText = "Declined";
      statusClass = "status-declined";
    } else {
      actionCell = `<span class="status-label">${draft.status}</span>`;
      statusText = draft.status;
      statusClass = "";
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(draft.dateCreated).toLocaleString()}</td>
      <td>${draft.recipientName || draft.payee || ""}</td>
      <td>${draft.note || draft.description || ""}</td>
      <td class="amount-cell">${draft.amount}</td>
      <td>${actionCell}</td>
    `;
    tbody.appendChild(row);
  });

  // Attach event listeners for approve/decline buttons if needed
  document.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", handleDraftApproval);
  });
  document.querySelectorAll(".decline-btn").forEach((btn) => {
    btn.addEventListener("click", handleDraftDecline);
  });
}

function renderEmployeeDraftsTable(drafts) {
  const tbody = document.querySelector("#draftsTable tbody");
  tbody.innerHTML = "";

  if (!drafts || drafts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-message">No drafts found.</td></tr>`;
    return;
  }

  // Sort drafts by dateCreated descending (most recent first)
  drafts.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));

  drafts.forEach((draft) => {
    let statusText = "";
    let statusClass = "";

    if (draft.status === "pending") {
      statusText = "Pending";
      statusClass = "status-pending";
    } else if (draft.status === "paid" || draft.status === "approved") {
      statusText = "Paid";
      statusClass = "status-paid";
    } else if (draft.status === "declined") {
      statusText = "Declined";
      statusClass = "status-declined";
    } else {
      statusText = draft.status || "";
      statusClass = "";
    }

    const date = draft.dateCreated ? new Date(draft.dateCreated) : null;
    const formattedDate = date ? date.toLocaleString() : "N/A";

    const formattedAmount = draft.amount
      ? Number(draft.amount).toLocaleString("en-US") + " SATS"
      : "";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${draft.recipientName || draft.payee || ""}</td>
      <td>${draft.note || draft.description || ""}</td>
      <td class="amount-cell">${formattedAmount}</td>
      <td><span class="status-label ${statusClass}">${statusText}</span></td>
    `;
    tbody.appendChild(row);
  });
}

async function handleDraftApproval(e) {
  const draftId = e.target.getAttribute("data-draft-id");

  if (confirm("Approve this draft?")) {
    try {
      const token = sessionStorage.getItem("token");

      const response = await fetch(`${API_BASE}/drafts/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ draftId }),
      });

      const result = await response.json();

      if (result.success) {
        alert("Draft approved!");
        await loadPendingDrafts();

        await new Promise((resolve) => setTimeout(resolve, 500));

        await loadTransactions();
      } else {
        alert("Approval failed: " + (result.message || "Unknown error"));
      }
    } catch (err) {
      alert("Error approving draft: " + err.message);
    }
  }
}

async function handleDraftDecline(e) {
  const draftId = e.target.getAttribute("data-draft-id");
  if (confirm("Are you sure you want to decline this draft payment?")) {
    try {
      const token = sessionStorage.getItem("token");
      const response = await fetch(`${API_BASE}/drafts/decline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ draftId }),
      });
      const result = await response.json();
      if (result.success) {
        alert("Draft declined successfully.");
        await loadPendingDrafts();
        await loadTransactions();
      } else {
        alert(
          "Failed to decline draft: " + (result.message || "Unknown error"),
        );
      }
    } catch (err) {
      alert("Error declining draft: " + err.message);
    }
  }
}

function updateBalanceDisplay() {
  const balanceElem = document.getElementById("balanceAmount");
  let displayValue;
  switch (balanceDisplayModes[currentBalanceMode]) {
    case "BTC":
      displayValue = `${currentBalanceBTC.toFixed(8)} BTC`;
      break;
    case "SATS":
      displayValue = `${currentBalanceSATS.toLocaleString()} SATS`;
      break;
    case "USD":
      displayValue = `$${(currentBalanceBTC * btcToUsdRate).toFixed(2)} USD`;
      break;
  }
  balanceElem.textContent = displayValue;
}

async function updateLightningBalance() {
  const balanceElem = document.getElementById("balanceAmount");
  const spinnerElem = document.getElementById("balanceSpinner");
  try {
    if (spinnerElem) spinnerElem.style.display = "inline";
    if (balanceElem) balanceElem.style.visibility = "hidden";

    const token = sessionStorage.getItem("token"); // or wherever you store the JWT

    // Fetch both balance and USD rate in parallel, passing auth header for balance
    const [balanceResp, usdRate] = await Promise.all([
      fetch(`${API_BASE}/lightning-balance`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }),
      fetchBtcUsdRate(),
    ]);

    const data = await balanceResp.json();

    if (data.success) {
      currentBalanceSATS = Number(data.balanceSats) || 0;
      currentBalanceBTC = currentBalanceSATS / 100_000_000;
      btcToUsdRate = usdRate;
      currentBalanceMode = 0; // Always start with BTC
      updateBalanceDisplay();
    } else {
      balanceElem.textContent = "Error";
    }
  } catch (err) {
    if (balanceElem) balanceElem.textContent = "Error";
    console.error("Error updating lightning balance:", err);
  } finally {
    if (spinnerElem) spinnerElem.style.display = "none";
    if (balanceElem) balanceElem.style.visibility = "visible";
  }
}

// GET EXCHANGE RATE
async function fetchBtcUsdRate() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    );
    const data = await response.json();
    if (data.bitcoin && data.bitcoin.usd) {
      return data.bitcoin.usd;
    }
  } catch (err) {
    console.error("Failed to fetch BTC/USD rate from CoinGecko:", err);
  }
  return 100000; // fallback
}

// Load departments and populate the list
async function loadDepartments() {
  try {
    const token = sessionStorage.getItem("token"); // align with login token storage
    if (!token) {
      throw new Error("Authentication token missing. Please log in.");
    }

    const response = await fetch(`${API_BASE}/departments`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Unauthorized access. Please log in again.");
      }
      throw new Error(
        `Failed to fetch departments. Status: ${response.status}`,
      );
    }

    const data = await response.json();
    const list = document.getElementById("departmentsList");
    if (!list) return;

    list.innerHTML = "";
    data.departments.forEach((dep) => {
      // assuming response shape { success: true, departments: [...] }
      const li = document.createElement("li");
      li.textContent = dep;
      list.appendChild(li);
    });
  } catch (err) {
    console.error("Error loading departments:", err);
    // Optionally show user-friendly error message in UI here
  }
}

// Add a new department
async function addDepartment() {
  const input = document.getElementById("newDepartment");
  if (!input) return;
  const dep = input.value.trim();
  if (!dep) return;

  try {
    const token = sessionStorage.getItem("token"); // or wherever you store the JWT

    const response = await fetch(`${API_BASE}/departments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ department: dep }),
    });

    if (!response.ok) {
      const data = await response.json();
      alert(data.error || "Failed to add department");
      return;
    }

    input.value = "";
    await loadDepartments();
    await loadRemoveDepartmentSelect();
  } catch (err) {
    console.error("Error adding department:", err);
  }
}

// Remove a department
async function removeDepartment(department) {
  try {
    const response = await fetch(`${API_BASE}/departments`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + sessionStorage.getItem("token"),
      },
      body: JSON.stringify({ department }),
    });

    let data;
    try {
      data = await response.json();
    } catch (e) {
      // If the response is not JSON, make a fallback error object
      data = { success: false, message: "Unexpected server response." };
    }

    if (response.ok && data.success) {
      alert(`Department "${department}" removed successfully!`);
      // Optionally refresh department list here
      await populateDepartmentsList?.();
    } else if (response.status === 404) {
      // 404 from backend, show the backend message if available
      alert(data.message || `Department "${department}" does not exist.`);
    } else {
      alert(data.message || "Failed to remove department.");
    }
  } catch (err) {
    alert("An error occurred while removing the department.");
    console.error(err);
  }
}

// Load departments into the remove select dropdown
async function loadRemoveDepartmentSelect() {
  try {
    const token = sessionStorage.getItem("token"); // consistent with your other functions
    if (!token) {
      throw new Error("Authentication token missing. Please log in.");
    }

    const response = await fetch(`${API_BASE}/departments`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Unauthorized access. Please log in again.");
      }
      throw new Error(
        `Failed to fetch departments. Status: ${response.status}`,
      );
    }

    const data = await response.json();
    const select = document.getElementById("removeDepartmentSelect");
    if (!select) return;

    select.innerHTML = "";
    data.departments.forEach((dep) => {
      const option = document.createElement("option");
      option.value = dep;
      option.textContent = dep;
      select.appendChild(option);
    });
  } catch (err) {
    console.error("Error loading remove department select:", err);
    // Optionally, show a user-friendly error message in the UI here
  }
}

async function populateDepartmentsList() {
  try {
    const token = sessionStorage.getItem("token"); // Use sessionStorage for token consistency
    if (!token) {
      throw new Error("No authentication token found. Please log in.");
    }

    if (!currentUser || !currentUser.role) {
      throw new Error("User information not loaded.");
    }

    const response = await fetch(`${API_BASE}/departments`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) throw new Error("Failed to fetch departments");

    const data = await response.json();
    let departments = data.departments || [];

    const deptList = document.getElementById("departmentsList");
    deptList.innerHTML = "";

    // Role-based filtering
    if (currentUser.role === "Manager" || currentUser.role === "Employee") {
      departments = departments.filter((dep) => dep === currentUser.department);
    }

    if (departments.length === 0) {
      deptList.innerHTML = "<li>No departments available.</li>";
      return;
    }

    departments.forEach((dep) => {
      const li = document.createElement("li");
      li.textContent = dep;
      deptList.appendChild(li);
    });
  } catch (err) {
    console.error("Error populating departments list:", err);
    const deptList = document.getElementById("departmentsList");
    if (deptList) {
      deptList.innerHTML = `<li style="color:red;">${err.message}</li>`;
    }
  }
}

async function populateDepartmentSelect() {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      throw new Error("Authentication token missing. Please log in.");
    }

    const response = await fetch(`${API_BASE}/departments`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Unauthorized access. Please log in again.");
      }
      throw new Error(
        `Failed to fetch departments. Status: ${response.status}`,
      );
    }

    const data = await response.json();
    if (!data.success || !Array.isArray(data.departments)) {
      throw new Error("Invalid response format");
    }

    const select = document.getElementById("memberDepartment");
    if (!select) return;

    select.innerHTML = '<option value="">Select Department</option>';
    data.departments.forEach((dep) => {
      const option = document.createElement("option");
      option.value = dep;
      option.textContent = dep;
      select.appendChild(option);
    });
  } catch (err) {
    console.error("Error populating department select:", err);
  }
}

async function loadSuppliers() {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      throw new Error("Authentication token missing. Please log in.");
    }

    const response = await fetch(`${API_BASE}/suppliers`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Unauthorized access. Please log in again.");
      }
      throw new Error(`Failed to fetch suppliers. Status: ${response.status}`);
    }

    const data = await response.json();
    if (data.success) {
      renderSuppliers(data.suppliers);
    } else {
      throw new Error("Failed to load suppliers");
    }
  } catch (err) {
    console.error("Error loading suppliers:", err);
    // Optionally show user-friendly error message in UI
  }
}

function renderSuppliers(suppliers) {
  // Sort suppliers by creation date descending
  suppliers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Render suppliers table
  const tbody = document.querySelector("#suppliersTable tbody");
  tbody.innerHTML = "";
  suppliers.forEach((supplier) => {
    const name = supplier.name || "";
    const contact = supplier.contact || "";
    const email = supplier.email || "";
    const lightningAddress = supplier.lightningAddress || "";
    const note = supplier.note || "";
    const createdAt = supplier.createdAt
      ? new Date(supplier.createdAt).toLocaleString()
      : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${name}</td>
      <td>${contact}</td>
      <td>${email}</td>
      <td>${lightningAddress}</td>
      <td>${note}</td>
      <td>${createdAt}</td>
    `;
    tbody.appendChild(tr);
  });

  // Populate recipient dropdown
  const select = document.getElementById("recipientSelect");
  if (!select) {
    console.error("Recipient dropdown element not found");
    return;
  }

  select.innerHTML = '<option value="">Select Supplier</option>';
  suppliers.forEach((supplier) => {
    const option = document.createElement("option");
    option.value = supplier.id;
    option.textContent = supplier.name || "Unnamed Supplier";
    select.appendChild(option);
  });

  // Auto-select first supplier and populate details if available
  if (suppliers.length > 0) {
    select.value = suppliers[0].id;
    populateRecipientDetails();
  } else {
    document.getElementById("recipientName").value = "";
    document.getElementById("recipientEmail").value = "";
    document.getElementById("recipientLightningAddress").value = "";
  }
}

// Load transactions
async function loadTransactions() {
  try {
    const token = sessionStorage.getItem("token");
    const response = await fetch(`${API_BASE}/transactions`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();

    if (data.success) {
      renderTransactions(data.transactions);
    } else {
      renderTransactions([]);
    }
  } catch (err) {
    console.error("Error loading transactions:", err);
    renderTransactions([]);
  }
}

function renderTransactions(transactions) {
  const tbody = document.querySelector("#transactionsTable tbody");
  tbody.innerHTML = "";

  transactions.forEach((txn) => {
    let dateDisplay = "";
    if (txn.date) {
      const d = new Date(txn.date);
      dateDisplay = isNaN(d.getTime()) ? "" : d.toLocaleString();
    }

    const receiver = txn.receiver || "Unknown";
    const amountText = txn.amount
      ? `${txn.amount} ${txn.currency || "SATS"}`
      : "";

    const id = txn.id || "";
    const note = txn.note || "";
    const status = renderStatus(txn.status);

    const row = document.createElement("tr");

    // Add a data attribute for transaction ID to identify the transaction on click
    row.setAttribute("data-txn-id", id);

    const dateCell = document.createElement("td");
    dateCell.textContent = dateDisplay;

    const receiverCell = document.createElement("td");
    receiverCell.textContent = receiver;

    const amountCell = document.createElement("td");
    amountCell.textContent = amountText;
    amountCell.classList.add("amount");
    if (txn.status === "ALREADY_PAID") {
      amountCell.classList.add("amount-blue");
    }

    const idCell = document.createElement("td");
    idCell.textContent = id;

    const noteCell = document.createElement("td");
    noteCell.textContent = note;

    const statusCell = document.createElement("td");
    statusCell.innerHTML = status;

    row.appendChild(dateCell);
    row.appendChild(receiverCell);
    row.appendChild(amountCell);
    row.appendChild(idCell);
    row.appendChild(noteCell);
    row.appendChild(statusCell);

    tbody.appendChild(row);
  });

  setupTransactionRowClicks(transactions);
}

function closeNewPaymentModal() {
  document.getElementById("newPaymentModal").style.display = "none";
}

// employ or supplier
function updateRecipientDropdown() {
  const type = document.getElementById("recipientType").value; // "employee" or "supplier"
  const select = document.getElementById("recipientSelect");
  select.innerHTML = ""; // Clear previous options

  let list = [];
  let placeholder = "";

  if (type === "employee") {
    list = employeesList;
    placeholder = "Select Employee";
  } else if (type === "supplier") {
    list = suppliersList;
    placeholder = "Select Supplier";
  }

  // Add placeholder option
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  // Populate options
  list.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id || item.email;
    option.textContent = item.name;
    select.appendChild(option);
  });

  // Optionally, auto-select first real option and populate details
  if (list.length > 0) {
    select.value = list[0].id || list[0].email;
    populateRecipientDetails();
  } else {
    // Clear details if no options
    document.getElementById("recipientName").value = "";
    document.getElementById("recipientEmail").value = "";
    document.getElementById("recipientLightningAddress").value = "";
  }
}

function populateRecipientDetails() {
  const type = document.getElementById("recipientType").value;
  const select = document.getElementById("recipientSelect");
  const selectedValue = select.value;

  let recipient = null;
  if (type === "employee") {
    recipient = employeesList.find(
      (emp) => emp.id === selectedValue || emp.email === selectedValue,
    );
  } else if (type === "supplier") {
    recipient = suppliersList.find(
      (sup) => sup.id === selectedValue || sup.email === selectedValue,
    );
  }

  if (recipient) {
    document.getElementById("recipientName").value = recipient.name || "";
    document.getElementById("recipientEmail").value = recipient.email || "";
    document.getElementById("recipientLightningAddress").value =
      recipient.lightningAddress || "";
  } else {
    document.getElementById("recipientName").value = "";
    document.getElementById("recipientEmail").value = "";
    document.getElementById("recipientLightningAddress").value = "";
  }
}

async function loadEmployeesForPaymentModal() {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Not authenticated");
    const response = await fetch(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Failed to load employees");
    // /api/users returns a naked array
    employeesList = await response.json();
  } catch (err) {
    console.error("Error loading employees for payment modal:", err);
    employeesList = [];
  }
}

function closeNewPaymentModal() {
  document.getElementById("newPaymentModal").style.display = "none";
}

// PAY INVOICE MODAL
function openPayInvoiceModal() {
  clearPayInvoiceModal();
  document.getElementById("payInvoiceModal").style.display = "flex";
  document.getElementById("payInvoiceForm").reset();
}
function closePayInvoiceModal() {
  document.getElementById("payInvoiceModal").style.display = "none";
}

async function submitNewPayment(event) {
  event.preventDefault();

  const submitBtn = document.querySelector("#newPaymentModal .submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
  }

  const type = document.getElementById("recipientType").value;
  const id = document.getElementById("recipientSelect").value;
  const name = document.getElementById("recipientName").value;
  const email = document.getElementById("recipientEmail").value;
  const lightningAddress = document.getElementById(
    "recipientLightningAddress",
  ).value;
  const amount = document.getElementById("paymentAmount").value;
  const note = document.getElementById("paymentNote").value;

  const payload = {
    recipientType: type,
    recipientId: id,
    lightningAddress,
    paymentAmount: amount,
    paymentNote: note,
  };

  const endpoint = `${API_BASE}/pay`;

  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      alert("Please log in to send payments.");
      return;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (data.success) {
      alert("Payment sent!");
      closeNewPaymentModal();
      await loadTransactions();
      await updateLightningBalance();
    } else {
      alert("Error: " + (data.message || "Failed to send payment."));
    }
  } catch (err) {
    alert("Error sending payment: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send";
    }
  }
}

async function submitPayInvoice(event) {
  event.preventDefault();

  const invoice = document.getElementById("invoiceString").value.trim();
  const note = document.getElementById("invoiceNote").value.trim();
  const userAmount = document.getElementById("userAmount").value.trim();
  const receiverName = document
    .getElementById("receiverNameInput")
    .value.trim();

  if (!receiverName) {
    alert("Please enter the receiver name.");
    return;
  }

  const submitBtn = document.querySelector("#payInvoiceModal .submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Paying...";
  }

  const payload = { invoice, note, recipientName: receiverName };
  const amountEntryDiv = document.getElementById("amountEntry");
  if (amountEntryDiv && amountEntryDiv.style.display !== "none" && userAmount) {
    payload.amount = userAmount;
  }

  const endpoint = `${API_BASE}/pay-invoice`;

  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      alert("Please log in to pay invoices.");
      return;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (data.success) {
      alert("Invoice paid!");
      closePayInvoiceModal();
      await loadTransactions();
      await updateLightningBalance();
    } else {
      alert("Error: " + (data.message || "Failed to pay invoice."));
    }
  } catch (err) {
    alert("Error paying invoice: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Pay";
    }
  }
}

function clearPayInvoiceModal() {
  const invoiceInput = document.getElementById("invoiceString");
  const detailsDiv = document.getElementById("invoiceDetails");
  const amountInput = document.getElementById("userAmount");
  const amountEntryDiv = document.getElementById("amountEntry");
  const receiverInput = document.getElementById("receiverNameInput");
  const noteInput = document.getElementById("invoiceNote");

  if (invoiceInput) invoiceInput.value = "";
  if (detailsDiv) detailsDiv.innerHTML = "";
  if (amountInput) amountInput.value = "";
  if (amountEntryDiv) amountEntryDiv.style.display = "none";
  if (receiverInput) receiverInput.value = "";
  if (noteInput) noteInput.value = "";
}

async function decodeInvoiceFromFrontend(invoice) {
  const detailsDiv = document.getElementById("invoiceDetails");
  const amountEntryDiv = document.getElementById("amountEntry");
  const userAmountInput = document.getElementById("userAmount");

  if (!invoice) {
    detailsDiv.innerHTML = "";
    if (amountEntryDiv) amountEntryDiv.style.display = "none";
    if (userAmountInput) userAmountInput.required = false;
    return;
  }

  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      detailsDiv.innerHTML = `<span style="color:red;">Please log in to decode invoices.</span>`;
      if (amountEntryDiv) amountEntryDiv.style.display = "none";
      if (userAmountInput) userAmountInput.required = false;
      return;
    }

    const response = await fetch("http://localhost:3001/api/decode-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ invoice }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      const decoded = data.decoded;
      let html = `<ul style="list-style:none;padding:0;">`;

      // Payment Request
      if (decoded.paymentRequest) {
        html += `<li><strong>Payment Request:</strong> <span style="word-break:break-all;font-family:monospace;">${decoded.paymentRequest}</span></li>`;
      }

      // Expiry Logic: use data.expiry and data.timestamp from backend response
      if (data.expiry && data.timestamp) {
        const invoiceCreatedAt = Number(data.timestamp); // seconds
        const invoiceExpiresAt = invoiceCreatedAt + Number(data.expiry); // seconds
        const now = Math.floor(Date.now() / 1000);
        const secondsLeft = invoiceExpiresAt - now;

        let expiryStr = "";
        if (isNaN(secondsLeft)) {
          expiryStr = `<span style="color:#e74c3c;">Unknown</span>`;
        } else if (secondsLeft <= 0) {
          expiryStr = `<span style="color:#e74c3c;">Expired!</span>`;
        } else {
          const expiryHours = Math.floor(secondsLeft / 3600);
          const expiryMins = Math.floor((secondsLeft % 3600) / 60);
          if (expiryHours > 0)
            expiryStr = `${expiryHours} hour(s) ${expiryMins} min(s)`;
          else if (expiryMins > 0) expiryStr = `${expiryMins} min(s)`;
          else expiryStr = `${secondsLeft} sec(s)`;
        }
        html += `<li><strong>Expires In:</strong> ${expiryStr}</li>`;
      } else if (decoded.expiry) {
        // fallback if backend expiry info missing
        const expiryHours = Math.floor(decoded.expiry / 3600);
        const expiryMins = Math.floor((decoded.expiry % 3600) / 60);
        let expiryStr = `${decoded.expiry} seconds`;
        if (expiryHours > 0)
          expiryStr = `${expiryHours} hour(s) ${expiryMins} min(s)`;
        else if (expiryMins > 0) expiryStr = `${expiryMins} min(s)`;
        html += `<li><strong>Expires In:</strong> ${expiryStr}</li>`;
      } else {
        html += `<li><strong>Expires In:</strong> <span style="color:#e74c3c;">Unknown</span></li>`;
      }

      // Amount Logic
      let amountSats = null;
      if (decoded.satoshis) {
        amountSats = decoded.satoshis;
      } else if (decoded.amount) {
        amountSats = Number(decoded.amount) / 1000;
      } else if (decoded.tags && Array.isArray(decoded.tags)) {
        const amtTag = decoded.tags.find((t) => t.tagName === "amount");
        if (amtTag) amountSats = amtTag.data;
      } else if (decoded.sections && Array.isArray(decoded.sections)) {
        const amountSection = decoded.sections.find((s) => s.name === "amount");
        if (amountSection) amountSats = amountSection.value;
      }

      if (amountSats && Number(amountSats) > 0) {
        html += `<li><strong>Amount:</strong> ${amountSats} sats</li>`;
      }

      // Description and Payee
      if (decoded.sections && decoded.sections.length > 0) {
        const descSection = decoded.sections.find(
          (s) => s.name === "description",
        );
        if (descSection) {
          html += `<li><strong>Description:</strong> ${descSection.value}</li>`;
        }

        const payeeSection = decoded.sections.find(
          (s) => s.name === "payee_node_key",
        );
        if (payeeSection) {
          html += `<li><strong>Destination:</strong> <span style="font-family:monospace;">${payeeSection.value}</span></li>`;
        }
      }

      html += `</ul>`;
      detailsDiv.innerHTML = `<div class="content-card">${html}</div>`;

      // Show or hide amount entry input
      if (!amountSats || Number(amountSats) <= 0) {
        if (amountEntryDiv) amountEntryDiv.style.display = "block";
        if (userAmountInput) userAmountInput.required = true;
      } else {
        if (amountEntryDiv) amountEntryDiv.style.display = "none";
        if (userAmountInput) {
          userAmountInput.required = false;
          userAmountInput.value = "";
        }
      }
    } else {
      detailsDiv.innerHTML = `<span style="color:red;">${data.error || "Invalid or unsupported invoice."}</span>`;
      if (amountEntryDiv) amountEntryDiv.style.display = "none";
      if (userAmountInput) userAmountInput.required = false;
    }
  } catch (err) {
    console.error("Error decoding invoice:", err);
    detailsDiv.innerHTML = `<span style="color:red;">Error decoding invoice: ${err.message}</span>`;
    if (amountEntryDiv) amountEntryDiv.style.display = "none";
    if (userAmountInput) userAmountInput.required = false;
  }
}

// Debounce input to avoid too many requests
function onInvoiceInputChange() {
  clearTimeout(invoiceDecodeTimeout);
  invoiceDecodeTimeout = setTimeout(() => {
    const invoice = document.getElementById("invoiceString").value.trim();
    decodeInvoiceFromFrontend(invoice);
  }, 500);
}

function saveTransaction(txn) {
  const filePath = path.join(__dirname, "transactions.json");
  let transactions = [];
  if (fs.existsSync(filePath)) {
    transactions = JSON.parse(fs.readFileSync(filePath));
  }
  transactions.push(txn);
  fs.writeFileSync(filePath, JSON.stringify(transactions, null, 2));
}

// Update current date
function updateCurrentDate() {
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const today = new Date();
  document.getElementById("currentDate").textContent = today.toLocaleDateString(
    "en-US",
    options,
  );
}

// Load and display transactions
async function loadTransactions() {
  try {
    const token = sessionStorage.getItem("token");

    if (!token) {
      throw new Error("No authentication token found. Please log in.");
    }

    const response = await fetch(`${API_BASE}/transactions?ts=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 401) {
      // Unauthorized - token invalid or expired
      throw new Error("Unauthorized access. Please log in again.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(`Expected JSON but received:\n${text.substring(0, 200)}`);
    }

    const data = await response.json();

    if (data.success) {
      renderTransactions(data.transactions);
    } else {
      console.warn("No transactions returned or success false");
      renderTransactions([]);
    }
  } catch (err) {
    console.error("Error loading transactions:", err);
    alert(err.message);
    renderTransactions([]);
  }
}

// Helper function for status display
function renderStatus(status, receiver) {
  if (
    !status ||
    status === "complete" ||
    status === "success" ||
    status === "paid"
  ) {
    // If receiver is "Payment canceled" or status contains "cancel", show Cancelled
    if (receiver && receiver.toLowerCase().includes("canceled"))
      return "Cancelled";
    return "Paid";
  }
  if (typeof status === "string" && status.toLowerCase().includes("cancel"))
    return "Cancelled";
  if (typeof status === "string" && status.toLowerCase().includes("fail"))
    return "Failed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Helper function to format date
function formatDate(date) {
  if (!date) return "Unknown";
  // If date is a number and less than 10^12, treat as seconds, convert to ms
  if (typeof date === "number" && date < 1000000000000) {
    date = date * 1000;
  }
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

async function loadTeamMembers() {
  const token = sessionStorage.getItem("token");
  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      console.error("No authentication token found in sessionStorage.");
      throw new Error("No authentication token found. Please log in.");
    }

    const endpoint =
      currentUser.role === "Admin" || currentUser.role === "Manager"
        ? "/employees"
        : "/users"; // Employees use /users endpoint

    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    // Check content-type before parsing
    const contentType = response.headers.get("content-type");

    const text = await response.text();

    if (!response.ok) {
      let errorMsg = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = JSON.parse(text);
        errorMsg = errorData.message || errorMsg;
      } catch {
        // If parsing error response failed, keep original message
      }
      throw new Error(errorMsg);
    }

    if (!contentType || !contentType.includes("application/json")) {
      console.error(
        "Expected JSON response but received different content-type.",
      );
      alert("Error loading team members: Server returned non-JSON data.");
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error("Failed to parse JSON from response:", parseError);
      alert("Error loading team members: Server returned invalid JSON.");
      return;
    }

    const teamMembers = Array.isArray(data)
      ? data
      : data.users || data.employees || [];

    renderTeamMembersTable(teamMembers);
  } catch (err) {
    console.error("Failed to load team members:", err);
    alert("Error loading team members: " + err.message);
  }
}

function escapeHtml(text) {
  return text
    ? text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
    : "";
}

function renderTeamMembersTable(users) {
  const tbody = document.querySelector("#teamTable tbody");
  if (!tbody) {
    console.error("tbody element not found in renderTeamMembersTable");
    return;
  }
  tbody.innerHTML = "";

  if (!users || users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="loading-message">No team members found for your department.</td>
      </tr>
    `;
    return;
  }

  users.forEach((user) => {
    const dateAddedFormatted = user.dateAdded
      ? new Date(user.dateAdded).toLocaleDateString()
      : "N/A";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(user.name) || "N/A"}</td>
      <td>${escapeHtml(user.role) || "N/A"}</td>
      <td>${escapeHtml(user.department) || "N/A"}</td>
      <td>${escapeHtml(user.email) || "N/A"}</td>
      <td>${dateAddedFormatted}</td>
    `;
    tbody.appendChild(row);
  });
}

function updateAccountingActionsVisibility() {
  const btnRow = document.getElementById("accountingBtnRow");
  const newPaymentBtn = document.getElementById("newPaymentBtn");
  const payInvoiceBtn = document.getElementById("payInvoiceBtn");
  const draftBtn = document.getElementById("draftPaymentBtn");

  if (!btnRow || !newPaymentBtn || !payInvoiceBtn || !draftBtn) {
    console.warn("One or more accounting buttons or container not found.");
    return;
  }

  if (!currentUser || !currentUser.role) {
    console.warn("currentUser or currentUser.role is not available.");
    btnRow.style.display = "none";
    [newPaymentBtn, payInvoiceBtn, draftBtn].forEach((btn) => {
      btn.classList.remove("d-block");
      btn.classList.add("d-none");
    });
    return;
  }

  const setVisibility = (element, show) => {
    element.classList.toggle("d-block", show);
    element.classList.toggle("d-none", !show);
  };

  switch (currentUser.role) {
    case "Admin":
    case "Manager":
      // Show payment buttons, hide draft button
      setVisibility(newPaymentBtn, true);
      setVisibility(payInvoiceBtn, true);
      setVisibility(draftBtn, false);
      btnRow.style.display = "flex"; // Show button row
      break;

    case "Employee":
      // Show draft button, hide payment buttons
      setVisibility(newPaymentBtn, false);
      setVisibility(payInvoiceBtn, false);
      setVisibility(draftBtn, true);
      btnRow.style.display = "flex"; // Show button row
      break;

    case "Bookkeeper":
      // Hide all buttons and button row
      btnRow.style.display = "none";
      [newPaymentBtn, payInvoiceBtn, draftBtn].forEach((btn) => {
        btn.classList.remove("d-block");
        btn.classList.add("d-none");
      });
      break;

    default:
      // Hide all buttons and button row for unknown roles
      btnRow.style.display = "none";
      [newPaymentBtn, payInvoiceBtn, draftBtn].forEach((btn) => {
        btn.classList.remove("d-block");
        btn.classList.add("d-none");
      });
      break;
  }
}

function updateNavigationForRole() {
  const pendingNav = document.getElementById("pendingNav");
  if (pendingNav) {
    if (currentUser.role === "Admin" || currentUser.role === "Manager") {
      pendingNav.style.display = "block";
    } else {
      pendingNav.style.display = "none";
    }
  }

  const suppliersNav = document.getElementById("suppliersNav");
  if (!suppliersNav) return;

  if (currentUser.role === "Admin" || currentUser.role === "Manager") {
    suppliersNav.style.display = "block";
  } else {
    suppliersNav.style.display = "none";
  }
}

function updateDepartmentsSection() {
  const section = document.getElementById("departmentsSection");
  const addBtn = document.getElementById("addDepartmentBtn");
  const removeBtn = document.getElementById("removeDepartmentBtn");
  const deptList = document.getElementById("departmentsList");

  if (!section) return;

  // Hide section for Bookkeeper and Employee
  if (currentUser.role === "Bookkeeper" || currentUser.role === "Employee") {
    section.style.display = "none";
    return;
  }

  // Show section for Admin and Manager
  section.style.display = "block";

  if (currentUser.role === "Admin") {
    // Admin: show all controls and all departments
    addBtn.style.display = "inline-block";
    removeBtn.style.display = "inline-block";
    deptList.style.display = "block";
    populateDepartmentsList(); // Make sure this fetches and lists all departments
  } else if (currentUser.role === "Manager") {
    // Manager: hide add/remove, show only their own department
    addBtn.style.display = "none";
    removeBtn.style.display = "none";
    deptList.innerHTML = `<li>${currentUser.department}</li>`;
    deptList.style.display = "block";
  }
}

function updateTeamActionsVisibility() {
  const addBtn = document.getElementById("addMemberBtn");
  const removeBtn = document.getElementById("removeMemberBtn");

  if (!addBtn || !removeBtn) {
    console.warn("Add or Remove member buttons not found.");
    return;
  }

  if (!currentUser || !currentUser.role) {
    console.warn("currentUser or currentUser.role is not defined.");
    addBtn.classList.add("d-none");
    removeBtn.classList.add("d-none");
    return;
  }

  if (currentUser.role === "Admin" || currentUser.role === "Manager") {
    addBtn.classList.remove("d-none");
    removeBtn.classList.remove("d-none");
  } else {
    addBtn.classList.add("d-none");
    removeBtn.classList.add("d-none");
  }
}

async function showTeamPage() {
  // 1. Show the Team page container
  document.querySelectorAll(".content-section").forEach((section) => {
    section.style.display = "none"; // Hide other sections
  });
  document.getElementById("teamPageContent").style.display = ""; // Show Team page

  // 2. Load and render team members
  await loadTeamMembers();

  // 3. Update button visibility
  updateTeamActionsVisibility();
}

async function addTeamMember() {
  await loadDepartments();
  const btn = document.getElementById("submitMemberBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Adding...";

  try {
    const newMember = {
      name: document.getElementById("memberName").value.trim(),
      role: document.getElementById("memberRole").value.trim(),
      email: document.getElementById("memberEmail").value.trim(),
      department: document.getElementById("memberDepartment").value.trim(),
      lightningAddress: document.getElementById("memberLightning").value.trim(),
    };

    // Validation
    if (
      !newMember.name ||
      !newMember.role ||
      !newMember.email ||
      !newMember.department ||
      !newMember.lightningAddress
    ) {
      throw new Error("Please fill in all required fields");
    }

    const token = sessionStorage.getItem("token");
    if (!token) {
      throw new Error("You must be logged in to add a team member.");
    }

    const response = await fetch(`${API_BASE}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`, // Include JWT token
      },
      body: JSON.stringify(newMember),
    });

    // Handle non-JSON error responses gracefully
    if (!response.ok) {
      const text = await response.text();
      // Try to parse JSON if possible, else use plain text
      let errorMessage = text;
      try {
        const data = JSON.parse(text);
        errorMessage = data.message || text;
      } catch {
        // text is not JSON, keep as is
      }
      throw new Error(errorMessage || "Failed to add member");
    }

    const data = await response.json();

    // Success handling
    document.getElementById("successMessage").textContent =
      `${newMember.name} added successfully!`;
    document.getElementById("addMemberModal").style.display = "none";
    document.getElementById("successModal").style.display = "flex";

    await loadTeamMembers();
    await loadDepartments();

    // Clear form
    [
      "memberName",
      "memberRole",
      "memberDepartment",
      "memberEmail",
      "memberLightning",
    ].forEach((id) => {
      document.getElementById(id).value = "";
    });
  } catch (err) {
    console.error("Error adding team member:", err);
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function removeTeamMember() {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      throw new Error("You must be logged in to remove a team member.");
    }

    const saveResponse = await fetch(`${API_BASE}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`, // Include JWT token
      },
      body: JSON.stringify({
        action: "remove",
        email: selectedMemberEmail,
      }),
    });

    if (!saveResponse.ok) {
      const text = await saveResponse.text();
      let errorMessage = text;
      try {
        const data = JSON.parse(text);
        errorMessage = data.message || text;
      } catch {
        // text is not JSON, keep as is
      }
      throw new Error(errorMessage || "Failed to remove member");
    }

    const result = await saveResponse.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to remove member");
    }

    // Success handling
    document.getElementById("removeMemberModal").style.display = "none";
    await loadTeamMembers();
    alert("Member removed successfully");
  } catch (err) {
    console.error("Error:", err);
    alert(err.message || "Error removing member");
  }
}

async function showRemoveMemberModal() {
  const modal = document.getElementById("removeMemberModal");
  const container = document.getElementById("membersListContainer");

  try {
    // Load current members
    const response = await fetch(`${API_BASE}/users`);
    const { users } = await response.json();
    membersToRemove = users;

    // Clear previous content
    container.innerHTML = "";

    // Add each member as a radio option
    users.forEach((user) => {
      const item = document.createElement("div");
      item.className = "member-remove-item";
      item.innerHTML = `
                    <label>
                      <input type="radio" name="memberToRemove" value="${user.email}">
                      <div class="member-info">
                        <div class="member-name">${user.name} (${user.role})</div>
                        <div class="member-email">${user.email}</div>
                        <div class="member-dept">${user.department}</div>
                      </div>
                    </label>
                  `;
      container.appendChild(item);
    });

    // Set up radio button change handler
    document
      .querySelectorAll('input[name="memberToRemove"]')
      .forEach((radio) => {
        radio.addEventListener("change", (e) => {
          selectedMemberEmail = e.target.value;
        });
      });

    // Show the modal
    modal.style.display = "flex";
  } catch (err) {
    console.error("Error loading members:", err);
    alert("Failed to load members list");
  }
}

async function openNewPaymentModal() {
  await Promise.all([
    loadEmployeesForPaymentModal(),
    loadSuppliersForPaymentModal(),
  ]);
  updateRecipientDropdown();
  // Show the modal (replace with your actual modal logic)
  document.getElementById("newPaymentModal").style.display = "flex";
}

function openNewSupplierPaymentModal() {
  document.getElementById("newSupplierPaymentModal").style.display = "flex";
  populateSupplierSelect();
}
function closeNewSupplierPaymentModal() {
  document.getElementById("newSupplierPaymentModal").style.display = "none";
}

function openPaySupplierInvoiceModal() {
  document.getElementById("paySupplierInvoiceModal").style.display = "flex";
  document.getElementById("paySupplierInvoiceForm").reset();
  document.getElementById("invoiceDetails").style.display = "none";
}
function closePaySupplierInvoiceModal() {
  document.getElementById("paySupplierInvoiceModal").style.display = "none";
}

async function populateSupplierSelect() {
  const select = document.getElementById("supplierSelect");
  select.innerHTML = "<option value=''>Loading...</option>";

  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      alert("Please log in to load suppliers.");
      select.innerHTML = "<option value=''>Please log in</option>";
      return;
    }

    const response = await fetch(`${API_BASE}/suppliers`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      select.innerHTML = "<option value=''>Failed to load suppliers</option>";
      return;
    }

    const data = await response.json();
    if (data.success) {
      select.innerHTML = "";
      const sortedSuppliers = data.suppliers.sort((a, b) => {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      sortedSuppliers.forEach((supplier) => {
        const option = document.createElement("option");
        option.value = supplier.id;
        option.textContent = supplier.name;
        select.appendChild(option);
      });
    } else {
      select.innerHTML = "<option value=''>No suppliers found</option>";
    }
  } catch (err) {
    console.error("Error loading suppliers:", err);
    select.innerHTML = "<option value=''>Error loading suppliers</option>";
  }
}

function openDraftPaymentModal() {
  document.getElementById("draftPaymentModal").style.display = "flex";
  populateDraftRecipientDropdown();
}

function openAddSupplierModal() {
  document.getElementById("addSupplierModal").style.display = "flex";
  document.getElementById("addSupplierForm").reset();
}
function closeAddSupplierModal() {
  document.getElementById("addSupplierModal").style.display = "none";
}

function openRemoveSupplierModal() {
  document.getElementById("removeSupplierModal").style.display = "flex";
  populateRemoveSupplierDropdown();
}

function closeRemoveSupplierModal() {
  document.getElementById("removeSupplierModal").style.display = "none";
}

async function submitAddSupplier(event) {
  event.preventDefault();
  const name = document.getElementById("supplierName").value;
  const email = document.getElementById("supplierEmail").value;
  const contact = document.getElementById("supplierContact").value;
  const lightningAddress = document.getElementById(
    "supplierLightningAddress",
  ).value;
  const note = document.getElementById("supplierNote").value;

  // Add createdAt timestamp
  const createdAt = new Date().toISOString();

  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      alert("You must be logged in to add a supplier.");
      return;
    }

    const response = await fetch(`${API_BASE}/suppliers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        contact,
        email,
        lightningAddress,
        note,
        createdAt,
      }),
    });

    const data = await response.json();
    if (data.success) {
      alert("Supplier added!");
      closeAddSupplierModal();
      loadSuppliers(); // Refresh supplier list/table
    } else {
      alert("Error: " + (data.message || "Failed to add supplier."));
    }
  } catch (err) {
    console.error("Error adding supplier:", err);
    alert("Error adding supplier.");
  }
}

async function loadEmployeesForPaymentModal() {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Not authenticated");
    const response = await fetch(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Failed to load employees");
    // The /api/users endpoint returns a naked array (see server.js)
    employeesList = await response.json();
  } catch (err) {
    console.error("Error loading employees for payment modal:", err);
    employeesList = [];
  }
}

async function loadSuppliersForPaymentModal() {
  try {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Not authenticated");
    const response = await fetch(`${API_BASE}/suppliers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Failed to load suppliers");
    const data = await response.json();
    suppliersList = data.suppliers || [];
  } catch (err) {
    console.error("Error loading suppliers for payment modal:", err);
    suppliersList = [];
  }
}

async function populateRemoveSupplierDropdown() {
  const select = document.getElementById("removeSupplierSelect");
  select.innerHTML = "<option value=''>Loading...</option>";
  try {
    const response = await fetch(`${API_BASE}/suppliers`);
    const data = await response.json();
    if (data.success) {
      select.innerHTML = "";
      data.suppliers.forEach((supplier) => {
        const option = document.createElement("option");
        option.value = supplier.id;
        option.textContent = supplier.name;
        select.appendChild(option);
      });
    } else {
      select.innerHTML = "<option value=''>No suppliers found</option>";
    }
  } catch {
    select.innerHTML = "<option value=''>Error loading suppliers</option>";
  }
}

async function submitRemoveSupplier(event) {
  event.preventDefault();
  const supplierId = document.getElementById("removeSupplierSelect").value;
  if (!supplierId) return;

  if (!confirm("Are you sure you want to remove this supplier?")) return;

  try {
    const token = sessionStorage.getItem("token");
    if (!token) {
      alert("You must be logged in to remove a supplier.");
      return;
    }

    const response = await fetch(`${API_BASE}/suppliers/${supplierId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    if (data.success) {
      alert("Supplier removed!");
      closeRemoveSupplierModal();
      loadSuppliers(); // Refresh supplier list/table
    } else {
      alert("Error: " + (data.message || "Failed to remove supplier."));
    }
  } catch (err) {
    console.error("Error removing supplier:", err);
    alert("Error removing supplier.");
  }
}

function togglePendingFilter() {
  showOnlyPending = !showOnlyPending;
  renderPendingDraftsTable(
    showOnlyPending ? allPendingDrafts : allDrafts,
    true,
  );
  addPendingDraftsTableSortHandlers();
}

function toggleVolcanoMode() {
  const body = document.body;
  const dashboard = document.getElementById("dashboard");
  const toggleText = document.getElementById("volcanoToggleText");
  const volcanoSwitch = document.getElementById("volcanoSwitch");
  const isLoggedIn = !!sessionStorage.getItem("token");
  if (!isLoggedIn) {
    body.classList.remove("volcano-mode");
    if (dashboard) dashboard.classList.remove("volcano-mode");
    localStorage.removeItem("volcanoMode");
    if (toggleText) toggleText.textContent = "🌋 Volcano";
    if (volcanoSwitch) volcanoSwitch.checked = false;
    return;
  }
  const isVolcano = body.classList.toggle("volcano-mode");
  if (dashboard) dashboard.classList.toggle("volcano-mode");
  if (isVolcano) {
    if (toggleText) toggleText.textContent = "🌋 Normal";
    if (volcanoSwitch) volcanoSwitch.checked = true;
    localStorage.setItem("volcanoMode", "on");
  } else {
    if (toggleText) toggleText.textContent = "🌋 Volcano";
    if (volcanoSwitch) volcanoSwitch.checked = false;
    localStorage.setItem("volcanoMode", "off");
  }
}
window.toggleVolcanoMode = toggleVolcanoMode;

function setVolcanoMode(isVolcano) {
  const body = document.body;
  const dashboard = document.getElementById("dashboard");
  const toggleText = document.getElementById("volcanoToggleText");
  const volcanoSwitch = document.getElementById("volcanoSwitch");

  if (isVolcano) {
    body.classList.add("volcano-mode");
    if (dashboard) dashboard.classList.add("volcano-mode");
    if (toggleText) toggleText.textContent = "🌋 Normal";
    if (volcanoSwitch) volcanoSwitch.checked = true;
    localStorage.setItem("volcanoMode", "on");
  } else {
    body.classList.remove("volcano-mode");
    if (dashboard) dashboard.classList.remove("volcano-mode");
    if (toggleText) toggleText.textContent = "🌋 Volcano";
    if (volcanoSwitch) volcanoSwitch.checked = false;
    localStorage.setItem("volcanoMode", "off");
  }
}

/////// DOM CONTENT LOADED LISTENER ///////
document.addEventListener("DOMContentLoaded", async () => {
  const token = sessionStorage.getItem("token");
  const isLoggedIn = token && token.split(".").length === 3;
  const volcanoPref = localStorage.getItem("volcanoMode");
  const body = document.body;
  const dashboard = document.getElementById("dashboard");
  const toggleText = document.getElementById("volcanoToggleText");
  const volcanoSwitch = document.getElementById("volcanoSwitch");
  const balanceElem = document.getElementById("balanceAmount");
  const detailsContainer = document.getElementById("transactionDetails");
  const transactionModal = document.getElementById("transactionModal");
  const transactionCloseBtn = document.getElementById("closeTransactionModal");
  const transactionDetailsContainer =
    document.getElementById("transactionDetails");

  updateCurrentDate();

  if (currentUser) {
    loadAccountingPage();
  }

  // Check if we're logged in (for page refresh)
  // Restore user session from token (preferred) or user object (legacy)
  if (token) {
    try {
      // Fetch user profile from backend
      const response = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        currentUser = data.user;
        showDashboard();
      } else {
        showContent("login");
      }
    } catch (err) {
      showContent("login");
    }
  } else {
    showContent("login");
  }

  if (isLoggedIn && volcanoPref === "on") {
    body.classList.add("volcano-mode");
    if (dashboard) dashboard.classList.add("volcano-mode");
    if (toggleText) toggleText.textContent = "🌋 Normal";
    if (volcanoSwitch) volcanoSwitch.checked = true;
  } else {
    body.classList.remove("volcano-mode");
    if (dashboard) dashboard.classList.remove("volcano-mode");
    if (toggleText) toggleText.textContent = "🌋 Volcano";
    if (volcanoSwitch) volcanoSwitch.checked = false;
  }

  // Setup navigation
  document.querySelectorAll(".nav-item").forEach((item) => {
    // Skip logout button which has its own handler
    if (!item.hasAttribute("onclick")) {
      item.addEventListener("click", function (event) {
        const contentId = this.getAttribute("data-content");
        if (contentId) {
          showContent(contentId, event);
        }
      });
    }
  });

  // Attach click handlers to each transaction row
  document.querySelectorAll("#transactionsTable tbody tr").forEach((row) => {
    row.addEventListener("click", () => {
      const txnId = row.getAttribute("data-txn-id");
      const txn = allTransactions.find((t) => t.id === txnId);
      if (txn) {
        showTransactionDetails(txn);
      } else {
        console.warn(`Transaction with id ${txnId} not found`);
      }
    });
  });

  document.querySelectorAll("#transactionsTable tbody tr").forEach((row) => {
      row.getAttribute("data-txn-id"),
    );

    row.addEventListener("click", () => {
      const txnId = row.getAttribute("data-txn-id");

      const txn = allTransactions.find((t) => t.id === txnId);
      if (txn) {
        showTransactionDetails(txn);
      } else {
        console.warn(`Transaction with id ${txnId} not found`);
      }
    });
  });

  const removeBtn = document.getElementById("removeDepartmentBtn");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      const dept = prompt("Enter department name to remove:");
      if (dept && dept.trim()) {
        await removeDepartment(dept.trim());
      }
    });
  }

  if (balanceElem) {
    balanceElem.addEventListener("click", () => {
      currentBalanceMode =
        (currentBalanceMode + 1) % balanceDisplayModes.length;
      updateBalanceDisplay();
    });
  }

  document.getElementById("th-date").onclick = function () {
    if (pendingDraftsSortColumn === "dateCreated") {
      pendingDraftsSortAsc = !pendingDraftsSortAsc;
    } else {
      pendingDraftsSortColumn = "dateCreated";
      pendingDraftsSortAsc = true;
    }
    renderPendingDraftsTable(allPendingDrafts);
  };
  document.getElementById("th-recipient").onclick = function () {
    if (pendingDraftsSortColumn === "recipientName") {
      pendingDraftsSortAsc = !pendingDraftsSortAsc;
    } else {
      pendingDraftsSortColumn = "recipientName";
      pendingDraftsSortAsc = true;
    }
    renderPendingDraftsTable(allPendingDrafts);
  };
  document.getElementById("th-note").onclick = function () {
    if (pendingDraftsSortColumn === "note") {
      pendingDraftsSortAsc = !pendingDraftsSortAsc;
    } else {
      pendingDraftsSortColumn = "note";
      pendingDraftsSortAsc = true;
    }
    renderPendingDraftsTable(allPendingDrafts);
  };
  document.getElementById("th-amount").onclick = function () {
    if (pendingDraftsSortColumn === "amount") {
      pendingDraftsSortAsc = !pendingDraftsSortAsc;
    } else {
      pendingDraftsSortColumn = "amount";
      pendingDraftsSortAsc = true;
    }
    renderPendingDraftsTable(allPendingDrafts);
  };
  document.getElementById("th-status").onclick = function () {
    if (pendingDraftsSortColumn === "status") {
      pendingDraftsSortAsc = !pendingDraftsSortAsc;
    } else {
      pendingDraftsSortColumn = "status";
      pendingDraftsSortAsc = true;
    }
    renderPendingDraftsTable(allPendingDrafts);
  };

  document.getElementById("togglePendingFilterBtn").onclick = function () {
    showOnlyPending = !showOnlyPending;
    this.textContent = showOnlyPending ? "Show All" : "Show Only Pending";
    renderPendingDraftsTable(
      showOnlyPending ? allPendingDrafts : allDrafts,
      true,
    );
    // If you need to re-attach sort handlers:
    addPendingDraftsTableSortHandlers && addPendingDraftsTableSortHandlers();
  };

  document
    .getElementById("recipientSelect")
    .addEventListener("change", populateRecipientDetails);

  document.getElementById("recipientType").addEventListener("change", () => {
    populateRecipientDetails();
  });

  document.getElementById("addDepartmentBtn").onclick = async function () {
    const dep = prompt("Enter new department name:");
    if (dep) {
      const token = sessionStorage.getItem("token");
      if (!token) {
        alert("You must be logged in to add a department.");
        return;
      }

      await fetch(`${API_BASE}/departments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ department: dep }),
      });

      await loadDepartments();
    }
  };

  document.getElementById("removeDepartmentBtn").onclick = async function () {
    const dep = prompt("Enter department name to remove:");
    if (dep) {
      const token = sessionStorage.getItem("token");
      if (!token) {
        alert("You must be logged in to remove a department.");
        return;
      }

      await fetch(`${API_BASE}/departments`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ department: dep }),
      });

      await loadDepartments();
    }
  };

  // Add Member button
  const addMemberBtn = document.getElementById("addMemberBtn");
  if (addMemberBtn) {
    addMemberBtn.addEventListener("click", async () => {
      // Show the modal
      document.getElementById("addMemberModal").style.display = "flex";

      // Populate the department dropdown
      await populateDepartmentSelect();
    });
  }

  const removeMemberBtn = document.getElementById("removeMemberBtn");
  if (removeMemberBtn) {
    removeMemberBtn.addEventListener("click", async () => {
      await showRemoveMemberModal();
    });
  }

  // Submit Member button
  const submitMemberBtn = document.getElementById("submitMemberBtn");
  if (submitMemberBtn) {
    submitMemberBtn.addEventListener("click", addTeamMember);
  }

  // Confirm removal handler
  const confirmRemoveBtn = document.getElementById("confirmRemoveBtn");
  if (confirmRemoveBtn) {
    confirmRemoveBtn.addEventListener("click", async () => {
      if (!selectedMemberEmail) {
        alert("Please select a member to remove");
        return;
      }

      try {
        const token = sessionStorage.getItem("token");
        if (!token) {
          alert("You must be logged in to remove a member.");
          return;
        }

        const saveResponse = await fetch(`${API_BASE}/users`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "remove",
            email: selectedMemberEmail,
          }),
        });

        const result = await saveResponse.json();

        if (!saveResponse.ok || !result.success) {
          throw new Error(result.message || "Failed to remove member");
        }

        document.getElementById("removeMemberModal").style.display = "none";
        await loadTeamMembers(); // Refresh the list
        alert("Member removed successfully");
        selectedMemberEmail = null; // Reset selection
      } catch (err) {
        console.error("Error:", err);
        alert(err.message || "Error removing member");
      }
    });
  }

  // Close modal handlers
  const closeRemoveModalBtn = document.getElementById("closeRemoveModalBtn");
  if (closeRemoveModalBtn) {
    closeRemoveModalBtn.addEventListener("click", () => {
      document.getElementById("removeMemberModal").style.display = "none";
    });
  }

  const cancelRemoveBtn = document.getElementById("cancelRemoveBtn");
  if (cancelRemoveBtn) {
    cancelRemoveBtn.addEventListener("click", () => {
      document.getElementById("removeMemberModal").style.display = "none";
    });
  }

  transactionCloseBtn.addEventListener("click", () => {
    transactionModal.style.display = "none";
  });

  window.addEventListener("click", (event) => {
    if (event.target === transactionModal) {
      transactionModal.style.display = "none";
    }
  });

  // Close when clicking outside modal
  window.addEventListener("click", (event) => {
    if (event.target === document.getElementById("removeMemberModal")) {
      document.getElementById("removeMemberModal").style.display = "none";
    }
  });

  // Close the Draft Payment modal
  document.getElementById("closeDraftButton").addEventListener("click", () => {
    const modal = document.getElementById("draftPaymentModal");
    if (modal) modal.style.display = "none";
  });

  // Close modal when clicking outside the modal content
  window.addEventListener("click", (event) => {
    const modal = document.getElementById("draftPaymentModal");
    if (event.target === modal) {
      modal.style.display = "none";
    }
  });

  document
    .getElementById("draftPaymentForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      // Get values from modal fields
      const draftTitle = document
        .getElementById("draftPaymentTitle")
        .value.trim();
      const recipientEmail = document.getElementById(
        "draftRecipientSelect",
      ).value;
      const recipientName = document
        .getElementById("draftRecipientName")
        .value.trim();
      const recipientLightningAddress = document
        .getElementById("draftRecipientLightningAddress")
        .value.trim();
      const amount = parseFloat(
        document.getElementById("draftPaymentAmount").value,
      );
      const note = document.getElementById("draftPaymentNote").value.trim();

      // Validation
      if (
        !draftTitle ||
        !recipientEmail ||
        !recipientName ||
        !recipientLightningAddress ||
        !amount ||
        isNaN(amount) ||
        amount <= 0
      ) {
        alert("Please fill in all required fields with valid values.");
        return;
      }

      const draftData = {
        title: draftTitle, // Include the draft title for backend validation
        recipientEmail,
        recipientName,
        recipientLightningAddress,
        amount,
        note,
      };

      try {
        const token = sessionStorage.getItem("token");
        if (!token) {
          alert("You must be logged in to submit a draft payment.");
          return;
        }

        const response = await fetch(`${API_BASE}/drafts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(draftData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || `Server error: ${response.status}`,
          );
        }

        const result = await response.json();

        if (result.success) {
          alert("Draft payment submitted successfully!");
          document.getElementById("draftPaymentForm").reset();
          document.getElementById("draftPaymentModal").style.display = "none";
          await loadEmployeeDrafts(); // Refresh draft list after submission
        } else {
          alert(
            "Failed to submit draft: " + (result.message || "Unknown error"),
          );
        }
      } catch (err) {
        console.error("Error submitting draft:", err);
        alert("Error submitting draft: " + err.message);
      }
    });

  // Close modals
  const closeMemberModalBtn = document.getElementById("closeMemberModalBtn");
  if (closeMemberModalBtn) {
    closeMemberModalBtn.addEventListener("click", () => {
      document.getElementById("addMemberModal").style.display = "none";
    });
  }

  const closeSuccessBtn = document.getElementById("closeSuccessBtn");
  if (closeSuccessBtn) {
    closeSuccessBtn.addEventListener("click", () => {
      document.getElementById("successModal").style.display = "none";
    });
  }

  // Close modals when clicking outside
  window.addEventListener("click", (event) => {
    if (event.target === document.getElementById("addMemberModal")) {
      document.getElementById("addMemberModal").style.display = "none";
    }
    if (event.target === document.getElementById("successModal")) {
      document.getElementById("successModal").style.display = "none";
    }
  });

  const newPaymentBtn = document.getElementById("newPaymentBtn");
  if (newPaymentBtn) {
    newPaymentBtn.addEventListener("click", () => {
      document.getElementById("newPaymentModal").style.display = "flex";
    });
  }

  const closeModalBtn = document.getElementById("closeModal");
  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => {
      document.getElementById("newPaymentModal").style.display = "none";
    });
  }

  const submitPaymentBtn = document.getElementById("submitPaymentBtn");
  if (submitPaymentBtn) {
    submitPaymentBtn.addEventListener("click", submitPayment);
  }

  window.addEventListener("click", (event) => {
    if (event.target === document.getElementById("newPaymentModal")) {
      document.getElementById("newPaymentModal").style.display = "none";
    }
  });

  // Event listeners
  const passwordField = document.getElementById("password");
  if (passwordField) {
    passwordField.addEventListener("keyup", function (event) {
      if (event.key === "Enter") {
        login();
      }
    });
  }

  const loginBtn = document.getElementById("loginButton");
  if (loginBtn) {
    loginBtn.addEventListener("click", login);
  }

  const forgotBtn = document.getElementById("forgotPasswordBtn");
  if (forgotBtn) {
    forgotBtn.onclick = async function () {
      const msgDiv = document.getElementById("forgotPasswordMessage");
      if (!currentUser || !currentUser.email) {
        msgDiv.textContent = "You must be logged in to reset your password.";
        return;
      }

      msgDiv.textContent = "Sending email...";
      forgotBtn.disabled = true;

      try {
        const response = await fetch(`${API_BASE}/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: currentUser.email }),
        });
        const data = await response.json();

        if (response.ok && data.success) {
          msgDiv.textContent = "A new password has been sent to your email.";
        } else {
          msgDiv.textContent = data.message || "Failed to send email.";
        }
      } catch (err) {
        msgDiv.textContent = "Error sending email. Please try again.";
        console.error(err);
      } finally {
        forgotBtn.disabled = false;
      }
    };
  }

  setVolcanoMode(localStorage.getItem("volcanoMode") === "on");
  if (volcanoSwitch) {
    volcanoSwitch.addEventListener("change", function () {
      setVolcanoMode(this.checked);
    });
  }

  if (toggleText && volcanoSwitch) {
    toggleText.style.cursor = "pointer";
    toggleText.addEventListener("click", () => {
      volcanoSwitch.checked = !volcanoSwitch.checked;
      setVolcanoMode(volcanoSwitch.checked);
    });
  }

  if (localStorage.getItem("volcanoMode") === "on") {
    document.body.classList.add("volcano-mode");
    const dashboard = document.getElementById("dashboard");
    if (dashboard) dashboard.classList.add("volcano-mode");
    const toggleText = document.getElementById("volcanoToggleText");
    const volcanoSwitch = document.getElementById("volcanoSwitch");
    if (toggleText) toggleText.textContent = "🌋 Normal";
    if (volcanoSwitch) volcanoSwitch.checked = true;
  }
});

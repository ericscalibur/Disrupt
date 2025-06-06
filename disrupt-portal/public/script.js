// API base URL
const API_BASE = "http://localhost:3001";
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

// Restore currentUser from sessionStorage if available
if (!currentUser) {
  const userStr = sessionStorage.getItem("user");
  if (userStr) {
    currentUser = JSON.parse(userStr);
  }
}

// Login function
async function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const errorMessage = document.getElementById("errorMessage");

  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (data.success && data.token) {
      // Store only the token
      sessionStorage.setItem("token", data.token);

      // Optionally, fetch user profile for display
      const profileResp = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      const profile = await profileResp.json();

      if (profile.success) {
        currentUser = profile.user;
        showDashboard();
      } else {
        errorMessage.textContent = "Failed to load user profile.";
        errorMessage.style.display = "block";
      }
    } else {
      errorMessage.style.display = "block";
    }
  } catch (err) {
    console.error("Login error:", err);
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

function addEmployeeDraftsTableSortHandlers() {
  const table = document.getElementById("draftsTable");
  if (!table) return;
  const headers = table.querySelectorAll("th");
  headers.forEach((th, idx) => {
    th.style.cursor = "pointer";
    th.onclick = () => sortEmployeeDraftsByColumn(idx);
  });
}

async function loadDrafts() {
  try {
    const response = await fetch(`${API_BASE}/api/drafts`);
    const data = await response.json();
    if (data.success) {
      // Filter drafts to only those created by this employee/bookkeeper
      employeeDrafts = (data.drafts || []).filter(
        (d) => d.createdBy === currentUser.email, // Adjust property if needed
      );
      renderPendingDraftsTable(employeeDrafts, false); // No action buttons
      addEmployeeDraftsTableSortHandlers();
    } else {
      employeeDrafts = [];
      renderPendingDraftsTable([], false);
    }
  } catch (err) {
    employeeDrafts = [];
    renderPendingDraftsTable([], false);
    console.error("Error loading drafts:", err);
  }
}

function renderPendingDraftsTable(drafts, showActions = true) {
  console.log(
    "Rendering drafts for pendingDraftsTable:",
    drafts,
    "showActions:",
    showActions,
  );
  const tbody = document.querySelector("#pendingDraftsTable tbody");
  console.log("Found tbody?", tbody);
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
}

async function loadAccountingPage() {
  try {
    if (currentUser.role === "Admin" || currentUser.role === "Manager") {
      // Show transactions, hide drafts
      document.getElementById("transactionsTable").style.display = "";
      document.getElementById("transactionsHistoryTitle").style.display = "";
      document.getElementById("draftsTable").style.display = "none";
      document.getElementById("draftsHistoryTitle").style.display = "none";
      await loadTransactions();
      await loadPendingDrafts();
    } else {
      // Show drafts, hide transactions
      document.getElementById("transactionsTable").style.display = "none";
      document.getElementById("transactionsHistoryTitle").style.display =
        "none";
      document.getElementById("draftsTable").style.display = "";
      document.getElementById("draftsHistoryTitle").style.display = "";
      await loadDrafts();
    }
    await updateLightningBalance();
    updateAccountingActionsVisibility();
  } catch (err) {
    console.log("Failed to load accounting data");
  }
}

function renderRecentDraftsTable(drafts) {
  const tbody = document.querySelector("#draftsTable tbody");
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

async function populateDraftRecipientDropdown() {
  const select = document.getElementById("draftRecipientSelect");
  select.innerHTML = '<option value="">Select supplier...</option>';

  try {
    const response = await fetch(`${API_BASE}/suppliers`);
    const data = await response.json();
    const suppliers = data.suppliers || [];

    suppliers.forEach((supplier) => {
      const option = document.createElement("option");
      option.value = supplier.email; // or supplier.id if you use IDs
      option.textContent = supplier.name;
      select.appendChild(option);
    });
  } catch (err) {
    console.error("Failed to load suppliers:", err);
    select.innerHTML = '<option value="">Unable to load suppliers</option>';
  }
}

// Open the Draft Payment modal
function openDraftPaymentModal() {
  const modal = document.getElementById("draftPaymentModal");
  if (modal) modal.style.display = "flex";
  populateDraftRecipientDropdown();
}

async function populateDraftRecipientDetails() {
  const select = document.getElementById("draftRecipientSelect");
  const email = select.value;
  if (!email) {
    document.getElementById("draftRecipientName").value = "";
    document.getElementById("draftRecipientEmail").value = "";
    document.getElementById("draftRecipientLightningAddress").value = "";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/suppliers`);
    const data = await response.json();
    const suppliers = data.suppliers || [];
    const supplier = suppliers.find((s) => s.email === email);

    if (supplier) {
      document.getElementById("draftRecipientName").value = supplier.name || "";
      document.getElementById("draftRecipientEmail").value =
        supplier.email || "";
      document.getElementById("draftRecipientLightningAddress").value =
        supplier.lightningAddress || "";
    }
  } catch (err) {
    console.error("Failed to load supplier details:", err);
  }
}

// Show content function
async function showContent(contentId, event) {
  // Hide all content sections
  document.getElementById("welcomeContent").style.display = "none";
  document.getElementById("accountingContent").style.display = "none";
  document.getElementById("teamPageContent").style.display = "none";
  document.getElementById("settingsContent").style.display = "none";
  document.getElementById("suppliersContent").style.display = "none";
  const pendingContent = document.getElementById("pendingContent");
  if (pendingContent) pendingContent.style.display = "none";

  // Restrict pendingContent to Admin/Manager only
  if (contentId === "pending") {
    if (currentUser.role === "Admin" || currentUser.role === "Manager") {
      if (pendingContent) pendingContent.style.display = "block";
      try {
        await loadPendingDrafts();
      } catch (err) {
        console.error(`Error loading pending data:`, err);
      }
    } else {
      // Optionally, show an error or redirect
      alert("You do not have permission to view this page.");
      return;
    }
  } else {
    // Show selected content
    const contentElement = document.getElementById(
      (contentId === "team" ? "teamPage" : contentId) + "Content",
    );
    if (contentElement) {
      contentElement.style.display = "block";
    }
  }

  if (contentId === "welcome") {
    document.body.classList.remove("volcano-mode");
  }

  // Update active nav item
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => item.classList.remove("active"));
  if (event && event.currentTarget) {
    event.currentTarget.classList.add("active");
  }

  // Load data based on tab
  try {
    if (contentId === "accounting") {
      loadAccountingPage();
    } else if (contentId === "team") {
      await loadTeamMembers();
      await loadDepartments();
    } else if (contentId === "suppliers") {
      loadSuppliers();
    }
    // No need to loadPendingDrafts() here, it's handled above for pending
  } catch (err) {
    console.error(`Error loading ${contentId} data:`, err);
  }
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
    const response = await fetch(`${API_BASE}/api/drafts`);
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
    const response = await fetch(`${API_BASE}/api/drafts`);
    const data = await response.json();

    if (data.success) {
      const employeeDrafts = (data.drafts || []).filter(
        (d) => d.createdBy === currentUser.email,
      );
      renderEmployeeDraftsTable(employeeDrafts);
      addEmployeeDraftsTableSortHandlers &&
        addEmployeeDraftsTableSortHandlers();
    } else {
      renderEmployeeDraftsTable([]);
    }
  } catch (err) {
    renderEmployeeDraftsTable([]);
    console.error("Error loading employee drafts:", err);
  }
}

// Add this after rendering the table
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

// For employees/bookkeepers
function renderEmployeeDraftsTable(drafts) {
  const tbody = document.querySelector("#draftsTable tbody");
  tbody.innerHTML = "";

  if (!drafts || drafts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-message">No drafts found.</td></tr>`;
    return;
  }

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
      statusText = draft.status;
      statusClass = "";
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

function renderEmployeeDraftsTable(drafts) {
  const tbody = document.querySelector("#draftsTable tbody");
  tbody.innerHTML = "";

  if (!drafts || drafts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-message">No drafts found.</td></tr>`;
    return;
  }

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
      statusText = draft.status;
      statusClass = "";
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

  // If you have sorting handlers, call them here:
  if (typeof addEmployeeDraftsTableSortHandlers === "function") {
    addEmployeeDraftsTableSortHandlers();
  }
}

async function handleDraftApproval(e) {
  const draftId = e.target.getAttribute("data-draft-id");

  if (confirm("Are you sure you want to approve this draft payment?")) {
    try {
      // First get the draft details
      const response = await fetch(`${API_BASE}/api/drafts`);
      const data = await response.json();
      const draft = data.drafts.find((d) => d.id === draftId);

      if (!draft) {
        alert("Draft not found!");
        return;
      }

      // Process the payment using your existing payment flow
      const paymentResult = await processPayment(draft);

      if (paymentResult.success) {
        // Update the draft status
        const updateResponse = await fetch(`${API_BASE}/api/drafts/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId }),
        });

        const updateResult = await updateResponse.json();

        if (updateResult.success) {
          alert("Draft approved and payment sent successfully!");
          loadPendingDrafts(); // Refresh the table
        } else {
          alert("Payment sent but draft status update failed.");
        }
      } else {
        alert("Payment failed: " + paymentResult.message);
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
      const response = await fetch(`${API_BASE}/api/drafts/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });

      const result = await response.json();

      if (result.success) {
        alert("Draft declined successfully.");
        loadPendingDrafts(); // Refresh the table
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

// Helper function to process the payment
async function processPayment(draft) {
  try {
    // This should use your existing payment logic
    const response = await fetch(`${API_BASE}/send-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientLightningAddress: draft.recipientLightningAddress,
        amount: draft.amount,
        note: draft.note || draft.description || "",
      }),
    });

    return await response.json();
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function updateLightningBalance() {
  const balanceElem = document.getElementById("balanceAmount");
  const spinnerElem = document.getElementById("balanceSpinner");
  try {
    if (spinnerElem) spinnerElem.style.display = "inline";
    if (balanceElem) balanceElem.style.visibility = "hidden";

    const response = await fetch(`${API_BASE}/lightning-balance`);
    const data = await response.json();
    if (data.success) {
      const sats = data.balanceSats;
      const btc = (sats / 100_000_000).toFixed(8);
      balanceElem.textContent = `${btc} BTC`;
    } else {
      balanceElem.textContent = "Error";
    }
  } catch (err) {
    balanceElem.textContent = "Error";
  } finally {
    if (spinnerElem) spinnerElem.style.display = "none";
    if (balanceElem) balanceElem.style.visibility = "visible";
  }
}

// Load departments and populate the list
async function loadDepartments() {
  try {
    const response = await fetch(`${API_BASE}/api/departments`);
    if (!response.ok) throw new Error("Failed to fetch departments");
    const departments = await response.json();
    const list = document.getElementById("departmentsList");
    if (!list) return;
    list.innerHTML = "";
    departments.forEach((dep) => {
      const li = document.createElement("li");
      li.textContent = dep;
      list.appendChild(li);
    });
  } catch (err) {
    console.error("Error loading departments:", err);
  }
}

// Add a new department
async function addDepartment() {
  const input = document.getElementById("newDepartment");
  if (!input) return;
  const dep = input.value.trim();
  if (!dep) return;
  try {
    const response = await fetch(`${API_BASE}/api/departments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    const response = await fetch(`${API_BASE}/api/departments`, {
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
    const response = await fetch(`${API_BASE}/api/departments`);
    if (!response.ok) throw new Error("Failed to fetch departments");
    const departments = await response.json();
    const select = document.getElementById("removeDepartmentSelect");
    if (!select) return;
    select.innerHTML = "";
    departments.forEach((dep) => {
      const option = document.createElement("option");
      option.value = dep;
      option.textContent = dep;
      select.appendChild(option);
    });
  } catch (err) {
    console.error("Error loading remove department select:", err);
  }
}

async function populateDepartmentsList() {
  try {
    const response = await fetch(`${API_BASE}/api/departments`);
    if (!response.ok) throw new Error("Failed to fetch departments");
    let departments = await response.json();
    const deptList = document.getElementById("departmentsList");
    deptList.innerHTML = "";

    // Role-based filtering
    if (currentUser.role === "Manager" || currentUser.role === "Employee") {
      departments = departments.filter((dep) => dep === currentUser.department);
    }

    departments.forEach((dep) => {
      const li = document.createElement("li");
      li.textContent = dep;
      deptList.appendChild(li);
    });
  } catch (err) {
    console.error("Error populating departments list:", err);
  }
}

async function populateDepartmentSelect() {
  try {
    const response = await fetch(`${API_BASE}/api/departments`);
    if (!response.ok) throw new Error("Failed to fetch departments");
    const departments = await response.json();
    const select = document.getElementById("memberDepartment");
    if (!select) return;
    select.innerHTML = '<option value="">Select Department</option>';
    departments.forEach((dep) => {
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
    const response = await fetch(`${API_BASE}/suppliers`);
    const data = await response.json();
    if (data.success) {
      renderSuppliers(data.suppliers);
    }
  } catch (err) {
    console.error("Error loading suppliers:", err);
  }
}

function renderSuppliers(suppliers) {
  suppliers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tbody = document.querySelector("#suppliersTable tbody");
  tbody.innerHTML = "";
  suppliers.forEach((supplier) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${supplier.name}</td>
      <td>${supplier.contact}</td>
      <td>${supplier.email}</td>
      <td>${supplier.lightningAddress}</td>
      <td>${supplier.note || ""}</td>
      <td>${supplier.createdAt ? new Date(supplier.createdAt).toLocaleString() : ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Load transactions
async function loadTransactions() {
  try {
    const response = await fetch(`${API_BASE}/transactions`);
    const data = await response.json();

    if (data.success) {
      renderTransactions(data.transactions);
    }
  } catch (err) {
    console.error("Error loading transactions:", err);
  }
}

// Render transactions to table
function renderTransactions(transactions) {
  const tbody = document.querySelector("#transactionsTable tbody");
  tbody.innerHTML = "";
  transactions.forEach((txn) => {
    const icon = txn.type === "lightning" ? "⚡" : "";
    const receiver = txn.receiver || "";
    const address = txn.address || "";
    const amount = txn.amount || "";
    const note = txn.note || "";
    const id = txn.id || "";
    const date = txn.date ? txn.date.split("T")[0] : "";
    tbody.innerHTML += `
        <tr>
          <td>${date}</td>
          <td>${receiver}</td>
          <td>${address}</td>
          <td>${amount}</td>
          <td>${note}</td>
          <td>${id}</td>
        </tr>
      `;
  });
}

// Load employees and suppliers from backend
async function loadRecipientLists() {
  // Load employees
  try {
    const empRes = await fetch(`${API_BASE}/employees`);
    const empData = await empRes.json();
    employeesList = empData.success ? empData.employees : [];
  } catch {
    employeesList = [];
  }
  // Load suppliers
  try {
    const supRes = await fetch(`${API_BASE}/suppliers`);
    const supData = await supRes.json();
    suppliersList = supData.success ? supData.suppliers : [];
  } catch {
    suppliersList = [];
  }
  updateRecipientDropdown();
}

function closeNewPaymentModal() {
  document.getElementById("newPaymentModal").style.display = "none";
}

function updateRecipientDropdown() {
  const type = document.getElementById("recipientType").value;
  const select = document.getElementById("recipientSelect");
  select.innerHTML = "";
  const list = type === "employee" ? employeesList : suppliersList;
  list.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.appendChild(option);
  });
  // Auto-populate details for the first recipient in the list
  if (list.length > 0) {
    select.value = list[0].id;
    populateRecipientDetails();
  } else {
    // Clear fields if no recipients
    document.getElementById("recipientName").value = "";
    document.getElementById("recipientEmail").value = "";
    document.getElementById("recipientLightningAddress").value = "";
  }
}

function populateRecipientDetails() {
  const type = document.getElementById("recipientType").value;
  const id = document.getElementById("recipientSelect").value;
  const list = type === "employee" ? employeesList : suppliersList;
  const recipient = list.find((item) => item.id === id);
  document.getElementById("recipientName").value = recipient
    ? recipient.name
    : "";
  document.getElementById("recipientEmail").value = recipient
    ? recipient.email
    : "";
  document.getElementById("recipientLightningAddress").value = recipient
    ? recipient.lightningAddress
    : "";
}

function openNewPaymentModal() {
  document.getElementById("newPaymentModal").style.display = "flex";
  document.getElementById("newPaymentForm").reset();
  loadRecipientLists();
}

function closeNewPaymentModal() {
  document.getElementById("newPaymentModal").style.display = "none";
}

// PAY INVOICE MODAL
function openPayInvoiceModal() {
  document.getElementById("payInvoiceModal").style.display = "flex";
  document.getElementById("payInvoiceForm").reset();
}
function closePayInvoiceModal() {
  document.getElementById("payInvoiceModal").style.display = "none";
}

async function submitNewPayment(event) {
  event.preventDefault();

  // Show spinner (optional: if you have a spinner for the modal)
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

  try {
    const response = await fetch(`${API_BASE}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        id,
        name,
        email,
        lightningAddress,
        amount,
        note,
      }),
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
    alert("Error sending payment.");
  } finally {
    // Re-enable button and restore text
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

  // Find and disable the submit button, show spinner text
  const submitBtn = document.querySelector("#payInvoiceModal .submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Paying...";
  }

  // Build the payload
  const payload = { invoice, note };
  // If userAmount is visible and filled, add it to the payload
  const amountEntryDiv = document.getElementById("amountEntry");
  if (amountEntryDiv && amountEntryDiv.style.display !== "none" && userAmount) {
    payload.amount = userAmount;
  }

  try {
    const response = await fetch(`${API_BASE}/pay-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    alert("Error paying invoice.");
  } finally {
    // Re-enable the button and reset text
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Pay";
    }
  }
}

function clearInvoiceDetails() {
  const detailsDiv = document.getElementById("invoiceDetails");
  if (detailsDiv) detailsDiv.innerHTML = "";
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
    const response = await fetch("http://localhost:3001/decode-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice }),
    });
    const data = await response.json();
    if (data.success) {
      const decoded = data.decoded;
      let html = `<ul style="list-style:none;padding:0;">`;

      // Payment Request
      if (decoded.paymentRequest) {
        html += `<li><strong>Payment Request:</strong> <span style="word-break:break-all;font-family:monospace;">${decoded.paymentRequest}</span></li>`;
      }

      let expiryStr = "";
      if (decoded.timestamp && decoded.expiry) {
        // Both fields exist
        const invoiceCreatedAt = Number(decoded.timestamp); // seconds since epoch
        const invoiceExpiresAt = invoiceCreatedAt + Number(decoded.expiry); // expiry timestamp in seconds
        const now = Math.floor(Date.now() / 1000); // current time in seconds
        const secondsLeft = invoiceExpiresAt - now;

        if (isNaN(secondsLeft)) {
          expiryStr = `<span style="color:#e74c3c;">Unknown</span>`;
        } else if (secondsLeft <= 0) {
          expiryStr = `<span style="color:#ff1744;font-weight:bold;">Expired!</span>`;
        } else {
          const expiryHours = Math.floor(secondsLeft / 3600);
          const expiryMins = Math.floor((secondsLeft % 3600) / 60);
          if (expiryHours > 0) {
            expiryStr = `${expiryHours} hour(s) ${expiryMins} min(s)`;
          } else if (expiryMins > 0) {
            expiryStr = `${expiryMins} min(s)`;
          } else {
            expiryStr = `${secondsLeft} sec(s)`;
          }
        }
      } else {
        expiryStr = `<span style="color:#e74c3c;">EXPIRED!</span>`;
      }
      html += `<li><strong>Expires In:</strong> ${expiryStr}</li>`;

      // Extract from sections
      let amountSection = null;
      let descSection = null;
      let payeeSection = null;
      if (decoded.sections && decoded.sections.length > 0) {
        amountSection = decoded.sections.find((s) => s.name === "amount");
        if (amountSection) {
          html += `<li><strong>Amount:</strong> ${amountSection.value} sats</li>`;
        }

        descSection = decoded.sections.find((s) => s.name === "description");
        if (descSection) {
          html += `<li><strong>Description:</strong> ${descSection.value}</li>`;
        }

        payeeSection = decoded.sections.find(
          (s) => s.name === "payee_node_key",
        );
        if (payeeSection) {
          html += `<li><strong>Destination:</strong> <span style="font-family:monospace;">${payeeSection.value}</span></li>`;
        }
      }

      html += `</ul>`;
      detailsDiv.innerHTML = `<div class="content-card">${html}</div>`;

      // Show or hide the amount entry input
      if (!amountSection) {
        if (amountEntryDiv) amountEntryDiv.style.display = "block";
        if (userAmountInput) userAmountInput.required = true;
      } else {
        if (amountEntryDiv) amountEntryDiv.style.display = "none";
        if (userAmountInput) {
          userAmountInput.required = false;
          userAmountInput.value = ""; // Clear any previous value
        }
      }
    } else {
      detailsDiv.innerHTML = `<span style="color:red;">Invalid or unsupported invoice.</span>`;
      if (amountEntryDiv) amountEntryDiv.style.display = "none";
      if (userAmountInput) userAmountInput.required = false;
    }
  } catch (err) {
    detailsDiv.innerHTML = `<span style="color:red;">Error decoding invoice.</span>`;
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
    const response = await fetch(`${API_BASE}/transactions`);
    const data = await response.json();

    if (data.success) {
      renderTransactions(data.transactions);
    } else {
      console.error("Failed to load transactions:", data.message);
    }
  } catch (err) {
    console.error("Error loading transactions:", err);
  }
}

// Render transactions to the table
function renderTransactions(transactions) {
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  const tbody = document.querySelector("#transactionsTable tbody");
  tbody.innerHTML = ""; // Clear existing rows
  const recentTransactions = transactions.slice(0, 15);

  recentTransactions.forEach((txn) => {
    const row = document.createElement("tr");
    row.innerHTML = `
                  <td>${formatDate(txn.date)}</td>
                  <td>${txn.receiver || txn.name || "N/A"}</td>
                  <td class="amount-cell">${txn.amount} ${txn.currency}</td>
                  <td class="txn-id">${txn.id}</td>
                  <td>${txn.note || ""}</td>
                `;
    tbody.appendChild(row);
  });
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

// Team Members Functions
async function loadTeamMembers() {
  const tbody = document.querySelector("#teamTable tbody");
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="5" class="loading-message">Loading team members...</td></tr>';

  try {
    const response = await fetch(`${API_BASE}/users`);
    if (!response.ok) {
      let errorMsg = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.message) errorMsg += ` - ${errorData.message}`;
      } catch (e) {}
      throw new Error(errorMsg);
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.users)) {
      throw new Error("Invalid response format from server");
    }

    // --- Filtering logic based on currentUser role ---
    let filteredUsers = data.users;
    if (currentUser) {
      if (currentUser.role === "Admin") {
        // CEO sees all
      } else if (
        currentUser.role === "Manager" ||
        currentUser.role === "Employee"
      ) {
        filteredUsers = data.users.filter(
          (user) => user.department === currentUser.department,
        );
      }
    }
    renderTeamMembers(filteredUsers);
    updateTeamActionsVisibility();
  } catch (err) {
    console.error("Failed to load team members:", err);
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="error-message">
          Failed to load team members.
          ${err.message || "Please try again later."}
        </td>
      </tr>
    `;
    const retryButton = document.createElement("button");
    retryButton.textContent = "Retry";
    retryButton.className = "retry-btn";
    retryButton.onclick = loadTeamMembers;
    tbody.querySelector("td").appendChild(retryButton);
  }
}

function renderTeamMembers(users) {
  const tbody = document.querySelector("#teamTable tbody");
  tbody.innerHTML = "";

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="loading-message">No team members found for your department.</td>
      </tr>
    `;
    return;
  }

  users.forEach((user) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.role}</td>
      <td>${user.department}</td>
      <td>${user.email}</td>
      <td>${user.dateAdded || "N/A"}</td>
    `;
    tbody.appendChild(row);
  });
}

function updateAccountingActionsVisibility() {
  const btnRow = document.getElementById("accountingBtnRow"); // add id to your <div>
  const newPaymentBtn = document.getElementById("newPaymentBtn");
  const payInvoiceBtn = document.getElementById("payInvoiceBtn");
  const draftBtn = document.getElementById("draftPaymentBtn");

  if (!newPaymentBtn || !payInvoiceBtn || !draftBtn) return;

  if (currentUser.role === "Admin" || currentUser.role === "Manager") {
    newPaymentBtn.style.display = "inline-block";
    payInvoiceBtn.style.display = "inline-block";
    draftBtn.style.display = "none";
  } else if (currentUser.role === "Employee") {
    newPaymentBtn.style.display = "none";
    payInvoiceBtn.style.display = "none";
    draftBtn.style.display = "inline-block";
  } else if (currentUser.role === "Bookkeeper") {
    btnRow.style.display = "none";
    return;
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

  if (!addBtn || !removeBtn) return;

  if (currentUser.role === "Admin" || currentUser.role === "Manager") {
    addBtn.style.display = "inline-block";
    removeBtn.style.display = "inline-block";
  } else {
    addBtn.style.display = "none";
    removeBtn.style.display = "none";
  }
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
      address: document.getElementById("memberLightning").value.trim(),
    };

    // Validation
    if (
      !newMember.name ||
      !newMember.role ||
      !newMember.email ||
      !newMember.department ||
      !newMember.address
    ) {
      throw new Error("Please fill in all required fields");
    }

    const response = await fetch(`${API_BASE}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newMember),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to add member");
    }

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
    const saveResponse = await fetch(`${API_BASE}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove",
        email: selectedMemberEmail,
      }),
    });

    const result = await saveResponse.json();

    if (!saveResponse.ok || !result.success) {
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
    const response = await fetch(`${API_BASE}/suppliers`);
    const data = await response.json();
    if (data.success) {
      select.innerHTML = "";
      // Sort suppliers by createdAt descending (most recent first)
      const sortedSuppliers = data.suppliers.sort((a, b) => {
        // If createdAt is a string, convert to Date
        return new Date(b.createdAt) - new Date(a.createdAt);
        // If createdAt is a UNIX timestamp in seconds, use:
        // return b.createdAt - a.createdAt;
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
  } catch {
    select.innerHTML = "<option value=''>Error loading suppliers</option>";
  }
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
    const response = await fetch(`${API_BASE}/suppliers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      loadSuppliers(); // Refresh table
    } else {
      alert("Error: " + (data.message || "Failed to add supplier."));
    }
  } catch (err) {
    alert("Error adding supplier.");
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
    const response = await fetch(`${API_BASE}/suppliers/${supplierId}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (data.success) {
      alert("Supplier removed!");
      closeRemoveSupplierModal();
      loadSuppliers(); // Refresh table
    } else {
      alert("Error: " + (data.message || "Failed to remove supplier."));
    }
  } catch (err) {
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
  const isLoggedIn = sessionStorage.getItem("token") === "logged-in";
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
  updateCurrentDate();

  // Check if we're logged in (for page refresh)
  // Restore user session from token (preferred) or user object (legacy)
  const token = sessionStorage.getItem("token");
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

  const isLoggedIn = sessionStorage.getItem("token") === "logged-in";
  const volcanoPref = localStorage.getItem("volcanoMode");
  const body = document.body;
  const dashboard = document.getElementById("dashboard");
  const toggleText = document.getElementById("volcanoToggleText");
  const volcanoSwitch = document.getElementById("volcanoSwitch");

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

  const removeBtn = document.getElementById("removeDepartmentBtn");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      const dept = prompt("Enter department name to remove:");
      if (dept && dept.trim()) {
        await removeDepartment(dept.trim());
      }
    });
  }

  document.addEventListener("change", async (e) => {
    if (e.target.classList.contains("approve-draft-checkbox")) {
      const draftId = e.target.getAttribute("data-draft-id");
      if (e.target.checked && confirm("Approve this draft?")) {
        try {
          const response = await fetch(`${API_BASE}/api/drafts/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draftId }),
          });
          const result = await response.json();
          if (result.success) {
            alert("Draft approved!");
            loadDrafts();
          } else {
            alert("Approval failed: " + (result.message || "Unknown error"));
          }
        } catch (err) {
          alert("Error approving draft: " + err.message);
        }
      } else {
        e.target.checked = false;
      }
    }
  });

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

  document.getElementById("addDepartmentBtn").onclick = async function () {
    const dep = prompt("Enter new department name:");
    if (dep) {
      await fetch(`${API_BASE}/api/departments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department: dep }),
      });
      await loadDepartments();
    }
  };

  document.getElementById("removeDepartmentBtn").onclick = async function () {
    const dep = prompt("Enter department name to remove:");
    if (dep) {
      await fetch(`${API_BASE}/api/departments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department: dep }),
      });
      await loadDepartments();
    }
  };

  const payInvoiceForm = document.getElementById("payInvoiceForm");
  if (payInvoiceForm) {
    payInvoiceForm.addEventListener("submit", submitPayInvoice);
  }

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
        // Send removal request to backend
        const saveResponse = await fetch(`${API_BASE}/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "remove",
            email: selectedMemberEmail,
          }),
        });
        const result = await saveResponse.json();

        if (!saveResponse.ok || !result.success) {
          throw new Error(result.message || "Failed to remove member");
        }

        // Success handling
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

  // Close when clicking outside modal
  window.addEventListener("click", (event) => {
    if (event.target === document.getElementById("removeMemberModal")) {
      document.getElementById("removeMemberModal").style.display = "none";
    }
  });

  // Close the Draft Payment modal
  document.getElementById("closeDraftModal").addEventListener("click", () => {
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
      const recipientEmail = document.getElementById(
        "draftRecipientSelect",
      ).value;
      const recipientName = document.getElementById("draftRecipientName").value;
      const recipientLightningAddress = document.getElementById(
        "draftRecipientLightningAddress",
      ).value;
      const amount = parseFloat(
        document.getElementById("draftPaymentAmount").value,
      );
      const note = document.getElementById("draftPaymentNote").value;

      // Validation
      if (
        !recipientEmail ||
        !recipientName ||
        !recipientLightningAddress ||
        !amount
      ) {
        alert("Please fill in all required fields.");
        return;
      }

      const draftData = {
        recipientEmail,
        recipientName,
        recipientLightningAddress,
        amount,
        note,
        dateCreated: new Date().toISOString(),
        createdBy: currentUser.email,
        status: "pending",
      };

      try {
        const response = await fetch(`${API_BASE}/api/drafts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftData),
        });

        const result = await response.json();
        if (result.success) {
          alert("Draft payment submitted successfully!");
          document.getElementById("draftPaymentForm").reset();
          document.getElementById("draftPaymentModal").style.display = "none";
          // Refresh the Recent Drafts table here:
          await loadDrafts();
        } else {
          alert(
            "Failed to submit draft: " + (result.message || "Unknown error"),
          );
        }
      } catch (err) {
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

  const closeModalBtn = document.getElementById("closeModalBtn");
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

  // Forgot Password handler
  const forgotBtn = document.getElementById("forgotPasswordBtn");
  if (forgotBtn) {
    forgotBtn.onclick = async function () {
      const msgDiv = document.getElementById("forgotPasswordMessage");
      msgDiv.textContent = "Sending email...";
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

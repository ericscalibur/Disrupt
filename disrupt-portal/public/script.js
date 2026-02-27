const API_BASE = "http://localhost:3000/api";
let currentUser = null;
let currentUserRole = null;
let currentSupplier = null;
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
let taxLightningAddress = null;
const balanceDisplayModes = ["BTC", "SATS", "USD"];
let currentBalanceMode = 0;
let currentMember = null;
let transactions = [];
const authorizedRoles = ["Admin", "Manager"];
let token = sessionStorage.getItem("token");
let editTeamMemberModal;
let inputsContainer;
let batchPaymentData = []; // store batch payment data for editing

// Token refresh state management
let isRefreshing = false;
let refreshPromise = null;
let tokenRefreshTimer = null;

// Restore currentUser from sessionStorage if available
if (!currentUser) {
  const userStr = sessionStorage.getItem("user");
  if (userStr) {
    currentUser = JSON.parse(userStr);
    currentUserRole = currentUser.role; // adjust property name if different
  }
}

if (token) {
  const payload = decodeJwt(token);
  if (payload && payload.role) {
    currentUserRole = payload.role;
  } else {
    console.warn("Role claim not found in token");
  }
} else {
  console.warn("No token found");
}

// Helper to decode JWT token payload
function decodeJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("Failed to decode JWT:", e);
    return null;
  }
}

// Helper to check if token is expired
function isTokenExpired(token) {
  if (!token) return true;
  const decoded = decodeJwt(token);
  if (!decoded || !decoded.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return decoded.exp < now;
}

// Helper to get token expiration time in seconds
function getTokenExpirationTime(token) {
  if (!token) return 0;
  const decoded = decodeJwt(token);
  if (!decoded || !decoded.exp) return 0;
  return decoded.exp;
}

// Helper to truncate string from middle, showing start and end
function truncateFromMiddle(str, maxLength) {
  if (!str || str.length <= maxLength) return str;

  const ellipsis = "...";
  const charsToShow = maxLength - ellipsis.length;
  const frontChars = Math.ceil(charsToShow / 2);
  const backChars = Math.floor(charsToShow / 2);

  return (
    str.substring(0, frontChars) +
    ellipsis +
    str.substring(str.length - backChars)
  );
}

// Helper to clean receiver name by removing email portion
function cleanReceiverName(receiver) {
  if (!receiver) return "";

  // Handle formats like "John Doe (john@example.com)" or "John Doe john@example.com"
  if (receiver.includes("(") && receiver.includes("@")) {
    return receiver.split("(")[0].trim();
  }

  // Handle format "John Doe john@example.com" (space separated)
  const parts = receiver.split(" ");
  const emailIndex = parts.findIndex((part) => part.includes("@"));
  if (emailIndex > 0) {
    return parts.slice(0, emailIndex).join(" ").trim();
  }

  return receiver.trim();
}

// Schedule proactive token refresh
function scheduleTokenRefresh(token) {
  // Clear any existing timer
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }

  if (!token) return;

  const exp = getTokenExpirationTime(token);
  if (!exp) return;

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = exp - now;

  // Refresh 2 minutes before expiration (or immediately if less than 2 minutes left)
  const refreshIn = Math.max(0, expiresIn - 120);

  tokenRefreshTimer = setTimeout(async () => {
    if (!isRefreshing) {
      try {
        const newToken = await refreshToken();
        scheduleTokenRefresh(newToken);
      } catch (err) {
        console.error("Proactive token refresh failed:", err);
        // Don't logout automatically, let the next request handle it
      }
    }
  }, refreshIn * 1000);
}

// Centralized fetch helper that includes Authorization header
function prepareHeaders(optionsHeaders = {}, accessToken) {
  const headers = {
    ...optionsHeaders,
    Authorization: `Bearer ${accessToken}`,
  };
  if (!headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

async function authFetch(url, options = {}) {
  let token = sessionStorage.getItem("token");

  if (!token) {
    console.error("No token found in sessionStorage");
    alert("Session expired or missing. Please log in again.");
    throw new Error("Invalid or missing token");
  }

  console.log("Making authenticated request to:", url);
  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers: prepareHeaders(options.headers, token),
      credentials: "include",
    });
  } catch (networkError) {
    console.error("Network error during fetch:", networkError);
    throw networkError;
  }

  console.log("Response status:", response.status);

  if (response.status === 401) {
    console.log("Received 401, attempting token refresh...");
    // Handle token refresh with race condition protection
    if (isRefreshing) {
      console.log("Refresh already in progress, waiting...");
      // If refresh is already in progress, wait for it
      try {
        await refreshPromise;
        // Retry with the new token
        const newToken = sessionStorage.getItem("token");
        if (!newToken) {
          throw new Error("No token after refresh");
        }
        console.log("Retrying request with new token...");
        response = await fetch(url, {
          ...options,
          headers: prepareHeaders(options.headers, newToken),
          credentials: "include",
        });
        return response;
      } catch (err) {
        console.error("Error waiting for token refresh:", err);
        logout();
        throw err;
      }
    }

    // Start refresh process
    console.log("Starting new token refresh process...");
    isRefreshing = true;
    refreshPromise = refreshToken();

    try {
      const newToken = await refreshPromise;
      console.log("Token refresh successful, retrying original request...");

      response = await fetch(url, {
        ...options,
        headers: prepareHeaders(options.headers, newToken),
        credentials: "include",
      });
    } catch (err) {
      console.error("Error during token refresh:", err);
      logout();
      throw err;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  }

  return response;
}

async function refreshToken() {
  try {
    console.log("Attempting to refresh token...");
    const refreshResponse = await fetch(`${API_BASE}/refresh`, {
      method: "POST",
      credentials: "include",
    });

    console.log("Refresh response status:", refreshResponse.status);

    if (!refreshResponse.ok) {
      const errorData = await refreshResponse.json().catch(() => ({}));
      console.error("Refresh failed:", errorData);
      throw new Error(errorData.message || "Refresh token expired or invalid");
    }

    const data = await refreshResponse.json();
    console.log("Refresh response data:", data);

    if (!data.accessToken) {
      throw new Error("Failed to refresh access token");
    }

    sessionStorage.setItem("token", data.accessToken);
    console.log("New token saved to sessionStorage");

    // Schedule the next refresh
    scheduleTokenRefresh(data.accessToken);

    return data.accessToken;
  } catch (err) {
    console.error("Token refresh error:", err);
    sessionStorage.removeItem("token");
    throw err;
  }
}

async function logout() {
  try {
    // Call logout endpoint to clean up server-side tokens
    await fetch(`${API_BASE}/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.error("Error during logout:", err);
    // Continue with client-side cleanup even if server call fails
  }

  // Clean up client-side storage
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");

  // Reset refresh state
  isRefreshing = false;
  refreshPromise = null;

  // Clear token refresh timer
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }

  // Show login page
  resetUIAfterLogout();
}

// Updated login function
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
    // Login request (with credentials to accept cookies)
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include", // Required for cookies if backend sets them
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `Login failed with status ${response.status}`,
      );
    }

    const { accessToken } = await response.json();

    if (!accessToken) {
      throw new Error("No access token received.");
    }

    // Store access token immediately
    sessionStorage.setItem("token", accessToken);

    // Schedule proactive token refresh
    scheduleTokenRefresh(accessToken);

    // Fetch user profile with new token, ensure authFetch uses the stored token
    const profileResp = await authFetch(`${API_BASE}/me`);

    if (!profileResp.ok) {
      throw new Error("Failed to load user profile.");
    }

    const profile = await profileResp.json();

    if (!profile.success) {
      throw new Error("Failed to load user profile.");
    }

    currentUser = profile.user;
    currentUserRole = currentUser.role;

    // Now that token and user are ready, load protected data in sequence
    await populateDepartmentsList();
    await loadEmployeeDrafts();

    await loadTeamMembers();
    await loadDepartments();

    showDashboard();
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

function resetUIAfterLogout() {
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
  if (toggleText) toggleText.textContent = "⛰️ Volcano";
  if (volcanoSwitch) volcanoSwitch.checked = false;
}

// ===== Main Accounting Loader =====
function sortEmployeeDraftsByColumn(columnIdx) {
  // Adjust these if your columns are ordered differently
  const columns = [
    "dateCreated",
    "recipientName",
    "contactName",
    "note",
    "amount",
    "status",
  ];
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

  // Reset Pay All button whenever the table re-renders
  updatePayAllButton();

  if (!drafts || drafts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading-message">No drafts found.</td></tr>`;
    return;
  }

  // Sort drafts by dateCreated descending (most recent first)
  const sortedDrafts = [...drafts].sort(
    (a, b) => new Date(b.dateCreated) - new Date(a.dateCreated),
  );

  sortedDrafts.forEach((draft) => {
    let actionCell = "";
    let statusText = "";
    let statusClass = "";
    const isPending = draft.status === "pending";

    if (isPending) {
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

    // Prepare company and contact with fallback text
    const companyName =
      draft.company && draft.company.trim() !== ""
        ? draft.company
        : "(No Company)";
    const contactName =
      draft.contact && draft.contact.trim() !== ""
        ? draft.contact
        : "(No Contact)";

    const row = document.createElement("tr");
    row.setAttribute("data-draft-id", draft.id);

    // Checkbox cell — only selectable for pending drafts
    const checkboxCell = document.createElement("td");
    checkboxCell.classList.add("txn-checkbox-col");
    if (isPending && showActions) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.classList.add("draft-select-checkbox");
      checkbox.setAttribute("data-draft-id", draft.id);
      checkbox.addEventListener("change", updatePayAllButton);
      checkboxCell.appendChild(checkbox);
    }
    row.appendChild(checkboxCell);

    row.insertAdjacentHTML(
      "beforeend",
      `
      <td>${new Date(draft.dateCreated).toLocaleString()}</td>
      <td>
        <div><strong>Company:</strong> ${companyName}</div>
        <div><strong>Contact:</strong> ${contactName}</div>
      </td>
      <td>${draft.note || draft.description || ""}</td>
      <td class="amount-cell">${draft.amount}</td>
      <td>${actionCell}</td>
    `,
    );

    tbody.appendChild(row);
  });

  // Attach event listeners to approve/decline buttons AFTER rendering
  tbody.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", handleDraftApproval);
  });
  tbody.querySelectorAll(".decline-btn").forEach((btn) => {
    btn.addEventListener("click", handleDraftDecline);
  });
}

// Show/hide Pay All button and update its count label
function updatePayAllButton() {
  const checked = document.querySelectorAll(".draft-select-checkbox:checked");
  const payAllBtn = document.getElementById("payAllDraftsBtn");
  if (!payAllBtn) return;
  if (checked.length >= 1) {
    payAllBtn.style.display = "inline-block";
    payAllBtn.textContent = `Pay All (${checked.length})`;
  } else {
    payAllBtn.style.display = "none";
  }
}

// Pay all checked pending drafts sequentially
async function handlePayAll() {
  const checked = Array.from(
    document.querySelectorAll(".draft-select-checkbox:checked"),
  );
  if (checked.length === 0) return;

  const draftIds = checked.map((cb) => cb.getAttribute("data-draft-id"));
  const plural = draftIds.length > 1 ? "s" : "";

  if (!confirm(`Pay ${draftIds.length} selected draft${plural}?`)) return;

  const payAllBtn = document.getElementById("payAllDraftsBtn");
  if (payAllBtn) {
    payAllBtn.disabled = true;
    payAllBtn.textContent = `Processing (0 / ${draftIds.length})…`;
  }

  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (let i = 0; i < draftIds.length; i++) {
    const draftId = draftIds[i];
    if (payAllBtn) {
      payAllBtn.textContent = `Processing (${i + 1} / ${draftIds.length})…`;
    }
    try {
      const response = await authFetch(`${API_BASE}/drafts/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const result = await response.json();
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        errors.push(`• ${result.message || "Unknown error"}`);
      }
    } catch (err) {
      failCount++;
      errors.push(`• ${err.message}`);
    }
  }

  if (payAllBtn) {
    payAllBtn.disabled = false;
  }

  let message = `${successCount} payment${successCount !== 1 ? "s" : ""} sent successfully.`;
  if (failCount > 0) {
    message += `\n${failCount} failed:\n${errors.join("\n")}`;
  }
  alert(message);

  await loadPendingDrafts();
  if (successCount > 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await loadTransactions();
  }
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

    if (
      currentUser.role === "Admin" ||
      currentUser.role === "Manager" ||
      currentUser.role === "Bookkeeper"
    ) {
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

    // Load and display lightning balance here
    await updateLightningBalance();

    // Fetch tax lightning address
    await fetchTaxLightningAddress();

    updateAccountingActionsVisibility();
  } catch (err) {
    console.error("Failed to load accounting data", err);
  }
}

// LOADS SUPPLIERS IN DROPDOWN
// Called when Recipient Type dropdown changes — repopulates the Recipient select
function updateDraftRecipientDropdown() {
  const type = document.getElementById("draftRecipientType").value;
  const select = document.getElementById("draftRecipientSelect");
  const contactField = document.getElementById("draftContactField");

  select.innerHTML = "";

  if (type === "employee") {
    // Hide contact field — employee name IS the contact
    if (contactField) contactField.style.display = "none";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select employee...";
    select.appendChild(placeholder);

    (employeesList || []).forEach((emp) => {
      const option = document.createElement("option");
      option.value = emp.id || emp.email;
      option.textContent = emp.name || emp.email;
      select.appendChild(option);
    });
  } else {
    // Show contact field for suppliers
    if (contactField) contactField.style.display = "block";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select supplier...";
    select.appendChild(placeholder);

    (suppliersList || []).forEach((supplier) => {
      const option = document.createElement("option");
      option.value = supplier.id;
      option.textContent = supplier.company;
      select.appendChild(option);
    });
  }

  // Auto-select first real item and populate details
  if (select.options.length > 1) {
    select.selectedIndex = 1;
    populateDraftRecipientDetails();
  } else {
    document.getElementById("draftContactName").value = "";
    document.getElementById("draftRecipientEmail").value = "";
    document.getElementById("draftRecipientLightningAddress").value = "";
  }
}

// LOADS REMAINING DATA FIELDS AFTER RECIPIENT SELECTED
function populateDraftRecipientDetails() {
  const type = document.getElementById("draftRecipientType").value;
  const select = document.getElementById("draftRecipientSelect");
  const selectedId = select.value;

  if (!selectedId) {
    document.getElementById("draftContactName").value = "";
    document.getElementById("draftRecipientEmail").value = "";
    document.getElementById("draftRecipientLightningAddress").value = "";
    return;
  }

  if (type === "employee") {
    const employee = (employeesList || []).find(
      (e) => (e.id || e.email) === selectedId,
    );
    if (employee) {
      document.getElementById("draftContactName").value = employee.name || "";
      document.getElementById("draftRecipientEmail").value =
        employee.email || "";
      document.getElementById("draftRecipientLightningAddress").value =
        employee.lightningAddress || "";
    }
  } else {
    const supplier = (suppliersList || []).find((s) => s.id === selectedId);
    if (supplier) {
      document.getElementById("draftContactName").value =
        supplier.contact || "";
      document.getElementById("draftRecipientEmail").value =
        supplier.email || "";
      document.getElementById("draftRecipientLightningAddress").value =
        supplier.lightningAddress || "";
    }
  }
}

// Fetch employee/user data by ID
async function fetchUserById(id) {
  try {
    const response = await authFetch(`${API_BASE}/users/${id}`, {
      headers: {
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
    const response = await authFetch(`${API_BASE}/suppliers/${id}`, {
      headers: {
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
    "batchContent",
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
        updateSupplierActionsVisibility();
        break;
      case "welcome":
        // No data to load for welcome page
        break;
      case "batch":
        // No data to load for batch page initially
        break;
      default:
        console.warn(`No data loader defined for contentId: ${contentId}`);
    }
  } catch (err) {
    console.error(`Error loading ${contentId} data:`, err);
  }
}

// Function to format and show transaction details in modal
// Attach click listeners to each team member row
function setupTeamTableClicks(users) {
  document.querySelectorAll("#teamTable tbody tr").forEach((row) => {
    row.addEventListener("click", () => {
      if (!authorizedRoles.includes(currentUserRole)) {
        alert("You are not authorized to edit team members.");
        return;
      }

      const memberId = row.getAttribute("data-member-id");
      currentMember = users.find((m) => String(m.id) === memberId);

      if (!currentMember) {
        console.warn(`Team member with id ${memberId} not found`);
        return;
      }

      populateEditForm(currentMember);
      editTeamMemberModal.style.display = "flex";
    });
  });
}

// Populate the form inputs dynamically based on currentMember attributes
function populateEditForm(member) {
  inputsContainer.innerHTML = ""; // Clear previous inputs

  const roleOptions = ["Admin", "Manager", "Employee", "Bookkeeper"];

  for (const [key, value] of Object.entries(member)) {
    if (key === "id") continue;

    const label = document.createElement("label");
    label.textContent = key.charAt(0).toUpperCase() + key.slice(1);
    label.setAttribute("for", `input-${key}`);

    let inputElement;

    if (key === "role") {
      // Create dropdown for role field
      inputElement = document.createElement("select");
      inputElement.id = `input-${key}`;
      inputElement.name = key;

      // Add default option
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "Select a role...";
      inputElement.appendChild(defaultOption);

      // Add role options
      roleOptions.forEach((role) => {
        const option = document.createElement("option");
        option.value = role;
        option.textContent = role;
        if (value === role) {
          option.selected = true;
        }
        inputElement.appendChild(option);
      });
    } else if (key === "password") {
      // Skip password — handled separately below
      return;
    } else {
      // Create regular text input for other fields
      inputElement = document.createElement("input");
      inputElement.type = "text";
      inputElement.id = `input-${key}`;
      inputElement.name = key;
      inputElement.placeholder = value || "";
      inputElement.value = value || "";
    }

    const wrapper = document.createElement("div");
    wrapper.appendChild(label);
    wrapper.appendChild(inputElement);

    inputsContainer.appendChild(wrapper);
  }

  // Always append a dedicated optional password field at the end
  const pwLabel = document.createElement("label");
  pwLabel.textContent = "New Password";
  pwLabel.setAttribute("for", "input-newPassword");

  const pwInput = document.createElement("input");
  pwInput.type = "password";
  pwInput.id = "input-newPassword";
  pwInput.name = "newPassword";
  pwInput.placeholder = "Leave blank to keep current password";
  pwInput.autocomplete = "new-password";

  const pwWrapper = document.createElement("div");
  pwWrapper.appendChild(pwLabel);
  pwWrapper.appendChild(pwInput);
  inputsContainer.appendChild(pwWrapper);
}

function setupTransactionRowClicks(transactions) {
  const modal = document.getElementById("transactionModal");
  const detailsContainer = document.getElementById("transactionDetails");
  const closeButton = document.getElementById("closeTransactionModal");
  const tbody = document.querySelector("#transactionsTable tbody");

  if (!modal || !detailsContainer || !closeButton || !tbody) {
    console.error("Transaction modal elements missing");
    return;
  }

  // Close modal on close button click
  closeButton.addEventListener("click", () => {
    modal.style.display = "none";
  });

  // Function to populate and show modal
  function showTransactionDetails(txn) {
    const detailsContainer = document.getElementById("transactionDetails");
    if (!detailsContainer) return;

    let usdLine = "";
    if (txn.btcUsdRate && txn.amount) {
      const usdValue = (Number(txn.amount) / 100_000_000) * txn.btcUsdRate;
      const formattedUsd = usdValue.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });
      const formattedRate = txn.btcUsdRate.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      usdLine = `
      <span class="label">USD Value:</span> <span class="data">${formattedUsd}</span><br>
      <span class="label">BTC/USD Rate:</span> <span class="data">${formattedRate} <span style="opacity:0.6;font-size:0.85em">(at time of payment)</span></span><br>`;
    } else {
      usdLine = `
      <span class="label">USD Value:</span> <span class="data">N/A</span><br>
      <span class="label">BTC/USD Rate:</span> <span class="data">N/A</span><br>`;
    }

    const details = `
      <span class="label">Receiver:</span> <span class="data">${cleanReceiverName(txn.receiver) || "N/A"}</span><br>
      <span class="label">Amount:</span> <span class="data">${txn.amount || "N/A"} ${txn.currency || "SATS"}</span><br>${usdLine}
      <span class="label">Date:</span> <span class="data">${txn.date ? new Date(txn.date).toLocaleString() : "N/A"}</span><br>
      <span class="label">Note:</span> <span class="data">${txn.note || "N/A"}</span><br>
      <span class="label">Status:</span> <span class="data">${txn.status || "N/A"}</span><br>
      <span class="label">Approved Status:</span> <span class="data">${txn.approvedStatus || "N/A"}</span><br>
      <span class="label">Approved At:</span> <span class="data">${txn.approvedAt ? new Date(txn.approvedAt).toLocaleString() : "N/A"}</span><br>
      <span class="label">Approved By:</span> <span class="data">${txn.approvedBy || "N/A"}</span><br>
      <span class="label">Lightning Address:</span> <span class="data">${txn.lightningAddress || "N/A"}</span><br>
      <span class="label">Invoice:</span> <span class="data">${txn.invoice || "N/A"}</span><br>
      <span class="label">Payment Hash:</span> <span class="data">${txn.paymentHash || "N/A"}</span><br>
      <span class="label">Pre-Image:</span> <span class="data">${txn.preImage || "Not yet available — payment may still be pending"}</span>
    `.trim();

    detailsContainer.innerHTML = details;
    document.getElementById("transactionModal").style.display = "flex";
  }

  // Event delegation: attach one listener to tbody
  tbody.addEventListener("click", (event) => {
    // Ignore clicks on the checkbox itself so checking doesn't open the modal
    if (event.target.type === "checkbox") return;

    const row = event.target.closest("tr");
    if (!row) return;

    const txnId = row.getAttribute("data-txn-id");
    if (!txnId) return;

    const txn = transactions.find((t) => String(t.id) === txnId);
    if (txn) {
      showTransactionDetails(txn);
    } else {
      console.warn(`Transaction with id ${txnId} not found`);
    }
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
    const response = await authFetch(`${API_BASE}/drafts`, {
      headers: {
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
      // Sort all drafts by dateCreated descending (most recent first)
      allDrafts.sort(
        (a, b) => new Date(b.dateCreated) - new Date(a.dateCreated),
      );

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
    const response = await authFetch(`${API_BASE}/drafts`, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load drafts: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      if (!suppliersList || !Array.isArray(suppliersList)) {
        console.warn(
          "suppliersList is not loaded or invalid. Drafts may display incomplete info.",
        );
      }

      // Sort drafts by dateCreated descending (most recent first)
      const sortedDrafts = (data.drafts || []).sort(
        (a, b) => new Date(b.dateCreated) - new Date(a.dateCreated),
      );

      // Render drafts with suppliersList for lookup
      renderEmployeeDraftsTable(sortedDrafts, suppliersList || []);

      // Initialize sorting handlers if available
      if (typeof addEmployeeDraftsTableSortHandlers === "function") {
        addEmployeeDraftsTableSortHandlers();
      }
    } else {
      // Render empty drafts table with suppliersList (if any)
      renderEmployeeDraftsTable([], suppliersList || []);
      console.warn("Failed to load drafts:", data.message);
    }
  } catch (err) {
    // Render empty drafts table on error
    renderEmployeeDraftsTable([], suppliersList || []);
    console.error("Error loading drafts:", err);
  } finally {
    // Hide loading state if used
    // e.g., showLoadingIndicator(false);
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
  const columns = [
    "dateCreated",
    "recipientName",
    "contactName",
    "note",
    "amount",
    "status",
  ];
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

function renderEmployeeDraftsTable(drafts, suppliersList) {
  const tbody = document.querySelector("#draftsTable tbody");
  tbody.innerHTML = "";

  if (!drafts || drafts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-message">No drafts found.</td></tr>`;
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

    // Determine company and contact names
    // If draft.company is an ID, look up supplier; else use draft.company/contact directly
    let companyName = draft.company || "";
    let contactName = draft.contact || "";

    // If companyName looks like an ID (e.g., starts with 'sup'), try to find supplier
    if (companyName && companyName.startsWith("sup")) {
      const supplier = suppliersList.find((s) => s.id === companyName);
      if (supplier) {
        companyName = supplier.company || companyName;
        contactName = supplier.contact || contactName;
      }
    }

    // Fallback text if empty
    companyName =
      companyName.trim() !== "" ? companyName : "(No Business Name)";
    contactName = contactName.trim() !== "" ? contactName : "(No Contact Name)";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${draft.title || "(No Title)"}</td>
      <td>${companyName}</td>
      <td>${contactName}</td>
      <td>${draft.note || ""}</td>
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
      const response = await authFetch(`${API_BASE}/drafts/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      const response = await authFetch(`${API_BASE}/drafts/decline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("No authentication token found");

    // Fetch balance and USD rate in parallel
    const [balanceResp, usdRate] = await Promise.all([
      authFetch(`${API_BASE}/lightning-balance`),
      fetchBtcUsdRate(),
    ]);

    const data = await balanceResp.json();

    if (data.success) {
      currentBalanceSATS = Number(data.balanceSats) || 0;
      currentBalanceBTC = currentBalanceSATS / 100_000_000;
      // Only overwrite the rate if we actually got a valid number back;
      // otherwise keep the previous value (initialised to 70 000 as a
      // reasonable fallback so USD mode never shows $0.00).
      if (typeof usdRate === "number" && usdRate > 0) {
        btcToUsdRate = usdRate;
      }
      currentBalanceMode = 0; // Always start with BTC
      updateBalanceDisplay();
    } else if (balanceElem) {
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
    const response = await authFetch(`${API_BASE}/btc-usd-rate`);
    const data = await response.json();
    if (data.success && typeof data.rate === "number") {
      return data.rate;
    }
  } catch (err) {
    console.error("Failed to fetch BTC/USD rate from Blink:", err);
  }
  return null;
}

// Load departments and populate the list
async function loadDepartments() {
  try {
    const response = await authFetch(`${API_BASE}/departments`, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 401) {
        throw new Error("Unauthorized access. Please log in again.");
      }
      if (response.status === 403) {
        throw new Error("Access denied: insufficient permissions");
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
  const dep = prompt("Enter new department name:");
  if (!dep || !dep.trim()) return;

  try {
    const response = await authFetch(`${API_BASE}/departments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ department: dep.trim() }),
    });

    if (!response.ok) {
      const data = await response.json();
      alert(data.error || "Failed to add department");
      return;
    }

    await loadDepartments();
    await loadRemoveDepartmentSelect();
  } catch (err) {
    console.error("Error adding department:", err);
  }
}

// Remove a department
async function removeDepartment(department, confirmDelete = false) {
  if (!department || typeof department !== "string" || !department.trim()) {
    alert("Please provide a valid department name.");
    return;
  }

  try {
    const response = await authFetch(`${API_BASE}/departments`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ department: department.trim(), confirmDelete }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = { success: false, message: "Unexpected server response." };
    }

    // Handle confirmation requirement
    if (data.requiresConfirmation) {
      if (!data.employees || !Array.isArray(data.employees)) {
        alert("Error: Invalid employee data received from server.");
        return;
      }

      const employeeList = data.employees
        .map((emp) => `• ${emp.name || "Unknown"} (${emp.email || "No email"})`)
        .join("\n");

      const confirmMessage = `This department still has ${data.employeeCount} member(s):

${employeeList}

Deleting this department will also delete these employees. Are you sure you want to delete this department and its employees?`;

      if (confirm(confirmMessage)) {
        // Retry with confirmation
        await removeDepartment(department, true);
        return;
      }
      return;
    }

    if (response.ok && data.success) {
      alert(data.message || `Department "${department}" removed successfully!`);
      // Refresh department list and team members
      if (typeof populateDepartmentsList === "function") {
        await populateDepartmentsList();
      }
      if (typeof loadTeamMembers === "function") {
        await loadTeamMembers();
      }
      if (typeof loadDepartments === "function") {
        await loadDepartments();
      }
    } else if (response.status === 404) {
      alert(data.message || `Department "${department}" does not exist.`);
    } else if (!response.ok) {
      alert(data.message || "Failed to remove department.");
    }
  } catch (err) {
    alert("An error occurred while removing the department. Please try again.");
    console.error("Department removal error:", err);
  }
}

// Load departments into the remove select dropdown
async function loadRemoveDepartmentSelect() {
  try {
    const response = await authFetch(`${API_BASE}/departments`, {
      headers: {
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
    if (!currentUser || !currentUser.role) {
      throw new Error("User information not loaded.");
    }

    const response = await authFetch(`${API_BASE}/departments`, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch departments");
    }

    const data = await response.json();
    let departments = data.departments || [];

    const deptList = document.getElementById("departmentsList");
    if (!deptList) {
      console.warn("departmentsList element not found");
      return;
    }
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
    alert(err.message);
  }
}

async function populateDepartmentSelect() {
  try {
    const response = await authFetch(`${API_BASE}/departments`, {
      headers: {
        "Content-Type": "application/json", // Keep Content-Type if you're sending a body
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
    const response = await authFetch(`${API_BASE}/suppliers`);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Unauthorized access. Please log in again.");
      }
      throw new Error(`Failed to fetch suppliers. Status: ${response.status}`);
    }

    const data = await response.json();
    if (data.success) {
      suppliersList = data.suppliers; // assign to global variable
      renderSuppliers(data.suppliers);
    } else {
      throw new Error("Failed to load suppliers");
    }
  } catch (err) {
    console.error("Error loading suppliers:", err);
    // Optionally show user-friendly error message in UI
  }
}

// Populate supplier edit modal form with supplier data
function populateEditSupplierForm(supplier) {
  currentSupplier = supplier;
  const form = document.getElementById("editSupplierForm");
  form.elements["name"].value = supplier.company || supplier.name || "";
  form.elements["contact"].value = supplier.contact || "";
  form.elements["email"].value = supplier.email || "";
  form.elements["lightningAddress"].value = supplier.lightningAddress || "";
  form.elements["note"].value = supplier.note || "";
  document.getElementById("editSupplierModal").style.display = "flex";
}

// Handle form submission
document
  .getElementById("editSupplierForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentSupplier) return;

    const form = event.target;

    const updatedSupplier = {
      id: currentSupplier.id, // keep from currentSupplier or add hidden input if you prefer
      company: form.elements["name"].value,
      contact: form.elements["contact"].value,
      email: form.elements["email"].value,
      lightningAddress: form.elements["lightningAddress"].value,
      note: form.elements["note"].value,
      createdAt: currentSupplier.createdAt, // keep original createdAt
    };

    try {
      const response = await authFetch(
        `${API_BASE}/suppliers/${updatedSupplier.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updatedSupplier),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update supplier");
      }

      const savedSupplier = await response.json();

      // Update local suppliers list and UI
      const index = suppliersList.findIndex((s) => s.id === savedSupplier.id);
      if (index !== -1) {
        suppliersList[index] = savedSupplier;
      }

      renderSuppliers(suppliersList);

      // Close modal and reset
      document.getElementById("editSupplierModal").style.display = "none";
      form.reset();
      currentSupplier = null;
    } catch (error) {
      console.error("Error saving supplier:", error);
      alert(`Error saving changes: ${error.message}`);
    }
  });

function renderSuppliers(suppliers) {
  // Sort suppliers by creation date descending
  suppliers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const tbody = document.querySelector("#suppliersTable tbody");
  tbody.innerHTML = "";
  suppliers.forEach((supplier) => {
    const company = supplier.company || "";
    const contact = supplier.contact || "";
    const email = supplier.email || "";
    const lightningAddress = supplier.lightningAddress || "";
    const note = supplier.note || "";
    const createdAt = supplier.createdAt
      ? new Date(supplier.createdAt).toLocaleString()
      : "";

    const tr = document.createElement("tr");
    tr.setAttribute("data-supplier-id", supplier.id); // Add this for identification
    tr.innerHTML = `
      <td>${company}</td>
      <td>${contact}</td>
      <td>${email}</td>
      <td>${lightningAddress}</td>
      <td>${note}</td>
      <td>${createdAt}</td>
    `;
    tbody.appendChild(tr);
  });

  // Populate recipient dropdown (as before)
  const select = document.getElementById("recipientSelect");
  if (!select) {
    console.error("Recipient dropdown element not found");
    return;
  }

  select.innerHTML = '<option value="">Select Supplier</option>';
  suppliers.forEach((supplier) => {
    const option = document.createElement("option");
    option.value = supplier.id;
    option.textContent = supplier.company || "Unnamed Supplier";
    select.appendChild(option);
  });

  if (suppliers.length > 0) {
    select.value = suppliers[0].id;
    populateRecipientDetails();
  } else {
    document.getElementById("contactName").value = "";
    document.getElementById("recipientEmail").value = "";
    document.getElementById("recipientLightningAddress").value = "";
  }
}

function renderTransactions(transactions) {
  const tbody = document.querySelector("#transactionsTable tbody");
  tbody.innerHTML = "";

  // Reset select-all checkbox and hide export button when re-rendering
  const selectAll = document.getElementById("selectAllTxns");
  if (selectAll) selectAll.checked = false;
  updateExportButton();

  const filteredTransactions = transactions.filter((txn) => {
    return (
      txn.receiver &&
      txn.receiver !== "Unknown" &&
      txn.receiver !== "Unknown Supplier" &&
      txn.receiver !== "Unknown Employee" &&
      typeof txn.date === "string" &&
      !isNaN(new Date(txn.date).getTime())
    );
  });

  filteredTransactions.forEach((txn) => {
    const row = document.createElement("tr");
    row.setAttribute("data-txn-id", txn.id);

    // Checkbox cell
    const checkboxCell = document.createElement("td");
    checkboxCell.classList.add("txn-checkbox-col");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add("txn-export-checkbox");
    checkbox.setAttribute("data-txn-id", txn.id);
    checkbox.addEventListener("change", () => {
      updateExportButton();
      // Sync select-all state
      const all = document.querySelectorAll(".txn-export-checkbox");
      const checked = document.querySelectorAll(".txn-export-checkbox:checked");
      const selectAll = document.getElementById("selectAllTxns");
      if (selectAll) {
        selectAll.checked = all.length > 0 && checked.length === all.length;
        selectAll.indeterminate =
          checked.length > 0 && checked.length < all.length;
      }
    });
    checkboxCell.appendChild(checkbox);

    // Date cell
    const dateCell = document.createElement("td");
    const d = new Date(txn.date);
    dateCell.textContent = isNaN(d.getTime()) ? "" : d.toLocaleDateString();

    // Receiver cell
    const receiverCell = document.createElement("td");
    receiverCell.textContent = cleanReceiverName(txn.receiver);

    // Amount cell
    const amountCell = document.createElement("td");
    amountCell.textContent = txn.amount
      ? `${txn.amount} ${txn.currency || "SATS"}`
      : "";
    amountCell.classList.add("amount");
    if (txn.status === "SUCCESS") amountCell.classList.add("amount-green");
    else if (txn.status === "ALREADY_PAID")
      amountCell.classList.add("amount-blue");
    else amountCell.classList.add("amount-red");

    // ID cell
    const idCell = document.createElement("td");
    idCell.classList.add("txid");
    const fullId = txn.id || "";
    idCell.textContent = truncateFromMiddle(fullId, 24);
    idCell.title = fullId; // Show full ID on hover

    // Note cell
    const noteCell = document.createElement("td");
    noteCell.textContent = txn.note || "";

    // Status cell (renderStatus returns HTML string)
    const statusCell = document.createElement("td");
    statusCell.innerHTML = renderStatus(txn.status);

    // Append cells
    row.appendChild(checkboxCell);
    row.appendChild(dateCell);
    row.appendChild(receiverCell);
    row.appendChild(amountCell);
    row.appendChild(idCell);
    row.appendChild(noteCell);
    row.appendChild(statusCell);

    tbody.appendChild(row);
  });

  // Setup click handlers after rendering
  setupTransactionRowClicks(filteredTransactions);
}

function closeNewPaymentModal() {
  document.getElementById("newPaymentModal").style.display = "none";
}

// ─── Transaction Export ───────────────────────────────────────────────────────

function updateExportButton() {
  const checked = document.querySelectorAll(".txn-export-checkbox:checked");
  const wrapper = document.getElementById("exportWrapper");
  if (!wrapper) return;
  if (checked.length > 0) {
    wrapper.style.display = "";
  } else {
    wrapper.style.display = "none";
    // Also close the dropdown if it was open
    const dropdown = document.getElementById("exportDropdown");
    if (dropdown) dropdown.style.display = "none";
  }
}

function toggleSelectAllTransactions(selectAllCheckbox) {
  const checkboxes = document.querySelectorAll(".txn-export-checkbox");
  checkboxes.forEach((cb) => {
    cb.checked = selectAllCheckbox.checked;
  });
  updateExportButton();
}

function toggleExportDropdown() {
  const dropdown = document.getElementById("exportDropdown");
  if (!dropdown) return;
  dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
}

// Close export dropdown when clicking outside of it
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("exportWrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    const dropdown = document.getElementById("exportDropdown");
    if (dropdown) dropdown.style.display = "none";
  }
});

function exportTransactions(format) {
  const checked = document.querySelectorAll(".txn-export-checkbox:checked");
  const ids = Array.from(checked).map((cb) => cb.getAttribute("data-txn-id"));
  const selectedTxns = transactions.filter((t) => ids.includes(String(t.id)));

  if (selectedTxns.length === 0) return;

  let content, mimeType, filename;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");

  if (format === "csv") {
    const headers = [
      "Date",
      "Receiver",
      "Amount",
      "Currency",
      "Transaction ID",
      "Note",
      "Status",
      "Lightning Address",
      "Payment Hash",
    ];
    const escapeCell = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
    const rows = selectedTxns.map((t) =>
      [
        t.date ? new Date(t.date).toLocaleDateString() : "",
        cleanReceiverName(t.receiver) || "",
        t.amount ?? "",
        t.currency || "SATS",
        t.id || "",
        t.note || "",
        t.status || "",
        t.lightningAddress || "",
        t.paymentHash || "",
      ]
        .map(escapeCell)
        .join(","),
    );
    content = [headers.join(","), ...rows].join("\n");
    mimeType = "text/csv";
    filename = `transactions_${timestamp}.csv`;
  } else if (format === "json") {
    content = JSON.stringify(selectedTxns, null, 2);
    mimeType = "application/json";
    filename = `transactions_${timestamp}.json`;
  } else {
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Close the dropdown after export
  const dropdown = document.getElementById("exportDropdown");
  if (dropdown) dropdown.style.display = "none";
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Add placeholder option with empty value
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  // Populate options with employee names or supplier company names
  list.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id; // Use id consistently

    if (type === "employee") {
      option.textContent = item.name || "(Unnamed Employee)";
    } else if (type === "supplier") {
      option.textContent = item.company || "(Unnamed Supplier)";
    }

    select.appendChild(option);
  });

  // Reset details fields
  const recipientEmailEl = document.getElementById("recipientEmail");
  const lightningAddressEl = document.getElementById(
    "recipientLightningAddress",
  );
  const supplierContactEl = document.getElementById("supplierContactReadonly");

  if (recipientEmailEl) recipientEmailEl.value = "";
  if (lightningAddressEl) lightningAddressEl.value = "";
  if (supplierContactEl) supplierContactEl.value = "";

  // Auto-select first real option if available (skip placeholder)
  if (list.length > 0) {
    select.value = list[0].id;
    populateRecipientDetails();
  }
}

function populateRecipientDetails() {
  const recipientType = document.getElementById("recipientType").value;
  const recipientSelect = document.getElementById("recipientSelect");
  const selectedId = recipientSelect.value;

  // Elements to populate
  const recipientEmailEl = document.getElementById("recipientEmail");
  const lightningAddressEl = document.getElementById(
    "recipientLightningAddress",
  );
  const supplierContactEl = document.getElementById("supplierContactReadonly");

  // Clear fields initially
  if (recipientEmailEl) recipientEmailEl.value = "";
  if (lightningAddressEl) lightningAddressEl.value = "";
  if (supplierContactEl) supplierContactEl.value = "";

  if (!selectedId) {
    // No recipient selected, clear fields and return
    return;
  }

  let recipient = null;

  if (recipientType === "employee") {
    recipient = employeesList.find((e) => e.email === selectedId);
  } else if (recipientType === "supplier") {
    recipient = suppliersList.find((s) => s.id === selectedId);
  }

  if (!recipient) {
    // Recipient not found, clear fields and return
    return;
  }

  // Populate email and lightning address (for both types)
  if (recipientEmailEl) recipientEmailEl.value = recipient.email || "";
  if (lightningAddressEl)
    lightningAddressEl.value = recipient.lightningAddress || "";

  // Populate contact only for suppliers
  if (recipientType === "supplier" && supplierContactEl) {
    supplierContactEl.value = recipient.contact || "";
  }
}

async function loadEmployeesForPaymentModal() {
  try {
    const response = await authFetch(`${API_BASE}/users`);
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

function extractCompanyFromEmail(email) {
  if (!email || typeof email !== "string") return "";
  // Match the domain part between '@' and the first '.' after '@'
  const match = email.match(/@([^\.]+)\./);
  return match && match[1] ? match[1].toLowerCase() : "";
}

function toggleContactField() {
  const recipientType = document.getElementById("recipientType").value;
  const contactField = document.getElementById("contactField");

  if (recipientType === "supplier") {
    contactField.style.display = "block"; // Show Contact field for suppliers
  } else {
    contactField.style.display = "none"; // Hide Contact field for employees
    // Clear contact field when hidden
    const contactInput = document.getElementById("supplierContactReadonly");
    if (contactInput) contactInput.value = "";
  }
}

async function submitNewPayment(event) {
  event.preventDefault();

  const submitBtn = document.querySelector("#newPaymentModal .submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
  }

  // Get recipient type and selected recipient ID
  const recipientType = document.getElementById("recipientType")?.value || "";
  const recipientId = document.getElementById("recipientSelect")?.value || "";

  // Get email and lightning address fields
  const email = document.getElementById("recipientEmail")?.value.trim() || "";
  const lightningAddress =
    document.getElementById("recipientLightningAddress")?.value.trim() || "";

  // Get payment details
  const paymentAmountStr =
    document.getElementById("paymentAmount")?.value || "";
  const paymentNote =
    document.getElementById("paymentNote")?.value?.trim() || "";

  // Parse amount
  const paymentAmount = parseFloat(paymentAmountStr);

  // Initialize contact and company variables
  let contact = "";
  let company = "";

  // Get the selected option text (employee name or supplier company)
  const recipientSelect = document.getElementById("recipientSelect");
  const selectedOptionText =
    recipientSelect.options[recipientSelect.selectedIndex]?.text || "";

  // Build contact and company based on recipient type
  if (recipientType === "supplier") {
    contact =
      document.getElementById("supplierContactReadonly")?.value.trim() || "";
    const supplier = suppliersList.find((s) => s.id === recipientId);
    company = supplier ? supplier.company || "" : "";
  } else if (recipientType === "employee") {
    contact = selectedOptionText; // Employee name from dropdown text
    company = extractCompanyFromEmail(email);
  }

  // Validate required fields
  if (!contact || !company) {
    alert("Missing contact or company information.");
    resetSubmitButton(submitBtn);
    return;
  }

  // Validate amount
  if (isNaN(paymentAmount) || paymentAmount <= 0) {
    alert("Please enter a valid payment amount.");
    resetSubmitButton(submitBtn);
    return;
  }

  // Validate lightning address presence
  if (!lightningAddress) {
    alert("Selected recipient does not have a Lightning Address.");
    resetSubmitButton(submitBtn);
    return;
  }

  // Check which type of tax withholding is applied (employee payments only)
  const applyEmployeeTaxWithholding = document.getElementById(
    "applyEmployeeTaxWithholding",
  ).checked;
  const applyContractorTaxWithholding = document.getElementById(
    "applyContractorTaxWithholding",
  ).checked;

  const isEmployeeTaxWithholding =
    applyEmployeeTaxWithholding && recipientType === "employee";
  const isContractorTaxWithholding =
    applyContractorTaxWithholding && recipientType === "employee";

  let netPaymentAmount = paymentAmount;
  let taxWithholdingAmount = 0;
  let taxType = "none";

  if (isEmployeeTaxWithholding) {
    // Calculate employee tax withholding (26.5% total - El Salvador structure)
    taxWithholdingAmount = Math.floor(paymentAmount * 0.265);
    netPaymentAmount = paymentAmount - taxWithholdingAmount;
    taxType = "employee";
  } else if (isContractorTaxWithholding) {
    // Calculate contractor tax withholding (10% total)
    taxWithholdingAmount = Math.floor(paymentAmount * 0.1);
    netPaymentAmount = paymentAmount - taxWithholdingAmount;
    taxType = "contractor";
  }

  // Build payload
  const payload = {
    recipientType,
    recipientId,
    contact,
    company,
    email,
    lightningAddress,
    paymentAmount: netPaymentAmount, // Send net amount to employee
    paymentNote,
    btcUsdRate: btcToUsdRate || null,
    taxWithholding: {
      applied: isEmployeeTaxWithholding || isContractorTaxWithholding,
      type: taxType,
      originalAmount: paymentAmount,
      taxAmount: taxWithholdingAmount,
      netAmount: netPaymentAmount,
      taxAddress: taxLightningAddress,
    },
  };

  try {
    const response = await authFetch(`${API_BASE}/pay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success) {
      if (isEmployeeTaxWithholding) {
        alert(
          `Payment sent!\nEmployee: ${netPaymentAmount} SATS\nEmployee Tax Withholding: ${taxWithholdingAmount} SATS sent to ${taxLightningAddress}`,
        );
      } else if (isContractorTaxWithholding) {
        alert(
          `Payment sent!\nContractor: ${netPaymentAmount} SATS\nContractor Tax Withholding: ${taxWithholdingAmount} SATS sent to ${taxLightningAddress}`,
        );
      } else {
        alert("Payment sent!");
      }
      closeNewPaymentModal();
      await loadTransactions();
      await updateLightningBalance();
    } else {
      alert("Error: " + (data.message || "Failed to send payment."));
    }
  } catch (err) {
    alert("Error sending payment: " + err.message);
  } finally {
    resetSubmitButton(submitBtn);
  }
}

function resetSubmitButton(button) {
  if (button) {
    button.disabled = false;
    button.textContent = "Send";
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

async function submitPayInvoice(event) {
  event.preventDefault();

  const invoice = document.getElementById("invoiceString").value.trim();
  const note = document.getElementById("invoiceNote").value.trim();
  const userAmount = document.getElementById("userAmount").value.trim();

  const submitBtn = document.querySelector("#payInvoiceModal .submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Paying...";
  }

  // Prepare payload
  const payload = { invoice, note, btcUsdRate: btcToUsdRate || null };

  // Include amount if applicable
  const amountEntryDiv = document.getElementById("amountEntry");
  if (amountEntryDiv && amountEntryDiv.style.display !== "none" && userAmount) {
    payload.amount = userAmount;
  }

  // Get Receiver Name input value
  const receiverName = document.getElementById("receiverNameInput");
  if (receiverName && receiverName.value.trim() !== "") {
    payload.receiverName = receiverName.value.trim();
  }

  try {
    const response = await authFetch(`${API_BASE}/pay-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include", // ensure cookies (refresh token) are sent if needed
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error: ${errorText}`);
    }

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
    console.error("Error paying invoice:", err);
    alert("Error paying invoice: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Pay";
    }
  }
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
    // Check token presence
    const token = sessionStorage.getItem("token");

    if (!token) {
      detailsDiv.innerHTML = `<span style="color:red;">Please log in to decode invoices.</span>`;
      if (amountEntryDiv) amountEntryDiv.style.display = "none";
      if (userAmountInput) userAmountInput.required = false;
      return;
    }

    // Use authFetch to handle token and refresh automatically
    const response = await authFetch(`${API_BASE}/decode-invoice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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

///// LOAD TRANSACTIONS FOR HISTORY TABLE /////
async function loadTransactions() {
  try {
    const response = await authFetch(
      `${API_BASE}/transactions?ts=${Date.now()}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // keep if your backend requires cookies for refresh tokens
      },
    );

    if (response.status === 401) {
      throw new Error("Unauthorized access. Please log in again.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(`Expected JSON but received:\n${text.substring(0, 200)}`);
    }

    const data = await response.json();

    if (data.success) {
      transactions = data.transactions;
      renderTransactions(transactions);
    } else {
      console.warn("No transactions returned or success false");
      transactions = [];
      renderTransactions([]);
    }
  } catch (err) {
    console.error("Error loading transactions:", err);
    alert(err.message);
    transactions = [];
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
  try {
    // Determine endpoint based on user role
    const endpoint =
      currentUser.role === "Admin" ||
      currentUser.role === "Manager" ||
      currentUser.role === "Bookkeeper"
        ? "/employees"
        : "/users"; // Employees use /users endpoint

    const response = await authFetch(`${API_BASE}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Read response as text first to handle non-JSON gracefully
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      let errorMsg = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = JSON.parse(text);
        errorMsg = errorData.message || errorMsg;
      } catch {
        // Keep original errorMsg if JSON parsing fails
      }
      throw new Error(errorMsg);
    }

    if (!contentType.includes("application/json")) {
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
    // Add data-member-id attribute for click identification
    row.setAttribute("data-member-id", user.id);

    row.innerHTML = `
      <td>${escapeHtml(user.name) || "N/A"}</td>
      <td>${escapeHtml(user.role) || "N/A"}</td>
      <td>${escapeHtml(user.department) || "N/A"}</td>
      <td>${escapeHtml(user.email) || "N/A"}</td>
      <td>${dateAddedFormatted}</td>
    `;
    tbody.appendChild(row);
  });

  // Setup click listeners for editing team members after rendering
  setupTeamTableClicks(users);
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
      // Show all buttons — Admin can pay directly or create drafts
      setVisibility(newPaymentBtn, true);
      setVisibility(payInvoiceBtn, true);
      setVisibility(draftBtn, true);
      btnRow.style.display = "flex";
      break;

    case "Manager":
      // Show payment buttons, hide draft button
      setVisibility(newPaymentBtn, true);
      setVisibility(payInvoiceBtn, true);
      setVisibility(draftBtn, false);
      btnRow.style.display = "flex";
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

  const batchNav = document.getElementById("batchNav");
  if (batchNav) {
    if (currentUser.role === "Admin" || currentUser.role === "Manager") {
      batchNav.style.display = "block";
    } else {
      batchNav.style.display = "none";
    }
  }

  const suppliersNav = document.getElementById("suppliersNav");
  if (!suppliersNav) return;

  if (
    currentUser.role === "Admin" ||
    currentUser.role === "Manager" ||
    currentUser.role === "Bookkeeper"
  ) {
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

function updateSupplierActionsVisibility() {
  const addBtn = document.querySelector("#suppliersContent .add-btn");
  const removeBtn = document.querySelector("#suppliersContent .remove-btn");

  if (!addBtn || !removeBtn) return;

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
      password: document.getElementById("memberPassword").value.trim(),
    };

    // Validation
    if (
      !newMember.name ||
      !newMember.role ||
      !newMember.email ||
      !newMember.department ||
      !newMember.lightningAddress ||
      !newMember.password
    ) {
      throw new Error("Please fill in all required fields");
    }

    // Use authFetch to handle token and refresh automatically
    const response = await authFetch(`${API_BASE}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newMember),
    });

    // Handle non-OK responses gracefully
    if (!response.ok) {
      const text = await response.text();
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
    resetAddMemberModal();
    document.getElementById("successModal").style.display = "flex";

    await loadTeamMembers();
    await loadDepartments();

    // Clear form fields
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

function resetAddMemberModal() {
  document.getElementById("memberName").value = "";
  document.getElementById("memberRole").value = "";
  document.getElementById("memberEmail").value = "";
  document.getElementById("memberDepartment").value = "";
  document.getElementById("memberLightning").value = "";
  document.getElementById("memberPassword").value = "1234";
}

async function removeTeamMember() {
  try {
    const response = await authFetch(`${API_BASE}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "remove",
        email: selectedMemberEmail,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = text;
      try {
        const data = JSON.parse(text);
        errorMessage = data.message || text;
      } catch {
        // text is not JSON, keep as is
      }
      throw new Error(errorMessage || "Failed to remove member");
    }

    const result = await response.json();

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
  const removeMemberModal = document.getElementById("removeMemberModal");
  const container = document.getElementById("membersListContainer");

  try {
    const response = await authFetch(`${API_BASE}/users`, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(
        "Failed to load members, status:",
        response.status,
        errorData,
      );
      alert(
        "Failed to load members: " + (errorData.message || "Unknown error"),
      );
      return;
    }

    const users = await response.json();

    if (!Array.isArray(users)) {
      console.error("Invalid users data:", users);
      alert("Unexpected data format received from server.");
      return;
    }

    // Store members globally if needed
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
    removeMemberModal.style.display = "flex";
  } catch (err) {
    console.error("Error loading members:", err);
    alert("Failed to load members list due to a network or server error.");
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

async function populateSupplierSelect() {
  const select = document.getElementById("supplierSelect");
  select.disabled = true;
  select.innerHTML = "<option value=''>Loading...</option>";

  try {
    const response = await authFetch(`${API_BASE}/suppliers`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // keep if your backend requires cookies (refresh tokens)
    });

    if (!response.ok) {
      select.innerHTML = "<option value=''>Failed to load suppliers</option>";
      return;
    }

    const data = await response.json();

    if (
      data.success &&
      Array.isArray(data.suppliers) &&
      data.suppliers.length > 0
    ) {
      select.innerHTML = "";
      select.disabled = false;

      const sortedSuppliers = data.suppliers.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      );

      sortedSuppliers.forEach((supplier) => {
        const option = document.createElement("option");
        option.value = supplier.id;
        option.textContent =
          supplier.company || supplier.name || "(Unnamed Supplier)";
        select.appendChild(option);
      });
    } else {
      select.innerHTML = "<option value=''>No suppliers found</option>";
      select.disabled = true;
    }
  } catch (err) {
    console.error("Error loading suppliers:", err);
    select.innerHTML = "<option value=''>Error loading suppliers</option>";
    select.disabled = true;
  }
}

async function openDraftPaymentModal() {
  document.getElementById("draftPaymentModal").style.display = "flex";
  // Load both lists in parallel, then populate the dropdown
  await Promise.all([
    loadEmployeesForPaymentModal(),
    loadSuppliersForPaymentModal(),
  ]);
  // Reset type to default and populate
  document.getElementById("draftRecipientType").value = "employee";
  updateDraftRecipientDropdown();
}

function openAddSupplierModal() {
  document.getElementById("addSupplierModal").style.display = "flex";
  document.getElementById("addSupplierForm").reset();
}
function closeAddSupplierModal() {
  document.getElementById("addSupplierModal").style.display = "none";
}

async function openRemoveSupplierModal() {
  await loadSuppliers();
  populateRemoveSupplierDropdown();
  document.getElementById("removeSupplierModal").style.display = "flex";
}

function closeRemoveSupplierModal() {
  document.getElementById("removeSupplierModal").style.display = "none";
}

async function submitAddSupplier(event) {
  event.preventDefault();

  const company = document.getElementById("supplierName").value.trim();
  const email = document.getElementById("supplierEmail").value.trim();
  const contact = document.getElementById("supplierContact").value.trim();
  const lightningAddress = document
    .getElementById("supplierLightningAddress")
    .value.trim();
  const note = document.getElementById("supplierNote").value.trim();

  // Add createdAt timestamp
  const createdAt = new Date().toISOString();

  // Debug logging
  console.log("Adding supplier with data:", {
    company,
    contact,
    email,
    lightningAddress,
    note,
    createdAt,
  });

  // Check if required fields are empty
  if (!company || !contact || !email || !lightningAddress) {
    console.log("Validation failed - missing required fields");
    alert("Company name, contact, email, and lightning address are required.");
    return;
  }

  try {
    const response = await authFetch(`${API_BASE}/suppliers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        company,
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
    const response = await authFetch(`${API_BASE}/users`, {
      headers: {
        "Content-Type": "application/json",
      },
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
    const response = await authFetch(`${API_BASE}/suppliers`, {
      headers: {
        "Content-Type": "application/json",
      },
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
  select.disabled = true;
  select.innerHTML = "<option value=''>Loading...</option>";

  try {
    const response = await authFetch(`${API_BASE}/suppliers`);
    const data = await response.json();

    if (
      data.success &&
      Array.isArray(data.suppliers) &&
      data.suppliers.length > 0
    ) {
      select.innerHTML = "<option value=''>Select a supplier</option>";
      data.suppliers.forEach((supplier) => {
        const option = document.createElement("option");
        option.value = supplier.id;
        option.textContent = supplier.company?.trim() || "Unnamed Supplier";
        select.appendChild(option);
      });
      select.disabled = false;
    } else {
      select.innerHTML = "<option value=''>No suppliers found</option>";
      select.disabled = true;
    }
  } catch (err) {
    console.error("Error loading suppliers:", err);
    select.innerHTML = "<option value=''>Error loading suppliers</option>";
    select.disabled = true;
  }
}

async function submitRemoveSupplier(event) {
  event.preventDefault();
  const supplierId = document.getElementById("removeSupplierSelect").value;
  if (!supplierId) return;

  if (!confirm("Are you sure you want to remove this supplier?")) return;

  try {
    const response = await authFetch(`${API_BASE}/suppliers/${supplierId}`, {
      method: "DELETE",
      headers: {
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
    if (toggleText) toggleText.textContent = "⛰️ Volcano";
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
    if (toggleText) toggleText.textContent = "⛰️ Volcano";
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
    if (toggleText) toggleText.textContent = "⛰️ Volcano";
    if (volcanoSwitch) volcanoSwitch.checked = false;
    localStorage.setItem("volcanoMode", "off");
  }
}

function isValidEmail(email) {
  // Basic email regex pattern
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function parseCsv(csvData) {
  console.log("Parsing CSV data...");
  try {
    const lines = csvData.split("\n").filter((line) => line.trim() !== "");
    if (lines.length < 2) {
      console.error("CSV must have at least a header and one data row");
      return [];
    }

    const headers = lines[0].split(",").map((header) => header.trim());
    console.log("CSV headers:", headers);

    const data = [];
    for (let i = 1; i < lines.length; i++) {
      // Handle quoted CSV fields and trim whitespace
      const values = lines[i].split(",").map((value) => {
        // Remove quotes if present and trim whitespace
        return value.replace(/^["']|["']$/g, "").trim();
      });
      if (values.length === headers.length) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index];
        });
        data.push(row);
      }
    }

    console.log("Parsed data length:", data.length);
    console.log("Sample parsed row:", data[0]);
    return data;
  } catch (error) {
    console.error("Error in parseCsv:", error);
    return [];
  }
}

function renderBatchTable(data) {
  console.log("Rendering batch table with data:", data);
  console.log("Data length:", data.length);

  // Store the data globally for editing
  batchPaymentData = data;

  const tbody = document.querySelector("#batchTable tbody");
  if (!tbody) {
    console.error("Could not find batch table body.");
    return;
  }

  console.log("Found tbody element");
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    console.warn("No data to render in batch table");
    // Hide Clear and Send buttons when no data
    const clearBtn = document.getElementById("clearBatchBtn");
    const sendBtn = document.getElementById("sendBatchBtn");
    if (clearBtn) clearBtn.style.display = "none";
    if (sendBtn) sendBtn.style.display = "none";
    return;
  }

  data.forEach((row, index) => {
    console.log(`Processing row ${index}:`, row);
    console.log("Row keys:", Object.keys(row));

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.style.transition = "all 0.15s ease";
    tr.setAttribute("data-row-index", index);
    tr.title = "Click to edit this payment";
    // Generate default note if not present
    const defaultNote = `${row["Name"] || "Unknown"} - ${row["Date"] || "No Date"}`;
    const note = row["Note"] || defaultNote;

    tr.innerHTML = `
            <td>${row["Date"] || ""}</td>
            <td>${row["Name"] || ""}</td>
            <td>${row["Amount(sats)"] || ""}</td>
            <td>${row["Lightning-Address"] || ""}</td>
            <td>${note}</td>
            <td>${row["Status"] || "Pending"}</td>
        `;

    // Add click event listener to open edit modal
    tr.addEventListener("click", (event) => {
      // Add visual feedback
      tr.style.transform = "scale(0.98)";
      setTimeout(() => {
        tr.style.transform = "scale(1)";
      }, 150);

      openBatchEditModal(index);
    });

    tbody.appendChild(tr);
  });

  // Show Clear and Send buttons when there's data
  const clearBtn = document.getElementById("clearBatchBtn");
  const sendBtn = document.getElementById("sendBatchBtn");
  if (data.length > 0) {
    if (clearBtn) clearBtn.style.display = "block";
    if (sendBtn) sendBtn.style.display = "block";
  }

  console.log("Finished rendering batch table");
}

// Function to open the batch edit modal
function openBatchEditModal(rowIndex) {
  const modal = document.getElementById("batchEditModal");
  const row = batchPaymentData[rowIndex];

  if (!row) {
    console.error("No data found for row index:", rowIndex);
    return;
  }

  // Update modal title to show which row is being edited
  const modalTitle = modal.querySelector(".modal-title");
  modalTitle.textContent = `Edit Payment - ${row["Name"] || "Row " + (rowIndex + 1)}`;

  // Populate form fields with current row data
  document.getElementById("batchEditDate").value = row["Date"] || "";
  document.getElementById("batchEditName").value = row["Name"] || "";
  document.getElementById("batchEditAmount").value = row["Amount(sats)"] || "";
  document.getElementById("batchEditLightningAddress").value =
    row["Lightning-Address"] || "";

  // Populate note field with existing note or generate default
  const defaultNote = `${row["Name"] || "Unknown"} - ${row["Date"] || "No Date"}`;
  document.getElementById("batchEditNote").value = row["Note"] || defaultNote;

  // Store the row index for later use
  modal.setAttribute("data-editing-row", rowIndex);

  modal.style.display = "flex";
}

// Function to close the batch edit modal (global scope for HTML onclick)
window.closeBatchEditModal = function closeBatchEditModal() {
  const modal = document.getElementById("batchEditModal");
  modal.style.display = "none";

  // Clear form
  document.getElementById("batchEditForm").reset();

  // Reset modal title
  const modalTitle = modal.querySelector(".modal-title");
  if (modalTitle) {
    modalTitle.textContent = "Edit Batch Payment";
  }
};

// Function to handle batch edit form submission
function handleBatchEditSubmit(event) {
  event.preventDefault();

  const modal = document.getElementById("batchEditModal");
  const rowIndex = parseInt(modal.getAttribute("data-editing-row"));

  if (isNaN(rowIndex) || rowIndex < 0 || rowIndex >= batchPaymentData.length) {
    console.error("Invalid row index:", rowIndex);
    alert("Error: Invalid payment row selected");
    return;
  }

  // Get form data
  const formData = new FormData(event.target);
  const date = formData.get("date");
  const name = formData.get("name").trim();
  const amount = formData.get("amount");
  const lightningAddress = formData.get("lightningAddress").trim();
  const note = formData.get("note").trim();

  // Validation
  if (!date || !name || !amount || !lightningAddress) {
    alert("Error: All fields are required");
    return;
  }

  if (isNaN(amount) || parseInt(amount) <= 0) {
    alert("Error: Amount must be a positive number");
    return;
  }

  // Basic Lightning address validation
  if (!isValidEmail(lightningAddress)) {
    alert("Error: Please enter a valid Lightning address");
    return;
  }

  const updatedData = {
    Date: date,
    Name: name,
    "Amount(sats)": amount,
    "Lightning-Address": lightningAddress,
    Note: note || `${name} - ${date}`,
    Status: batchPaymentData[rowIndex]["Status"] || "Pending",
  };

  // Update the data array
  batchPaymentData[rowIndex] = updatedData;

  // Re-render the table with updated data
  renderBatchTable(batchPaymentData);

  // Close modal
  closeBatchEditModal();

  console.log("Updated batch payment row:", rowIndex, updatedData);

  // Show success feedback
  const originalRow = document.querySelector(
    `#batchTable tbody tr[data-row-index="${rowIndex}"]`,
  );
  if (originalRow) {
    originalRow.style.backgroundColor = "#d4edda";
    setTimeout(() => {
      originalRow.style.backgroundColor = "";
    }, 2000);
  }
}

// Function to clear the batch table
function clearBatchTable() {
  const tbody = document.querySelector("#batchTable tbody");
  const rows = tbody ? tbody.querySelectorAll("tr") : [];

  if (rows.length > 0) {
    // Add fade out animation to rows
    rows.forEach((row, index) => {
      setTimeout(() => {
        row.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        row.style.opacity = "0";
        row.style.transform = "translateX(-20px)";
      }, index * 50);
    });

    // Clear the table after animation completes
    setTimeout(
      () => {
        if (tbody) {
          tbody.innerHTML = "";
        }

        // Clear the stored data
        batchPaymentData = [];

        // Hide Clear and Send buttons
        const clearBtn = document.getElementById("clearBatchBtn");
        const sendBtn = document.getElementById("sendBatchBtn");
        if (clearBtn) clearBtn.style.display = "none";
        if (sendBtn) sendBtn.style.display = "none";

        console.log("Batch table cleared");
      },
      rows.length * 50 + 300,
    );
  } else {
    // No rows to animate, just clear immediately
    batchPaymentData = [];
    const clearBtn = document.getElementById("clearBatchBtn");
    const sendBtn = document.getElementById("sendBatchBtn");
    if (clearBtn) clearBtn.style.display = "none";
    if (sendBtn) sendBtn.style.display = "none";
  }
}

function updateBatchTableStatus(statuses) {
  const tableRows = document.querySelectorAll("#batchTable tbody tr");
  tableRows.forEach((row, index) => {
    const statusCell = row.querySelector("td:last-child");
    if (statuses[index] && statuses[index].status) {
      statusCell.innerText = statuses[index].status;
      if (statuses[index].status === "Success") {
        statusCell.style.color = "green";
      } else {
        statusCell.style.color = "red";
      }
    }
  });
}

/////// DOM CONTENT LOADED LISTENER ///////
document.addEventListener("DOMContentLoaded", async () => {
  const isLoggedIn = token && token.split(".").length === 3;
  const volcanoPref = localStorage.getItem("volcanoMode");
  const body = document.body;
  const forgotBtn = document.getElementById("forgotPassword");
  const forgotPasswordModal = document.getElementById("forgotPasswordModal");
  const closeBtn = document.getElementById("closeForgotPassword");
  const sendBtn = document.getElementById("sendResetBtn");
  const msgDiv = document.getElementById("forgotPasswordMessage");
  const emailInput = document.getElementById("forgotEmail");
  const dashboard = document.getElementById("dashboard");
  const toggleText = document.getElementById("volcanoToggleText");
  const volcanoSwitch = document.getElementById("volcanoSwitch");
  const balanceElem = document.getElementById("balanceAmount");
  const transactionModal = document.getElementById("transactionModal");
  const transactionCloseBtn = document.getElementById("closeTransactionModal");
  const editSupplierModal = document.getElementById("editSupplierModal");
  const closeEditSupplierModal = document.getElementById(
    "closeEditSupplierModal",
  );
  const editSupplierForm = document.getElementById("editSupplierForm");

  editTeamMemberModal = document.getElementById("editTeamMemberModal");
  let closeButton = document.getElementById("closeEditTeamMemberModal");
  let editTeamMemberForm = document.getElementById("editTeamMemberForm");
  inputsContainer = document.getElementById("teamMemberInputs");

  if (
    !editTeamMemberModal ||
    !closeButton ||
    !editTeamMemberForm ||
    !inputsContainer
  ) {
    console.error("Edit Team Member modal elements missing");
    return;
  }

  // Close modal handler
  closeButton.addEventListener("click", () => {
    editTeamMemberModal.style.display = "none";
    form.reset();
    inputsContainer.innerHTML = "";
    currentMember = null;
  });

  // Form submit handler
  editTeamMemberForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentMember) {
      return;
    }

    const formData = new FormData(editTeamMemberForm);
    const updatedMember = {};
    for (const [key, value] of formData.entries()) {
      if (key === "newPassword") continue; // handled separately
      updatedMember[key] = value;
    }
    updatedMember.id = currentMember.id;

    // Only include password in payload if admin actually typed a new one
    const newPassword = formData.get("newPassword");
    if (newPassword && newPassword.trim() !== "") {
      updatedMember.password = newPassword.trim();
    }

    try {
      const response = await authFetch(
        `${API_BASE}/team-members/${updatedMember.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updatedMember),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error response from server:", errorData);
        throw new Error(errorData.message || "Failed to update team member");
      }

      const savedMember = await response.json();

      const index = employeesList.findIndex((m) => m.id === savedMember.id);
      if (index !== -1) {
        employeesList[index] = savedMember;
      } else {
        console.warn("Saved member not found in employeesList");
      }

      editTeamMemberModal.style.display = "none";
      editTeamMemberForm.reset();
      inputsContainer.innerHTML = "";
      currentMember = null;

      await loadTeamMembers();
    } catch (error) {
      console.error("Error saving team member:", error);
      alert(`Error saving changes: ${error.message}`);
    }
  });

  updateCurrentDate();

  if (currentUser) {
    loadAccountingPage();
  }

  // Check if we're logged in (for page refresh)
  // Restore user session from token (preferred) or user object (legacy)
  if (token) {
    try {
      // Fetch user profile from backend
      const response = await authFetch(`${API_BASE}/me`);
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
    if (toggleText) toggleText.textContent = "⛰️ Volcano";
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

  if (balanceElem) {
    balanceElem.addEventListener("click", () => {
      currentBalanceMode =
        (currentBalanceMode + 1) % balanceDisplayModes.length;
      updateBalanceDisplay();
    });
  }

  const tbody = document.querySelector("#suppliersTable tbody");
  if (!tbody) {
    console.error("Suppliers table tbody not found");
    return;
  }

  tbody.addEventListener("click", (event) => {
    const tr = event.target.closest("tr");
    if (!tr) return;

    // Bookkeeper and Employee can view but cannot edit suppliers
    if (currentUser.role === "Bookkeeper" || currentUser.role === "Employee") {
      return;
    }

    const supplierId = tr.getAttribute("data-supplier-id");

    if (!supplierId) {
      console.warn("Clicked row has no data-supplier-id");
      return;
    }

    const supplier = suppliersList.find((s) => s.id === supplierId);
    if (!supplier) {
      alert("Supplier not found");
      return;
    }

    // Open modal and populate form
    populateEditSupplierForm(supplier);
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
  document.getElementById("th-recipient").onclick = function () {
    if (pendingDraftsSortColumn === "contactName") {
      pendingDraftsSortAsc = !pendingDraftsSortAsc;
    } else {
      pendingDraftsSortColumn = "contactName";
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
    await addDepartment();
  };

  // Add Member button
  const addMemberBtn = document.getElementById("addMemberBtn");
  if (addMemberBtn) {
    addMemberBtn.addEventListener("click", async () => {
      // Reset the form
      resetAddMemberModal();

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
        if (!token) {
          alert("You must be logged in to remove a member.");
          return;
        }

        const response = await authFetch(`${API_BASE}/users`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "remove",
            email: selectedMemberEmail,
          }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
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

  // Close modal event
  closeEditSupplierModal.addEventListener("click", () => {
    editSupplierModal.style.display = "none";
    editSupplierForm.reset();
    currentSupplier = null;
  });

  // Form submit event
  editSupplierForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    // handle form submission
  });

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

      const recipientType = document.getElementById("draftRecipientType").value;
      const selectedId = document
        .getElementById("draftRecipientSelect")
        .value.trim();
      const recipientEmail = document
        .getElementById("draftRecipientEmail")
        .value.trim();
      const recipientLightningAddress = document
        .getElementById("draftRecipientLightningAddress")
        .value.trim();
      const amount = parseFloat(
        document.getElementById("draftPaymentAmount").value,
      );
      const note = document.getElementById("draftPaymentNote").value.trim();

      if (!selectedId) {
        alert(`Please select a ${recipientType}.`);
        return;
      }

      let company = "";
      let contact = "";

      if (recipientType === "employee") {
        const employee = (employeesList || []).find(
          (e) => (e.id || e.email) === selectedId,
        );
        if (!employee) {
          alert("Selected employee not found.");
          return;
        }
        contact = employee.name || employee.email;
        company = employee.department || "Employee";
      } else {
        const selectedSupplier = (suppliersList || []).find(
          (s) => s.id === selectedId,
        );
        if (!selectedSupplier) {
          alert("Selected supplier not found.");
          return;
        }
        company = selectedSupplier.company;
        contact = selectedSupplier.contact;
      }

      if (
        !recipientEmail ||
        !company ||
        !contact ||
        !recipientLightningAddress ||
        !amount ||
        isNaN(amount) ||
        amount <= 0
      ) {
        alert("Please fill in all required fields with valid values.");
        return;
      }

      const draftData = {
        recipientEmail,
        company,
        contact,
        recipientLightningAddress,
        amount,
        note,
      };

      try {
        const response = await authFetch(`${API_BASE}/drafts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
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
          // Admin sees the pending drafts table, Employee sees their own drafts
          if (currentUser.role === "Admin") {
            await loadPendingDrafts();
          } else {
            await loadEmployeeDrafts();
          }
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
      resetAddMemberModal();
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
      resetAddMemberModal();
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
          /// ??? ///
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

  // Open modal on "Forgot Password" click
  forgotBtn?.addEventListener("click", () => {
    msgDiv.textContent = "";
    msgDiv.style.color = "black";
    emailInput.value = "";
    forgotPasswordModal.style.display = "flex";
    emailInput.focus();
  });

  // Close modal on close button click
  closeBtn?.addEventListener("click", () => {
    forgotPasswordModal.style.display = "none";
  });

  // Close modal if user clicks outside modal content
  window.addEventListener("click", (event) => {
    if (event.target === forgotPasswordModal) {
      forgotPasswordModal.style.display = "none";
    }
  });

  // Handle send reset email button click
  sendBtn?.addEventListener("click", async () => {
    const email = emailInput.value.trim();

    if (!email) {
      msgDiv.style.color = "red";
      msgDiv.textContent = "Please enter your email address.";
      emailInput.focus();
      return;
    }

    if (!isValidEmail(email)) {
      msgDiv.style.color = "red";
      msgDiv.textContent = "Please enter a valid email address.";
      emailInput.focus();
      return;
    }

    msgDiv.style.color = "black";
    msgDiv.textContent = "Sending reset email...";
    sendBtn.disabled = true;

    try {
      const response = await fetch(`${API_BASE}/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        msgDiv.style.color = "green";
        msgDiv.textContent =
          "If that email exists, a reset link has been sent.";

        // Show alert to user
        alert(
          "If that email exists, a reset link has been sent to your email.",
        );

        setTimeout(() => {
          forgotPasswordModal.style.display = "none";
        }, 4000);
      } else {
        msgDiv.style.color = "red";
        msgDiv.textContent = data.message || "Failed to send reset email.";
      }
    } catch (err) {
      console.error("Forgot password error:", err);
      msgDiv.style.color = "red";
      msgDiv.textContent = "Error sending reset email. Please try again.";
    } finally {
      sendBtn.disabled = false;
    }
  });

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

  // Batch edit modal event listeners
  const batchEditModal = document.getElementById("batchEditModal");
  const closeBatchEditModalBtn = document.getElementById("closeBatchEditModal");
  const batchEditForm = document.getElementById("batchEditForm");

  if (closeBatchEditModalBtn) {
    closeBatchEditModalBtn.addEventListener("click", closeBatchEditModal);
  }

  if (batchEditForm) {
    batchEditForm.addEventListener("submit", handleBatchEditSubmit);
  }

  // Close modal when clicking outside of it
  if (batchEditModal) {
    batchEditModal.addEventListener("click", (event) => {
      if (event.target === batchEditModal) {
        closeBatchEditModal();
      }
    });
  }

  // Setup tax calculation listeners
  setupTaxCalculationListeners();

  // Clear batch table button
  const clearBatchBtn = document.getElementById("clearBatchBtn");
  if (clearBatchBtn) {
    clearBatchBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to clear all batch payment data?")) {
        clearBatchTable();
      }
    });
  }

  // Batch payment CSV upload
  const uploadCsvBtn = document.getElementById("uploadCsvBtn");
  if (uploadCsvBtn) {
    uploadCsvBtn.addEventListener("click", () => {
      console.log("CSV upload button clicked");
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".csv";
      fileInput.onchange = (e) => {
        console.log("File selected:", e.target.files[0]);
        const file = e.target.files[0];
        if (file) {
          console.log("File name:", file.name, "Size:", file.size);
          const reader = new FileReader();
          reader.onload = (event) => {
            console.log(
              "File read successfully, length:",
              event.target.result.length,
            );
            const csvData = event.target.result;
            console.log("CSV Data preview:", csvData.substring(0, 200));
            const parsedData = parseCsv(csvData);
            console.log("Parsed data:", parsedData);
            renderBatchTable(parsedData);
          };
          reader.onerror = () => {
            console.error("Error reading file");
            alert("Error reading file. Please try again.");
          };
          reader.readAsText(file);
        }
      };
      fileInput.click();
    });
  }

  document
    .getElementById("sendBatchBtn")
    .addEventListener("click", async () => {
      const tableRows = document.querySelectorAll("#batchTable tbody tr");
      const batchData = [];
      tableRows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        const rowData = {
          date: cells[0].innerText.trim(),
          name: cells[1].innerText.trim(),
          amount: cells[2].innerText.trim(),
          lightningAddress: cells[3].innerText.trim(),
          note: cells[4].innerText.trim(),
        };
        batchData.push(rowData);
      });

      try {
        const response = await authFetch(`${API_BASE}/batch-payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ payments: batchData }),
        });

        const results = await response.json();
        if (results.success) {
          updateBatchTableStatus(results.paymentStatuses);
        } else {
          alert("Batch payment failed: " + results.message);
        }
      } catch (error) {
        console.error("Error sending batch payment:", error);
        alert("An error occurred while sending the batch payment.");
      }
    });
});

// Fetch tax lightning address from server
async function fetchTaxLightningAddress() {
  try {
    const response = await authFetch(`${API_BASE}/tax-address`);
    if (response.ok) {
      const data = await response.json();
      taxLightningAddress = data.taxLightningAddress;
    }
  } catch (error) {
    console.error("Failed to fetch tax lightning address");
    throw error;
  }
}

// Tax Withholding Functions
function toggleEmployeeTaxWithholding() {
  const checkbox = document.getElementById("applyEmployeeTaxWithholding");
  const taxSection = document.getElementById("employeeTaxDeductionSection");
  const recipientType = document.getElementById("recipientType").value;

  // Only show employee tax withholding for employees
  if (checkbox.checked && recipientType === "employee") {
    taxSection.style.display = "block";
    calculateEmployeeTaxWithholding();
    // Ensure mutual exclusion - uncheck contractor tax if employee tax is selected
    const contractorCheckbox = document.getElementById(
      "applyContractorTaxWithholding",
    );
    const contractorSection = document.getElementById(
      "contractorTaxDeductionSection",
    );
    if (contractorCheckbox.checked) {
      contractorCheckbox.checked = false;
      contractorSection.style.display = "none";
    }
  } else {
    taxSection.style.display = "none";
    // Uncheck if not employee
    if (recipientType !== "employee") {
      checkbox.checked = false;
    }
  }
}

function toggleContractorTaxWithholding() {
  const checkbox = document.getElementById("applyContractorTaxWithholding");
  const taxSection = document.getElementById("contractorTaxDeductionSection");
  const recipientType = document.getElementById("recipientType").value;

  // Only show contractor tax withholding for employees (contractors are also paid as employees in system)
  if (checkbox.checked && recipientType === "employee") {
    taxSection.style.display = "block";
    calculateContractorTaxWithholding();
    // Ensure mutual exclusion - uncheck employee tax if contractor tax is selected
    const employeeCheckbox = document.getElementById(
      "applyEmployeeTaxWithholding",
    );
    const employeeSection = document.getElementById(
      "employeeTaxDeductionSection",
    );
    if (employeeCheckbox.checked) {
      employeeCheckbox.checked = false;
      employeeSection.style.display = "none";
    }
  } else {
    taxSection.style.display = "none";
    // Uncheck if not employee
    if (recipientType !== "employee") {
      checkbox.checked = false;
    }
  }
}

function calculateEmployeeTaxWithholding() {
  const amountInput = document.getElementById("paymentAmount");
  const amount = parseFloat(amountInput.value) || 0;

  // El Salvador Employee Deductions
  const isssEmployee = Math.floor(amount * 0.03); // 3%
  const afpEmployee = Math.floor(amount * 0.0725); // 7.25%

  // El Salvador Employer Contributions
  const isssEmployer = Math.floor(amount * 0.075); // 7.5%
  const afpEmployer = Math.floor(amount * 0.0875); // 8.75%

  // Total deductions (26.5%)
  const totalDeducted = isssEmployee + afpEmployee + isssEmployer + afpEmployer;

  // Net payment to employee (73.5%)
  const netPayment = amount - totalDeducted;

  // Update display
  document.getElementById("isssEmployeeAmount").textContent =
    isssEmployee.toLocaleString();
  document.getElementById("afpEmployeeAmount").textContent =
    afpEmployee.toLocaleString();
  document.getElementById("isssEmployerAmount").textContent =
    isssEmployer.toLocaleString();
  document.getElementById("afpEmployerAmount").textContent =
    afpEmployer.toLocaleString();
  document.getElementById("totalDeducted").textContent =
    totalDeducted.toLocaleString();
  document.getElementById("netPayment").textContent =
    netPayment.toLocaleString();
}

function calculateContractorTaxWithholding() {
  const amountInput = document.getElementById("paymentAmount");
  const amount = parseFloat(amountInput.value) || 0;

  // Contractor tax withholding (10%)
  const contractorTax = Math.floor(amount * 0.1);

  // Net payment to contractor (90%)
  const netPayment = amount - contractorTax;

  // Update display
  document.getElementById("contractorTaxAmount").textContent =
    contractorTax.toLocaleString() + " SATS";
  document.getElementById("contractorNetPayment").textContent =
    netPayment.toLocaleString() + " SATS";
  document.getElementById("contractorTotalTax").textContent =
    contractorTax.toLocaleString() + " SATS";
}

// Update recipient type change handler
function updateRecipientDropdown() {
  const recipientType = document.getElementById("recipientType").value;
  const recipientSelect = document.getElementById("recipientSelect");
  const employeeTaxCheckbox = document.getElementById(
    "applyEmployeeTaxWithholding",
  );
  const contractorTaxCheckbox = document.getElementById(
    "applyContractorTaxWithholding",
  );
  const employeeTaxSection = document.getElementById(
    "employeeTaxDeductionSection",
  );
  const contractorTaxSection = document.getElementById(
    "contractorTaxDeductionSection",
  );
  const taxWithholdingContainer = document.getElementById(
    "taxWithholdingCheckbox",
  );

  // Show/hide tax withholding checkboxes based on recipient type
  if (recipientType === "employee") {
    if (taxWithholdingContainer) {
      taxWithholdingContainer.style.display = "block";
    }
  } else {
    if (taxWithholdingContainer) {
      taxWithholdingContainer.style.display = "none";
    }
    if (employeeTaxCheckbox) employeeTaxCheckbox.checked = false;
    if (contractorTaxCheckbox) contractorTaxCheckbox.checked = false;
    if (employeeTaxSection) employeeTaxSection.style.display = "none";
    if (contractorTaxSection) contractorTaxSection.style.display = "none";
  }

  // Clear the recipient dropdown
  recipientSelect.innerHTML = '<option value="">Select a recipient</option>';

  if (recipientType === "employee") {
    // Populate with employees
    if (employeesList && employeesList.length > 0) {
      employeesList.forEach((employee) => {
        const option = document.createElement("option");
        option.value = employee.email;
        option.textContent = `${employee.name} (${employee.email})`;
        recipientSelect.appendChild(option);
      });
    }
  } else if (recipientType === "supplier") {
    // Populate with suppliers
    if (suppliersList && suppliersList.length > 0) {
      suppliersList.forEach((supplier) => {
        const option = document.createElement("option");
        option.value = supplier.id;
        option.textContent = supplier.company;
        recipientSelect.appendChild(option);
      });
    }
  }
}

// Add event listeners for payment amount changes to recalculate tax
function setupTaxCalculationListeners() {
  const paymentAmountInput = document.getElementById("paymentAmount");
  if (paymentAmountInput) {
    paymentAmountInput.addEventListener("input", () => {
      const employeeTaxCheckbox = document.getElementById(
        "applyEmployeeTaxWithholding",
      );
      const contractorTaxCheckbox = document.getElementById(
        "applyContractorTaxWithholding",
      );

      if (employeeTaxCheckbox && employeeTaxCheckbox.checked) {
        calculateEmployeeTaxWithholding();
      }

      if (contractorTaxCheckbox && contractorTaxCheckbox.checked) {
        calculateContractorTaxWithholding();
      }
    });
  }
}

// QR Scanner Functions (Global scope)
let qrScanner = null;

window.openQrScanner = async function openQrScanner() {
  console.log("openQrScanner called");
  const modal = document.getElementById("qrScannerModal");
  const video = document.getElementById("qrScannerVideo");
  const status = document.getElementById("qrScannerStatus");

  // Check if jsQR library is available
  console.log("jsQR available:", typeof jsQR !== "undefined");

  if (typeof jsQR === "undefined") {
    console.error("jsQR library not loaded");
    alert(
      "QR Scanner library not loaded. Please refresh the page and try again.",
    );
    return;
  }

  try {
    // Show modal
    modal.style.display = "flex";

    // Update status
    status.textContent = "Starting camera...";
    status.style.color = "#666";

    // Get camera stream
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });

    video.srcObject = stream;
    video.play();

    status.textContent = "Position the QR code in front of your camera";
    status.style.color = "#666";

    // Start scanning
    startScanning(video);
  } catch (error) {
    console.error("Error starting QR scanner:", error);
    status.textContent = "Camera access denied or not available";
    status.style.color = "#e74c3c";
  }
};

window.closeQrScanner = function closeQrScanner() {
  const modal = document.getElementById("qrScannerModal");
  const video = document.getElementById("qrScannerVideo");

  // Stop camera stream
  if (video.srcObject) {
    const tracks = video.srcObject.getTracks();
    tracks.forEach((track) => track.stop());
    video.srcObject = null;
  }

  // Stop scanning loop
  if (qrScanner) {
    clearInterval(qrScanner);
    qrScanner = null;
  }

  // Hide modal
  modal.style.display = "none";
};

function startScanning(video) {
  const canvas = document.createElement("canvas");
  const canvasContext = canvas.getContext("2d");

  qrScanner = setInterval(() => {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.height = video.videoHeight;
      canvas.width = video.videoWidth;
      canvasContext.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = canvasContext.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code) {
        console.log("QR Code detected:", code.data);
        handleQrScanResult(code.data);
      }
    }
  }, 100);
}

function handleQrScanResult(data) {
  const status = document.getElementById("qrScannerStatus");

  // Check if it's a Lightning invoice
  if (
    data.toLowerCase().startsWith("lnbc") ||
    data.toLowerCase().startsWith("lightning:")
  ) {
    // Extract invoice if it has lightning: prefix
    let invoice = data;
    if (data.toLowerCase().startsWith("lightning:")) {
      invoice = data.substring(10); // Remove 'lightning:' prefix
    }

    // Update status to success
    status.textContent = "Lightning invoice detected! Processing...";
    status.style.color = "#28a745";

    // Populate the invoice field
    document.getElementById("invoiceString").value = invoice;

    // Trigger the existing invoice processing
    onInvoiceInputChange();

    // Close scanner after short delay
    setTimeout(() => {
      closeQrScanner();
    }, 1000);
  } else {
    // Not a Lightning invoice
    status.textContent = "Not a Lightning invoice QR code. Please try again.";
    status.style.color = "#e74c3c";

    // Reset status after 3 seconds
    setTimeout(() => {
      status.textContent = "Position the QR code in front of your camera";
      status.style.color = "#666";
    }, 3000);
  }
}

// Close QR scanner when clicking outside
document.addEventListener("click", function (event) {
  const modal = document.getElementById("qrScannerModal");
  if (event.target === modal) {
    closeQrScanner();
  }
});

// API base URL
const API_BASE = "http://localhost:3001";
let currentUser = null;
let membersToRemove = [];
let selectedMemberEmail = null;
let invoiceDecodeTimeout = null;
let employeesList = [];
let suppliersList = [];

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

    if (data.success) {
      currentUser = data.user;
      sessionStorage.setItem("user", JSON.stringify(data.user));
      sessionStorage.setItem("token", "logged-in");
      showDashboard();
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

  // Update user info
  document.getElementById("userGreeting").textContent =
    `Welcome, ${currentUser.name} (${currentUser.role})`;
  document.getElementById("displayEmail").textContent = currentUser.email;
  document.getElementById("displayRole").textContent = currentUser.role;
  document.getElementById("displayDept").textContent = currentUser.department;

  // Personalized welcome message
  const firstName = currentUser.name.split(" ")[0];
  document.getElementById("personalWelcome").textContent =
    `${firstName} has successfully logged in.`;
  // Load initial content
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
}

// ===== Main Accounting Loader =====
async function loadAccountingPage() {
  showLoadingSpinner();

  try {
    await Promise.all([loadTransactions(), updateLightningBalance()]);
  } catch (err) {
    console.log("Failed to load accounting data");
  } finally {
    hideLoadingSpinner();
  }
}

// Show content function
async function showContent(contentId, event) {
  // Hide all content sections
  document.getElementById("welcomeContent").style.display = "none";
  document.getElementById("accountingContent").style.display = "none";
  document.getElementById("teamPageContent").style.display = "none"; // <-- Use the wrapper!
  document.getElementById("settingsContent").style.display = "none";
  document.getElementById("suppliersContent").style.display = "none";

  // Show selected content
  const contentElement = document.getElementById(
    (contentId === "team" ? "teamPage" : contentId) + "Content",
  );
  if (contentElement) {
    contentElement.style.display = "block";
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
      await loadDepartments(); // <-- Load departments when Team page is shown
    } else if (contentId === "suppliers") {
      loadSuppliers();
    }
  } catch (err) {
    console.error(`Error loading ${contentId} data:`, err);
  }
}

async function updateLightningBalance() {
  const balanceElem = document.getElementById("balanceAmount");
  const spinnerElem = document.getElementById("balanceSpinner");
  try {
    // Show spinner, hide balance amount
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
    // Hide spinner, show balance amount
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
async function removeDepartment() {
  const select = document.getElementById("removeDepartmentSelect");
  if (!select) return;
  const dep = select.value;
  if (!dep) return;
  try {
    const response = await fetch(`${API_BASE}/api/departments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ department: dep }),
    });
    if (!response.ok) {
      const data = await response.json();
      alert(data.error || "Failed to remove department");
      return;
    }
    await loadDepartments();
    await loadRemoveDepartmentSelect();
  } catch (err) {
    console.error("Error removing department:", err);
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
  const tbody = document.querySelector("#suppliersTable tbody");
  tbody.innerHTML = "";
  suppliers.forEach((supplier) => {
    const row = document.createElement("tr");
    row.innerHTML = `
            <td>${supplier.name}</td>
            <td>${supplier.contact || ""}</td>
            <td>${supplier.email || ""}</td>
            <td>${supplier.lightningAddress || ""}</td>
        `;
    tbody.appendChild(row);
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

      // Expiry
      if (decoded.expiry) {
        let expiryHours = Math.floor(decoded.expiry / 3600);
        let expiryMins = Math.floor((decoded.expiry % 3600) / 60);
        let expiryStr = `${decoded.expiry} seconds`;
        if (expiryHours > 0)
          expiryStr = `${expiryHours} hour(s) ${expiryMins} min(s)`;
        else if (expiryMins > 0) expiryStr = `${expiryMins} min(s)`;
        html += `<li><strong>Expires In:</strong> ${expiryStr}</li>`;
      }

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

  try {
    const response = await fetch(`${API_BASE}/suppliers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contact, email, lightningAddress, note }),
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

function toggleVolcanoMode() {
  const body = document.body;
  const dashboard = document.getElementById("dashboard");
  const toggleText = document.getElementById("volcanoToggleText");
  const volcanoSwitch = document.getElementById("volcanoSwitch");

  // Toggle the class
  const isVolcano = body.classList.toggle("volcano-mode");
  if (dashboard) dashboard.classList.toggle("volcano-mode");

  // Update toggle text and switch
  if (isVolcano) {
    if (toggleText) toggleText.textContent = "🌋 Normal Mode";
    if (volcanoSwitch) volcanoSwitch.checked = true;
    localStorage.setItem("volcanoMode", "on");
  } else {
    if (toggleText) toggleText.textContent = "🌋 Volcano Mode";
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
document.addEventListener("DOMContentLoaded", () => {
  updateCurrentDate();

  // Check if we're logged in (for page refresh)
  if (sessionStorage.getItem("token")) {
    currentUser = JSON.parse(sessionStorage.getItem("user"));
    showDashboard();
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
      document.getElementById("paymentModal").style.display = "flex";
    });
  }

  const closeModalBtn = document.getElementById("closeModalBtn");
  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => {
      document.getElementById("paymentModal").style.display = "none";
    });
  }

  const submitPaymentBtn = document.getElementById("submitPaymentBtn");
  if (submitPaymentBtn) {
    submitPaymentBtn.addEventListener("click", submitPayment);
  }

  window.addEventListener("click", (event) => {
    if (event.target === document.getElementById("paymentModal")) {
      document.getElementById("paymentModal").style.display = "none";
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

  const volcanoSwitch = document.getElementById("volcanoSwitch");
  // Restore mode from storage
  setVolcanoMode(localStorage.getItem("volcanoMode") === "on");
  // Only use the checkbox to trigger mode change
  if (volcanoSwitch) {
    volcanoSwitch.addEventListener("change", function () {
      setVolcanoMode(this.checked);
    });
  }
  // Optional: clicking the text also toggles the switch
  const toggleText = document.getElementById("volcanoToggleText");
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

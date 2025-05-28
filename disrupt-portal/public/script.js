// API base URL
const API_BASE = "http://localhost:3001";
let currentUser = null;
let membersToRemove = [];
let selectedMemberEmail = null;

// Initialize the page
document.addEventListener("DOMContentLoaded", () => {
  // Set current date
});

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
  // Example: Show a loading spinner or overlay
  // You can customize this based on your HTML/CSS
  const spinner = document.getElementById("loadingSpinner");
  if (spinner) spinner.style.display = "block";
}

// Alby OAuth
// document.getElementById("connectAlby").addEventListener("click", async () => {
//   try {
//     const alby = new window.AlbySDK();
//     const result = await alby.login();

//     // Save the access token to your user session
//     const response = await fetch("/api/auth/link-alby", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         userId: currentUser.id,
//         accessToken: result.accessToken,
//       }),
//     });

//     if (response.ok) {
//       alert("Alby wallet connected!");
//       updateLightningBalance();
//     }
//   } catch (err) {
//     console.error("Alby connection failed:", err);
//   }
// });

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
  // showLoadingSpinner(true);

  try {
    await Promise.all([loadTransactions(), updateLightningBalance()]);
  } catch (err) {
    console.log("Failed to load accounting data");
  } finally {
    // showLoadingSpinner(false);
  }
}

// Show content function
async function showContent(contentId, event) {
  // Hide all content sections
  document.getElementById("welcomeContent").style.display = "none";
  document.getElementById("accountingContent").style.display = "none";
  document.getElementById("teamContent").style.display = "none";

  // Show selected content
  const contentElement = document.getElementById(contentId + "Content");
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
      loadAccountingPage(); // Calls both functions
    } else if (contentId === "team") {
      await loadTeamMembers();
    }
  } catch (err) {
    console.error(`Error loading ${contentId} data:`, err);
  }
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
    const row = document.createElement("tr");

    // Add lightning icon if it's a lightning transaction
    const icon = txn.type === "lightning" ? "⚡" : "";

    row.innerHTML = `
                  <td>${txn.date}</td>
                  <td>${icon} ${txn.receiver}</td>
                  <td>${txn.amount} sats</td>
                  <td>${txn.status || "completed"}</td>
                  <td>${txn.memo || ""}</td>
                `;
    tbody.appendChild(row);
  });
}

// Submit New Payment
async function submitPayment() {
  const paymentData = {
    name: document.getElementById("paymentName").value,
    email: document.getElementById("paymentEmail").value,
    address: document.getElementById("paymentAddress").value,
    amount: document.getElementById("paymentAmount").value,
    note: document.getElementById("paymentNote").value,
  };

  try {
    const response = await fetch(`${API_BASE}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paymentData),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Payment failed");

    // Refresh transactions
    await loadTransactions();
    document.getElementById("paymentModal").style.display = "none";
    alert("Payment submitted successfully!");
  } catch (err) {
    console.error("Payment error:", err);
    alert(`Error: ${err.message}`);
  }
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
  const tbody = document.querySelector("#transactionsTable tbody");
  tbody.innerHTML = ""; // Clear existing rows

  transactions.forEach((txn) => {
    const row = document.createElement("tr");
    row.innerHTML = `
                  <td>${formatDate(txn.date)}</td>
                  <td>${txn.receiver || txn.name || "N/A"}</td>
                  <td class="amount-cell">${txn.amount} BTC</td>
                  <td class="txn-id">${txn.id.substring(0, 8)}...</td>
                  <td>${txn.note || ""}</td>
                `;
    tbody.appendChild(row);
  });
}

// Helper function to format date
function formatDate(dateString) {
  const options = {
    year: "numeric",
    month: "short",
    day: "numeric",
  };
  return new Date(dateString).toLocaleDateString("en-US", options);
}

// Lightning Balance
// async function updateLightningBalance() {
//   try {
//     const response = await fetch("/api/lightning/balance");
//     const { balance } = await response.json();

//     // Update both BTC and USD equivalent
//     document.getElementById("btcBalance").textContent = `${balance} sats`;
//     document.getElementById("usdBalance").textContent =
//       `≈ $${(balance * 0.000035).toFixed(2)}`;
//   } catch (err) {
//     console.error("Failed to fetch balance:", err);
//     document.getElementById("btcBalance").textContent = "Error loading";
//   }
// }

// Team Members Functions
async function loadTeamMembers() {
  const tbody = document.querySelector("#teamTable tbody");
  if (!tbody) return;

  // Show loading state
  tbody.innerHTML =
    '<tr><td colspan="4" class="loading-message">Loading team members...</td></tr>';

  try {
    const response = await fetch(`${API_BASE}/users`);

    // Check if response is OK (status 200-299)
    if (!response.ok) {
      // Try to get error details from response
      let errorMsg = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.message) {
          errorMsg += ` - ${errorData.message}`;
        }
      } catch (e) {
        console.log("Could not parse error response");
      }
      throw new Error(errorMsg);
    }

    const data = await response.json();

    // Verify response structure
    if (!data || !Array.isArray(data.users)) {
      throw new Error("Invalid response format from server");
    }

    // Render the team members
    renderTeamMembers(data.users);
  } catch (err) {
    console.error("Failed to load team members:", err);

    // Show error in UI
    tbody.innerHTML = `
                        <tr>
                            <td colspan="4" class="error-message">
                                Failed to load team members.
                                ${err.message || "Please try again later."}
                            </td>
                        </tr>
                    `;

    // Optionally show a retry button
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
    // console.log("Sending:", newMember);

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

  // Add Member button
  const addMemberBtn = document.getElementById("addMemberBtn");
  if (addMemberBtn) {
    addMemberBtn.addEventListener("click", () => {
      document.getElementById("addMemberModal").style.display = "flex";
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

  // Remove the redundant DOMContentLoaded listener!
});

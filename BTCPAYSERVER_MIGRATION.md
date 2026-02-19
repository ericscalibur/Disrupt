# BTCPayServer Migration Plan

A reference document for migrating Disrupt Portal's payment layer from the Blink API to BTCPayServer.

---

## Why Migrate?

| | Blink | BTCPayServer |
|---|---|---|
| **Custody** | Custodial — Blink holds your funds | Self-hosted — you control the node |
| **API style** | GraphQL | REST |
| **Hosting** | Cloud (blink.sv) | Self-hosted or VPS |
| **Privacy** | KYC required | No KYC |
| **Lightning address** | Provided by Blink | Via your own domain |
| **Fees** | Blink margin | Only network fees |
| **El Salvador focus** | Yes | Global |

The main motivation is sovereignty — BTCPayServer puts you in full control of your Lightning node and funds.

---

## Prerequisites

Before starting the migration:

1. A running BTCPayServer instance (self-hosted or hosted service like Voltage)
   - [BTCPayServer installation docs](https://docs.btcpayserver.org/Deployment/)
2. A Lightning node connected to your BTCPayServer (LND or CLN)
3. A Store created in your BTCPayServer dashboard
4. An API key generated with the following permissions:
   - `btcpay.store.canviewstoreinfo`
   - `btcpay.store.cancreatelightninginvoice`
   - `btcpay.store.canpaylightninginvoice`
   - `btcpay.store.canviewlightninginvoice`
   - `btcpay.store.canviewlightningbalance`

---

## Step 1 — New Environment Variables

Replace the Blink variables in `.env`:

```env
# Remove these:
# BLINK_API_KEY=...

# Add these:
BTCPAY_URL=https://your-btcpay-server.com
BTCPAY_API_KEY=your-btcpay-api-key
BTCPAY_STORE_ID=your-store-id
```

Update `setup.js` to prompt for `BTCPAY_URL`, `BTCPAY_API_KEY`, and `BTCPAY_STORE_ID` instead of `BLINK_API_KEY`.

---

## Step 2 — Install / Remove Dependencies

```bash
# No new dependencies needed — axios and lnurl-pay stay
# Remove unused Blink-specific packages if any were added
npm uninstall  # nothing to remove — axios stays
```

`lnurl-pay` stays because BTCPayServer still requires resolving Lightning addresses to BOLT11 invoices before paying them. `bolt11` stays for invoice decoding.

---

## Step 3 — Replace Server Constants

In `server.js`, replace:

```js
// BEFORE
const BLINK_API_KEY = process.env.BLINK_API_KEY;

// AFTER
const BTCPAY_URL      = process.env.BTCPAY_URL;
const BTCPAY_API_KEY  = process.env.BTCPAY_API_KEY;
const BTCPAY_STORE_ID = process.env.BTCPAY_STORE_ID;

// Shared auth header helper
function btcpayHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `token ${BTCPAY_API_KEY}`,
  };
}
```

---

## Step 4 — Replace Core Functions

### 4a. `getBlinkWallets()` → `getBTCPayBalance()`

Blink returns wallet objects with an id and balance. BTCPayServer has a dedicated balance endpoint.

```js
// BEFORE — Blink GraphQL
async function getBlinkWallets() {
  const response = await axios.post(
    "https://api.blink.sv/graphql",
    { query: `query { me { defaultAccount { wallets { id walletCurrency balance } } } }` },
    { headers: { "Content-Type": "application/json", "X-API-KEY": BLINK_API_KEY } }
  );
  return response.data.data.me.defaultAccount.wallets;
}

// AFTER — BTCPayServer REST
async function getBTCPayBalance() {
  const response = await axios.get(
    `${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/lightning/BTC/balance`,
    { headers: btcpayHeaders() }
  );
  // response.data.localBalance is in millisatoshis — convert to sats
  return Math.floor(response.data.localBalance / 1000);
}
```

Update the balance route:

```js
// BEFORE
app.get("/api/balance", authenticateToken, async (req, res) => {
  const wallets = await getBlinkWallets();
  const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
  res.json({ success: true, balanceSats: btcWallet.balance });
});

// AFTER
app.get("/api/balance", authenticateToken, async (req, res) => {
  try {
    const balanceSats = await getBTCPayBalance();
    res.json({ success: true, balanceSats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
```

---

### 4b. `getBlinkTransactions()` → `getBTCPayTransactions()`

```js
// BEFORE — Blink GraphQL
async function getBlinkTransactions() {
  const response = await axios.post(
    "https://api.blink.sv/graphql",
    { query: `query { me { defaultAccount { transactions(first: 50) {
      edges { node { id initiationVia { __typename } settlementAmount
      settlementCurrency createdAt status direction memo } } } } } }` },
    { headers: { "Content-Type": "application/json", "X-API-KEY": BLINK_API_KEY } }
  );
  return response.data.data.me.defaultAccount.transactions.edges.map(e => e.node);
}

// AFTER — BTCPayServer REST
async function getBTCPayTransactions() {
  const response = await axios.get(
    `${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/lightning/BTC/payments?take=50`,
    { headers: btcpayHeaders() }
  );
  // Map BTCPayServer payment shape to the format the rest of the app expects
  return response.data.map((p) => ({
    id:               p.paymentHash,
    status:           p.status.toUpperCase(),      // "complete" → "COMPLETE"
    direction:        p.totalAmount < 0 ? "SENT" : "RECEIVED",
    settlementAmount: Math.abs(Math.floor(p.totalAmount / 1000)), // msats → sats
    settlementCurrency: "BTC",
    createdAt:        p.createdAt,
    memo:             p.description || "",
  }));
}
```

---

### 4c. Pay BOLT11 Invoice

This is the most common operation — used in draft approval, Pay Invoice modal, and employee/tax payments.

Blink required fetching a `walletId` before every payment. BTCPayServer uses `storeId` from the environment — no pre-fetch needed.

```js
// BEFORE — Blink (simplified)
// 1. Fetch walletId from getBlinkWallets()
// 2. GraphQL mutation lnInvoicePaymentSend with walletId + paymentRequest

// AFTER — BTCPayServer REST
async function payBolt11Invoice(invoice, { note = "" } = {}) {
  const response = await axios.post(
    `${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/lightning/BTC/invoices/pay`,
    { BOLT11: invoice, maxFeeFlat: 10 },   // maxFeeFlat in sats — adjust as needed
    { headers: btcpayHeaders() }
  );
  // BTCPayServer returns 200 with no body on success
  // Throws on failure (4xx/5xx)
  return response.status === 200;
}
```

---

### 4d. Pay Lightning Address Directly

Blink had a native `lnLightningAddressPaymentSend` GraphQL mutation. BTCPayServer does not — you resolve the address to an invoice first using `lnurl-pay` (already in the project), then pay the invoice.

```js
// BEFORE — Blink native Lightning address payment (one GraphQL call)
// lnLightningAddressPaymentSend mutation with lnAddress + amount

// AFTER — resolve via lnurl-pay, then pay the invoice
async function payLightningAddress(lnAddress, amountSats, memo = "") {
  // Step 1: resolve Lightning address → BOLT11 invoice (lnurl-pay stays)
  const lnurlResp = await lnurlPay.requestInvoice({
    lnUrlOrAddress: lnAddress,
    tokens: amountSats,
    comment: memo,
  });
  const invoice = lnurlResp.invoice;
  if (!invoice) throw new Error("Could not resolve Lightning address to invoice.");

  // Step 2: pay the invoice via BTCPayServer
  await payBolt11Invoice(invoice);
  return invoice;
}
```

This pattern already exists in the codebase for employee and draft payments — it just needs the Blink payment step swapped out.

---

### 4e. BTC/USD Rate

Blink served this via its own GraphQL endpoint. Switch to BTCPayServer's rate API or keep using CoinGecko (already used as a fallback in the frontend).

```js
// BEFORE — Blink GraphQL btcPrice
const url = "https://api.blink.sv/graphql";
const query = { query: "query { btcPrice { base offset } }" };
// ...

// AFTER — BTCPayServer rate API
app.get("/api/btc-usd-rate", authenticateToken, async (req, res) => {
  try {
    const response = await axios.get(
      `${BTCPAY_URL}/api/v1/rates?storeId=${BTCPAY_STORE_ID}&currencyPairs=BTC_USD`,
      { headers: btcpayHeaders() }
    );
    const pair = response.data.find((r) => r.currencyPair === "BTC_USD");
    const rate = pair ? parseFloat(pair.rate) : null;
    res.json({ success: !!rate, rate });
  } catch (err) {
    res.json({ success: false, rate: null, error: err.message });
  }
});
```

---

## Step 5 — Full Route-by-Route Replacement Map

| Route | Blink operation | BTCPayServer replacement |
|---|---|---|
| `GET /api/balance` | `getBlinkWallets()` → find BTC wallet balance | `GET /lightning/BTC/balance` |
| `GET /api/transactions` | `getBlinkTransactions()` | `GET /lightning/BTC/payments` |
| `POST /api/transactions` | `lnLightningAddressPaymentSend` mutation | resolve via lnurl-pay → `POST /lightning/BTC/invoices/pay` |
| `POST /api/pay-invoice` | fetch walletId → `lnInvoicePaymentSend` mutation | `POST /lightning/BTC/invoices/pay` |
| `POST /api/drafts/:id/approve` | fetch walletId → resolve LNURL → `lnInvoicePaymentSend` | resolve LNURL → `POST /lightning/BTC/invoices/pay` |
| `POST /api/payments/employee` | resolve two LNURLs → fetch walletId → two `lnInvoicePaymentSend` calls | resolve two LNURLs → two `POST /lightning/BTC/invoices/pay` calls |
| `POST /api/batch-payments` | loop: resolve LNURL → fetch walletId → `lnInvoicePaymentSend` | loop: resolve LNURL → `POST /lightning/BTC/invoices/pay` |
| `GET /api/btc-usd-rate` | Blink `btcPrice` GraphQL | `GET /api/v1/rates?currencyPairs=BTC_USD` |

---

## Step 6 — Remove walletId Fetch Pattern

Blink required fetching a `walletId` before every single payment. This pattern appears ~4 times in `server.js`:

```js
// This entire block can be deleted everywhere it appears:
let walletId;
const walletQuery = `query { me { defaultAccount { wallets { id walletCurrency } } } }`;
const walletResp = await axios.post("https://api.blink.sv/graphql", ...);
const wallets = walletResp.data.data.me.defaultAccount.wallets;
const btcWallet = wallets.find((w) => w.walletCurrency === "BTC");
walletId = btcWallet.id;
```

BTCPayServer uses `BTCPAY_STORE_ID` from the environment — no pre-fetch needed. Every `walletId` reference in mutation variables gets replaced with nothing (it's just not needed).

---

## Step 7 — Update setup.js

Replace the Blink API key prompt with BTCPayServer prompts:

```js
// BEFORE
const blinkApiKey = await askHidden(
  "  Blink API key    (optional, press Enter to skip): "
);

// AFTER
console.log("");
console.log("  BTCPayServer connection details (from your BTCPay dashboard):");
const btcpayUrl = await ask(
  "  BTCPayServer URL  (e.g. https://btcpay.yourdomain.com): "
);
const btcpayApiKey = await askHidden(
  "  BTCPay API key   (input visible): "
);
const btcpayStoreId = await ask(
  "  BTCPay Store ID: "
);
```

And in `writeEnvValues`:

```js
// Replace BLINK_API_KEY block with:
if (btcpayUrl) {
  env = env.replace(/^BTCPAY_URL=.*$/m, `BTCPAY_URL=${btcpayUrl}`);
  if (!/^BTCPAY_URL=/m.test(env)) env += `\nBTCPAY_URL=${btcpayUrl}`;
}
if (btcpayApiKey) {
  env = env.replace(/^BTCPAY_API_KEY=.*$/m, `BTCPAY_API_KEY=${btcpayApiKey}`);
  if (!/^BTCPAY_API_KEY=/m.test(env)) env += `\nBTCPAY_API_KEY=${btcpayApiKey}`;
}
if (btcpayStoreId) {
  env = env.replace(/^BTCPAY_STORE_ID=.*$/m, `BTCPAY_STORE_ID=${btcpayStoreId}`);
  if (!/^BTCPAY_STORE_ID=/m.test(env)) env += `\nBTCPAY_STORE_ID=${btcpayStoreId}`;
}
```

---

## Step 8 — Update .env.example

```env
# BTCPayServer Configuration
BTCPAY_URL=https://your-btcpay-server.com
BTCPAY_API_KEY=your-btcpay-api-key
BTCPAY_STORE_ID=your-store-id
```

---

## Key Differences to Watch Out For

### Amounts are in millisatoshis
BTCPayServer Lightning API returns amounts in **millisatoshis (msats)**, not satoshis. Always divide by 1000:

```js
const sats = Math.floor(response.data.localBalance / 1000);
```

### Auth header is different
```js
// Blink
"X-API-KEY": BLINK_API_KEY

// BTCPayServer
"Authorization": `token ${BTCPAY_API_KEY}`
```

### No native Lightning address payment
BTCPayServer cannot send directly to a Lightning address in one call — you must resolve it to a BOLT11 invoice first via `lnurl-pay`. The good news is this pattern already exists in the codebase.

### Payment status values are different
```js
// Blink statuses:   "SUCCESS", "PENDING", "FAILED", "ALREADY_PAID"
// BTCPayServer:     "complete", "pending", "failed"
// Normalize with:   status.toUpperCase()
```

### Transaction history shape is different
BTCPayServer payments don't have a `receiver` field — that information lives in your local `transactions.json`. The existing merge logic in `server.js` (which merges Blink transactions with local ones) will still work — just replace `getBlinkTransactions()` with `getBTCPayTransactions()`.

---

## What Stays the Same

- `lnurl-pay` — still needed to resolve Lightning addresses to BOLT11 invoices
- `bolt11` — still needed to decode invoices and extract payment hashes
- All JWT auth, role-based access, and middleware — untouched
- All data files (`transactions.json`, `users.json`, etc.) — untouched
- All frontend (`script.js`, `index.html`, `style.css`) — untouched
- Tax withholding logic — untouched (just the payment calls change)
- Batch payment logic — only the inner payment call changes

---

## Effort Estimate

| Task | Estimated Time |
|---|---|
| Set up BTCPayServer + Lightning node | 1–2 hours |
| Replace env vars and constants in `server.js` | 15 min |
| Replace `getBlinkWallets` / `getBlinkTransactions` | 30 min |
| Replace all payment calls (8 locations) | 2–3 hours |
| Replace BTC/USD rate endpoint | 15 min |
| Update `setup.js` and `.env.example` | 30 min |
| Testing all payment flows | 2–3 hours |
| **Total** | **~1 day** |

---

## Notes

- BTCPayServer can run on a $6/month VPS — [see deployment options](https://docs.btcpayserver.org/Deployment/)
- [Voltage](https://voltage.cloud) offers managed BTCPayServer + Lightning node hosting if you don't want to self-host
- The SQLite migration (see `SQLITE_MIGRATION.md`) is independent of this migration — either can be done first
- After migrating, `BLINK_API_KEY` can be removed from `.env.example` and `setup.js`
- Consider keeping the `lnurl-pay` library even after migration — it's doing useful work resolving Lightning addresses

---

**Built with ⚡ Lightning Network technology for modern business payments in El Salvador.**
# Why Disrupt?

**Disrupt is a self-hosted business payment platform for teams that run on Bitcoin.** Payroll, supplier payments, tax withholding, and accountant-ready records — in one dashboard you own, on hardware you control.

## ⚡ Pay anyone, instantly
- **Lightning payments** to any Lightning address — money arrives in seconds, not banking days
- **On-chain Bitcoin** for larger payments, with confirmation tracking built in
- **Pay any invoice** — paste it or scan the QR code
- **Batch payments** — upload one CSV and pay your whole team at once

## ✅ Approvals, not chaos
- Anyone on the team can **draft** a payment; only a Manager or Admin can approve and send it
- Four roles — Admin, Manager, Bookkeeper, Employee — so everyone sees exactly what they should
- Attach receipt photos or PDFs directly to payment requests
- Every payment records its Lightning preimage: cryptographic proof it was paid

## 🧾 Tax withholding on autopilot
- Set your rates once — employee deduction, employer contribution, contractor withholding (El Salvador defaults built in, but any jurisdiction works)
- When you pay an employee, the net goes to them and the withheld amount goes **automatically to your tax authority's Lightning address in the same flow**
- Every withholding is recorded per transaction — no spreadsheet reconciliation

## 📊 Books your accountant will actually accept
- **Transaction categories** for clean bookkeeping
- **Fiat value captured at the moment of payment** — no guessing what the sats were worth later
- Reports and full history export to CSV or JSON
- Per-recipient analytics: totals, averages, tax withheld, monthly trends, Lightning-vs-on-chain breakdown

## 🔐 Yours, completely
- **Self-hosted** — your database lives on your own hardware (one-click install on Start9): users, roles, payment drafts, approvals, receipts, categories, and notes never touch anyone else's cloud
- **Access from anywhere via Tor Browser** — your team logs in remotely over Tor with no port forwarding, no VPN, no exposed public IP; the portal simply isn't visible to anyone who doesn't have your private .onion address
- Your own Lightning wallet, your own database, zero shared infrastructure
- **No subscription, no per-payment fees, no user limits** — open source
- Hardened auth: JWT with refresh rotation, role-gated routes, validated inputs

> **Honest scope:** payments are executed through your own [Blink](https://blink.sv) wallet, so Blink — like any wallet provider — has a record of your wallet's transactions (amounts, dates, counterpart addresses). What stays exclusively on your server is everything around the payment: who requested it, who approved it, receipts, categories, tax breakdowns, and notes. If full payment-rail sovereignty matters to you, that's a wallet-level choice, not something any dashboard can change.

## 💸 What it replaces
| Instead of… | You get… |
|---|---|
| $25–50 wire fees | Fractions of a cent |
| 3–5 day settlement | Seconds |
| Manual tax calculations | Automatic split at payment time |
| A SaaS holding your financial data | Your own server |

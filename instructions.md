# Disrupt Portal — Setup

## 1. Configure

Open the **Config** tab and enter:

- **Admin Name / Email / Password** (required) — your admin account is created automatically on first start with these credentials.
- **Blink API Key** (required) — create one at [blink.sv](https://blink.sv) under API keys. This is the wallet that sends all payments.
- **Tax rates** — defaults match El Salvador (10.25% employee, 16.25% employer, 10% contractor). Set all to 0 if you don't withhold taxes.
- **Tax Lightning Address** — where withheld amounts are sent automatically.
- **Email settings** (optional) — only needed for password-reset emails.

Save and start the service.

## 2. Log in

Launch the web UI from the service page and log in with the admin email and password you set in Config.

## 3. Add your team

Go to **Team** to add employees, managers, and bookkeepers — or bulk-import from CSV. Add suppliers the same way.

## 4. Pay people

- **Direct payments** — Lightning address, on-chain address, or paste any Lightning invoice
- **Drafts** — employees submit payment requests, managers/admins approve
- **Batch** — upload a CSV to pay many recipients at once

## Notes

- Your Blink wallet balance is shown under **Accounting** — payments fail if the wallet is empty.
- All data stays on your server. Back up regularly via StartOS backups.
- Withheld taxes are sent in the same flow as the payment, to the configured tax address, with everything recorded per transaction.

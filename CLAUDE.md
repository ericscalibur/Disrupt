# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# First-time setup (creates Admin user, JWT secrets, initializes data files)
npm run setup

# Run in development mode (verbose logging)
npm run dev

# Run in production mode
npm start
```

No test or lint infrastructure is configured.

## Architecture

**Disrupt Portal** is a Lightning Network-enabled business payment platform for small teams. It uses Node.js/Express with a vanilla JS single-page frontend. All data is persisted in JSON files under `disrupt-portal/data/`.

### Key files
- `disrupt-portal/server.js` — Monolithic Express server (~2,600 lines). All API routes, business logic, and Blink API integration live here.
- `disrupt-portal/public/script.js` — All frontend JS (~5,000 lines). Manages UI state, token lifecycle, and API calls.
- `disrupt-portal/public/index.html` — SPA shell with all modal markup.

### Auth & RBAC
JWT access + refresh tokens. Roles: `Admin`, `Manager`, `Bookkeeper`, `Employee`. Two Express middleware functions gate all routes: `authenticateToken` and `authorizeRoles(...)`.

### Payment workflow
1. Any user creates a **draft** (payment request to a team member, supplier, or address).
2. A Manager or Admin **approves** the draft, which triggers the Blink API GraphQL call to execute the Lightning payment.
3. The transaction is recorded locally in `transactions.json` with the Lightning preimage as proof of payment.

### Blink API
All Lightning operations (send payment, check balance, get BTC/USD rate) go through Blink's GraphQL API via the `@blinkpay/sdk` package. The API key is set in `.env` as `BLINK_API_KEY`.

### El Salvador tax withholding
When paying employees, the server automatically calculates and sends a separate tax payment to `TAX_LIGHTNING_ADDRESS`:
- Employee deductions: ISSS 3% + AFP 7.25% = 10.25%
- Employer contributions: ISSS 7.5% + AFP 8.75% = 16.25%
- Total withholding: 26.5%

### Environment variables (`.env`)
| Variable | Purpose |
|---|---|
| `ACCESS_TOKEN_SECRET` | JWT signing secret |
| `REFRESH_TOKEN_SECRET` | Refresh token signing secret |
| `BLINK_API_KEY` | Blink Lightning wallet API key |
| `TAX_LIGHTNING_ADDRESS` | Lightning address for tax payments |
| `PORT` | Server port (default 3000) |
| `NODE_ENV` | `development` or `production` |
| `EMAIL_*` | Optional SMTP config for password reset |

# Disrupt Portal — Production Roadmap

Phases are ordered by risk reduction. Do not skip Phase 1 before handling real money.

---

## Phase 1 — Data Integrity (blocker)

The JSON file store is the single biggest production risk. Concurrent writes, mid-crash corruption, and no audit trail are unacceptable for financial data.

**Tasks**
- [ ] Migrate to SQLite via `better-sqlite3` (same zero-infra deployment, ACID transactions, battle-tested)
  - Tables: `users`, `transactions`, `drafts`, `refresh_tokens`
  - Write a one-shot migration script that imports existing JSON data
- [ ] Wrap draft approval in a single SQLite transaction: deduct, record payment, mark draft done — or roll back entirely
- [ ] Add an append-only `audit_log` table (who did what, when, to whom, amount) — never delete rows
- [ ] Replace in-memory refresh token blacklist with a `revoked_tokens` table so restarts don't log everyone out

**Done when:** a server crash mid-payment leaves the database consistent and the audit log intact.

---

## Phase 2 — Security Hardening

- [ ] Add `helmet` middleware (sets CSP, HSTS, X-Frame-Options, etc. in one line)
- [ ] Enforce HTTPS in production (`NODE_ENV=production` → redirect HTTP, set secure cookie flags)
- [ ] Server-side input validation on all POST/PUT routes (use `zod` or `express-validator`) — the frontend validates UX, the server must validate correctness
- [ ] Rate-limit login and password-reset routes specifically (stricter than global limit already in place)
- [ ] Audit all routes for missing `authorizeRoles` guards — any route that touches money or user data must be gated
- [ ] Run `npm audit` and resolve high/critical CVEs before launch
- [ ] Store `BLINK_API_KEY` and JWT secrets in environment only — add a startup check that refuses to boot if secrets are missing or are example values

**Done when:** OWASP Top 10 checklist passes for this threat model.

---

## Phase 3 — Reliability & Payment Safety

- [ ] Idempotency on payment execution: before sending via Blink, check if a payment with the same draft ID was already recorded (prevents double-spend on retry)
- [ ] Handle Blink API timeouts gracefully — if the HTTP call times out, mark draft as `pending_confirmation` rather than failed, and surface it in the UI for manual review
- [ ] Tax payment failure handling: if the main payment succeeds but the tax payment fails, record both events in audit log and alert Admin — don't silently swallow it
- [ ] Nightly SQLite backup script (`.backup` API) — copy to a separate directory or S3-compatible bucket
- [ ] Health check endpoint (`GET /healthz`) that checks DB connectivity and Blink API reachability

**Done when:** no payment can be lost or double-sent due to network or process failure.

---

## Phase 4 — Testing

No tests exist today. This makes every change to financial logic a gamble.

- [ ] Unit tests for pure business logic:
  - Tax withholding calculations (ISSS + AFP, both employee and employer sides)
  - Role authorization rules
  - JWT generation and validation
- [ ] Integration tests for critical API routes using `supertest`:
  - Login flow
  - Draft creation → approval → payment recorded
  - Unauthorized access returns 403
- [ ] Add a `npm test` script (Jest or Node's built-in test runner)
- [ ] CI: GitHub Actions workflow that runs tests on every push to `main`

**Done when:** the tax math and payment flow have test coverage and a broken change fails CI before it ships.

---

## Phase 5 — Observability

- [ ] Structured logging with `pino` — replace `console.log` calls with log levels (info, warn, error) and JSON output
- [ ] Log every payment attempt (draft ID, amount, recipient, success/failure, Blink response) at INFO level
- [ ] Log every auth event (login, logout, failed attempt, token refresh) at INFO level
- [ ] Error alerting: on uncaught exceptions or unhandled rejections, log to file and optionally send email/webhook notification to Admin
- [ ] Expose basic metrics endpoint or integrate with a simple uptime monitor (UptimeRobot is free)

**Done when:** you can reconstruct exactly what happened around any payment from logs alone.

---

## Phase 6 — Code Architecture

The monolithic files won't block launch but will slow every future change. Refactor after Phase 1–3 are stable.

- [ ] Split `server.js` into route modules: `routes/auth.js`, `routes/users.js`, `routes/drafts.js`, `routes/payments.js`, `routes/admin.js`
- [ ] Extract business logic from route handlers into a `services/` layer (e.g., `services/payment.js`, `services/tax.js`) — makes unit testing possible
- [ ] Split `script.js` into feature modules with a simple bundler (`esbuild`) — or at minimum separate files loaded in order
- [ ] Add JSDoc types to service functions so editors can provide autocomplete and catch obvious mistakes

**Done when:** a new developer can find where to make a change without reading 2,600 lines.

---

## Phase 7 — Deployment & Operations

- [ ] Write a `Dockerfile` (Node 20 Alpine, non-root user, health check)
- [ ] `docker-compose.yml` for local development with volume-mounted data directory
- [ ] Document exact production deployment steps: reverse proxy (nginx/Caddy) → HTTPS → Node process managed by `pm2` or systemd
- [ ] Environment variable documentation — every variable, what it does, example values (no real secrets)
- [ ] Graceful shutdown: on `SIGTERM`, stop accepting new requests and finish in-flight ones before exit
- [ ] Document backup restore procedure and test it

**Done when:** a fresh server can be provisioned and running in under 30 minutes from the README.

---

## Phase 8 — UX & Feature Completeness

Nice-to-have polish that makes it a real product vs. an internal tool.

- [ ] Email notifications: draft submitted → notify approvers; payment sent → notify recipient
- [ ] Password reset flow (SMTP config already exists, just needs the frontend and server route)
- [ ] Transaction export: CSV download of transactions filtered by date range
- [ ] Bulk payment status: real-time progress bar when running batch CSV payments
- [ ] Mobile-responsive layout audit
- [ ] Session timeout warning (show "you'll be logged out in 2 minutes" before JWT expires)

---

## Summary Priority Order

| Phase | Risk addressed | Effort |
|---|---|---|
| 1 — SQLite migration | Data loss / corruption | High |
| 2 — Security hardening | Unauthorized access, injection | Medium |
| 3 — Payment reliability | Double-spend, lost payments | Medium |
| 4 — Testing | Regression in financial logic | Medium |
| 5 — Observability | Blind to failures in production | Low |
| 6 — Architecture | Developer velocity | Medium |
| 7 — Deployment | Reproducible, recoverable infra | Low |
| 8 — UX polish | User adoption | Low–Medium |

# Receipt Photo Upload — Implementation Roadmap

Feature: employees upload receipt photos when creating reimbursement drafts. Managers view and verify the receipt before approving payment.

---

## Overview

**Flow:**
1. Employee creates a draft payment → uploads a receipt photo in the draft modal
2. Draft appears in Pending queue for manager/admin
3. Manager opens the draft, views the receipt photo, confirms the amount
4. Manager approves → sats sent to employee's Lightning address → receipt retained on the transaction record for accounting/audit

---

## Phase 1 — Backend: File Upload Infrastructure

### 1.1 Install multer
```bash
npm install multer
```
`multer` handles `multipart/form-data` requests and writes files to disk automatically.

### 1.2 Create uploads directory
```
disrupt-portal/uploads/receipts/
```
This directory must be outside `public/` — receipts are financial documents and should not be served as static files. Add it to `.gitignore`.

### 1.3 Configure multer middleware
Create `disrupt-portal/middleware/upload.js`:
- Accept: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`
- Max file size: 10 MB
- Filename: UUID-based (never use original filename — prevents path traversal and collisions)
- Example stored name: `a3f2c1d4-8b7e-4a2f-9c1d-2e3f4a5b6c7d.jpg`

### 1.4 Create receipts route
`POST /receipts` — authenticated, multer middleware applied
- Accepts multipart upload
- Saves file to `uploads/receipts/`
- Records metadata in new `receipts` table (see Phase 2)
- Returns `{ receiptId, filename }`

`GET /receipts/:id` — authenticated
- Looks up filename by `receiptId` in DB
- Streams file to client
- Returns 404 if not found, 403 if user is not authorized
- Never expose the raw filesystem path in the response

---

## Phase 2 — Database: Schema Changes

### 2.1 New `receipts` table
```sql
CREATE TABLE receipts (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  originalName TEXT,
  mimeType    TEXT,
  sizeBytes   INTEGER,
  uploadedBy  TEXT NOT NULL,
  uploadedAt  TEXT NOT NULL
);
```
Storing metadata here makes it easy to audit who uploaded what and when, independent of the draft or transaction it's attached to.

### 2.2 Add `receiptId` to `drafts` table
```sql
ALTER TABLE drafts ADD COLUMN receiptId TEXT REFERENCES receipts(id);
```

### 2.3 Add `receiptId` to `transactions` table
```sql
ALTER TABLE transactions ADD COLUMN receiptId TEXT REFERENCES receipts(id);
```
When a draft is approved, the `receiptId` carries over into the transaction insert. This is the permanent audit link — the receipt is retained on the transaction record indefinitely.

---

## Phase 3 — Backend: Wire Receipt into Draft Flow

### 3.1 Update draft creation route
`POST /drafts` already accepts JSON. The receipt upload is a **separate prior step** (two-step approach), so the draft creation endpoint stays JSON — just add `receiptId` as an optional field in the request body and the DB insert.

Update `validators.js` to allow optional `receiptId` string in the `createDraft` schema.

### 3.2 Update draft approval route
In the approve route (`POST /drafts/approve`), when building the `transaction` object to insert, include:
```js
receiptId: draft.receiptId || null,
```
This is already inside the atomic DB transaction at step 9, so it's safe — either both the draft update and transaction insert succeed, or neither does.

---

## Phase 4 — Frontend: Upload UI

### 4.1 Draft creation modal — add receipt upload section
Below the existing form fields, add:
- A file input (accept: `image/*,application/pdf`)
- An upload button that fires `POST /receipts` immediately on file selection (before form submit)
- A loading state while uploading
- On success: show a thumbnail preview (for images) or filename (for PDFs) with a remove button
- Store the returned `receiptId` in memory to include when submitting the draft

### 4.2 Validation feedback
- File too large (>10 MB): show inline error before uploading
- Wrong file type: show inline error before uploading
- Upload failed: show error with retry option
- Draft submission should be blocked if an upload is in progress

### 4.3 Pending drafts view — receipt indicator
In the draft list/cards shown to managers, add a small indicator (e.g. a paperclip icon or "Receipt attached") when `receiptId` is present. This signals at a glance that there's a document to review.

### 4.4 Draft detail view — receipt viewer
When a manager clicks a pending draft, the detail panel should:
- Show a "View Receipt" button if `receiptId` is present
- Clicking it opens the receipt in a modal lightbox (for images) or a new tab (for PDFs)
- Receipt is fetched via `GET /receipts/:id` — the authenticated route, not a direct file URL

### 4.5 Transaction history — receipt access
In the completed transactions view, add the same "View Receipt" link if `receiptId` is present on the transaction. This is the accounting/audit access path.

---

## Phase 5 — Security & Validation

- [ ] Validate MIME type server-side (don't trust the `Content-Type` header alone — read the file magic bytes using a library like `file-type`)
- [ ] Validate file size server-side (multer's `limits` option)
- [ ] UUID filenames only — never expose or use the user-supplied original filename on disk
- [ ] `GET /receipts/:id` must verify the requesting user is either the uploader or has Admin/Manager role
- [ ] Add `uploads/` to `.gitignore` so receipts are never committed
- [ ] Ensure `uploads/` directory is included in the SQLite backup routine (Phase 3 of main ROADMAP) — the DB and the files must be backed up together or the foreign key references become orphaned

---

## Phase 6 — Edge Cases & Polish

- [ ] **Orphaned receipts:** if a user uploads a receipt but abandons the draft modal without submitting, the file sits in uploads with no draft attached. Add a nightly cleanup job that deletes `receipts` rows (and their files) older than 24 hours where no draft references the `receiptId`.
- [ ] **Re-upload:** allow employee to remove and replace the receipt before the draft is submitted for approval. Removing should delete the file and the receipts row.
- [ ] **Declined drafts:** if a manager declines a draft, the receipt should be retained (not deleted) — it may be needed for a corrected resubmission or dispute resolution.
- [ ] **Large PDF support:** if PDFs are allowed, the viewer should open in a new tab rather than an inline modal, since PDF rendering in-browser varies.
- [ ] **Mobile:** the file input should work on mobile (camera capture for on-the-spot receipts). Consider adding `capture="environment"` to the file input for mobile users.

---

## Implementation Order

| Step | What | Why first |
|---|---|---|
| 1 | Install multer + create upload middleware | Everything else depends on this |
| 2 | Create `receipts` table + DB columns | Schema must exist before routes write to it |
| 3 | `POST /receipts` upload route | Needed before frontend can test |
| 4 | `GET /receipts/:id` serve route | Needed before frontend can display |
| 5 | Wire `receiptId` into draft create + approve routes | Connects upload to the payment flow |
| 6 | Frontend: upload UI in draft modal | Employee-facing entry point |
| 7 | Frontend: receipt viewer in pending draft detail | Manager-facing review step |
| 8 | Frontend: receipt link in transaction history | Audit access |
| 9 | Security hardening (magic byte validation, auth checks) | Before any real data |
| 10 | Orphan cleanup job | Polish |

---

## Files to Create or Modify

**New:**
- `disrupt-portal/middleware/upload.js` — multer config
- `disrupt-portal/routes/receipts.js` — upload + serve routes
- `disrupt-portal/uploads/receipts/` — storage directory (gitignored)

**Modified:**
- `disrupt-portal/db.js` — add receipts table creation, add columns to drafts + transactions
- `disrupt-portal/routes/drafts.js` — accept receiptId on create, carry it through on approve
- `disrupt-portal/validators.js` — add optional receiptId to createDraft schema
- `disrupt-portal/server.js` — register receipts router
- `disrupt-portal/public/` — frontend changes (modal, viewer, transaction history)
- `.gitignore` — add `disrupt-portal/uploads/`

"use strict";

/**
 * Batch payroll withholding, run through the real /api/batch-payment route with
 * Blink and LNURL stubbed, so no network calls are made and no money moves.
 */

// ── Environment must be set before any require() loads db.js or server.js ────
process.env.DISRUPT_DB_PATH       = ":memory:";
process.env.ACCESS_TOKEN_SECRET   = "test-access-secret-at-least-32-chars!!";
process.env.REFRESH_TOKEN_SECRET  = "test-refresh-secret-at-least-32-chars!";
process.env.BLINK_API_KEY         = "test-key";
process.env.NODE_ENV              = "test";
process.env.TAX_LIGHTNING_ADDRESS = "tax@test.sv";

const { describe, it, beforeEach, mock } = require("node:test");
const assert   = require("node:assert/strict");
const request  = require("supertest");
const jwt      = require("jsonwebtoken");
const axios    = require("axios");

const invoices = [];   // every invoice requested: { address, sats, invoice }
const paid = [];       // every invoice actually paid
let failTaxPayment = false;
let failTaxInvoice = false;

// lnurl-pay's exports can't be mocked in place, so swap the module before the
// server loads it.
const lnurlPath = require.resolve("lnurl-pay");
require.cache[lnurlPath] = {
  id: lnurlPath,
  filename: lnurlPath,
  loaded: true,
  exports: {
    requestInvoice: async ({ lnUrlOrAddress, tokens }) => {
      if (failTaxInvoice && lnUrlOrAddress === "tax@test.sv") throw new Error("tax address down");
      const invoice = `inv_${invoices.length}_${lnUrlOrAddress}`;
      invoices.push({ address: lnUrlOrAddress, sats: tokens, invoice });
      return { invoice };
    },
  },
};

const { app } = require("../disrupt-portal/server");
const db      = require("../disrupt-portal/db");

const adminToken = () =>
  jwt.sign({ id: "a", email: "a@x.com", role: "Admin", department: "Engineering" },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });

mock.method(axios, "post", async (_url, body) => {
  const { query, variables } = body;
  if (query.includes("wallets")) {
    return { data: { data: { me: { defaultAccount: { wallets: [{ id: "w1", walletCurrency: "BTC", balance: 1e9 }] } } } } };
  }
  if (query.includes("realtimePrice")) {
    return { data: { data: { realtimePrice: { btcSatPrice: { base: 100_000, offset: 3 } } } } };
  }
  if (query.includes("lnInvoicePaymentSend")) {
    const invoice = variables.input.paymentRequest;
    if (failTaxPayment && invoice.endsWith("tax@test.sv")) {
      return { data: { data: { lnInvoicePaymentSend: { status: "FAILED", errors: [{ message: "no route" }] } } } };
    }
    paid.push(invoice);
    return { data: { data: { lnInvoicePaymentSend: { status: "SUCCESS", errors: [] } } } };
  }
  throw new Error("Unexpected Blink query in test");
});

const sendBatch = (payments, extra = {}) =>
  request(app).post("/api/batch-payment")
    .set("Authorization", `Bearer ${adminToken()}`)
    .send({ payments, ...extra });

const paidTo = (address) =>
  invoices.filter((i) => i.address === address && paid.includes(i.invoice)).map((i) => i.sats);

const employee = { address: "ana@test.sv", amount: 10_000, name: "Ana", note: "salary", type: "employee" };

beforeEach(() => {
  invoices.length = 0;
  paid.length = 0;
  failTaxPayment = false;
  failTaxInvoice = false;
  db.prepare("DELETE FROM transactions").run();
});

describe("POST /api/batch-payment — withholding", () => {
  it("pays the employee net and remits both shares of the tax", async () => {
    const res = await sendBatch([employee]);
    assert.equal(res.status, 200);
    assert.equal(res.body.paymentStatuses[0].status, "Success");
    assert.deepEqual(paidTo("ana@test.sv"), [8_975]);
    assert.deepEqual(paidTo("tax@test.sv"), [2_650]);
  });

  it("withholds the contractor rate from a contractor row", async () => {
    await sendBatch([{ ...employee, address: "bo@test.sv", name: "Bo", type: "contractor" }]);
    assert.deepEqual(paidTo("bo@test.sv"), [9_000]);
    assert.deepEqual(paidTo("tax@test.sv"), [1_000]);
  });

  it("pays the full amount and sends no tax for none, or a missing type", async () => {
    await sendBatch([
      { address: "sup@test.sv", amount: 5_000, name: "Supplier", type: "none" },
      { address: "old@test.sv", amount: 6_000, name: "Old CSV" },
    ]);
    assert.deepEqual(paidTo("sup@test.sv"), [5_000]);
    assert.deepEqual(paidTo("old@test.sv"), [6_000]);
    assert.deepEqual(paidTo("tax@test.sv"), []);
  });

  it("records the row as payroll with its withholding, plus a linked tax record", async () => {
    await sendBatch([employee]);
    const pay = db.prepare("SELECT * FROM transactions WHERE type = 'batch'").get();
    assert.equal(pay.recipientType, "employee");
    assert.equal(pay.categoryId, "cat_payroll");
    assert.equal(pay.amount, 8_975);
    assert.deepEqual(JSON.parse(pay.taxWithholding), { originalAmount: 10_000, taxAmount: 2_650, netAmount: 8_975 });

    const tax = db.prepare("SELECT * FROM transactions WHERE type = 'tax_withholding'").get();
    assert.equal(tax.amount, 2_650);
    assert.equal(tax.taxType, "employee");
    assert.equal(tax.categoryId, "cat_tax");
  });

  it("keeps every tax record in a multi-row batch", async () => {
    await sendBatch([employee, { ...employee, address: "cy@test.sv", name: "Cy" }, { ...employee, address: "di@test.sv", name: "Di" }]);
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE type = 'tax_withholding'").get();
    assert.equal(n, 3);
  });

  it("flags a row when the employee is paid but the tax payment fails", async () => {
    failTaxPayment = true;
    const res = await sendBatch([employee]);
    const row = res.body.paymentStatuses[0];
    assert.equal(row.status, "Success");
    assert.equal(row.taxPaymentFailed, true);
    assert.match(row.error, /FAILED/);

    const pay = db.prepare("SELECT * FROM transactions WHERE type = 'batch'").get();
    assert.equal(pay.taxPaymentFailed, 1);
    assert.equal(db.prepare("SELECT 1 FROM transactions WHERE type = 'tax_withholding'").get(), undefined);
  });

  it("does not pay the employee when the tax invoice can't be resolved", async () => {
    failTaxInvoice = true;
    const res = await sendBatch([employee]);
    assert.equal(res.body.paymentStatuses[0].status, "Failed");
    assert.deepEqual(paid, []);
  });

  it("refuses the whole batch before paying anyone if a withheld row can't be withheld", async () => {
    const key = "batch-tax-reject-1";
    const res = await sendBatch([
      employee,
      { address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", amount: 10_000, name: "Chain", type: "employee" },
      { address: "lnbc1fakeinvoice", amount: 10_000, name: "Invoice", type: "contractor" },
    ], { idempotencyKey: key });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Chain, Invoice/);
    assert.deepEqual(paid, []);
    assert.equal(db.prepare("SELECT 1 FROM processed_payments WHERE idempotencyKey = ?").get(key), undefined);
  });

  it("rejects an unknown type instead of paying it without withholding", async () => {
    const res = await sendBatch([{ ...employee, type: "employe" }]);
    assert.equal(res.status, 400);
    assert.deepEqual(paid, []);
  });
});

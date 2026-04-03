"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  EMPLOYEE_RATE,
  CONTRACTOR_RATE,
  calcEmployeeTax,
  calcContractorTax,
  validateTaxWithholding,
} = require("../disrupt-portal/tax");

// ── calcEmployeeTax ───────────────────────────────────────────────────────────

describe("calcEmployeeTax", () => {
  it("rate constant is 26.5%", () => {
    assert.equal(EMPLOYEE_RATE, 0.265);
  });

  it("taxSats + netSats always equals grossSats", () => {
    for (const gross of [1, 7, 99, 1_000, 10_000, 99_999, 1_000_000]) {
      const { taxSats, netSats } = calcEmployeeTax(gross);
      assert.equal(taxSats + netSats, gross, `conservation failed for gross=${gross}`);
    }
  });

  it("floors fractional sats — remainder stays with employee", () => {
    // 1 sat × 0.265 = 0.265 → floor → 0 tax, employee keeps 1
    const { taxSats, netSats } = calcEmployeeTax(1);
    assert.equal(taxSats, 0);
    assert.equal(netSats, 1);
  });

  it("correct result for 10,000 sats", () => {
    const { taxSats, netSats } = calcEmployeeTax(10_000);
    assert.equal(taxSats, 2_650);
    assert.equal(netSats, 7_350);
  });

  it("correct result for 100,000 sats", () => {
    const { taxSats } = calcEmployeeTax(100_000);
    assert.equal(taxSats, 26_500);
  });

  it("floors correctly when gross × rate is not an integer", () => {
    // 1001 × 0.265 = 265.265 → floor = 265
    const { taxSats } = calcEmployeeTax(1_001);
    assert.equal(taxSats, 265);
  });
});

// ── calcContractorTax ─────────────────────────────────────────────────────────

describe("calcContractorTax", () => {
  it("rate constant is 10%", () => {
    assert.equal(CONTRACTOR_RATE, 0.10);
  });

  it("taxSats + netSats always equals grossSats", () => {
    for (const gross of [1, 7, 99, 1_000, 10_000, 99_999, 1_000_000]) {
      const { taxSats, netSats } = calcContractorTax(gross);
      assert.equal(taxSats + netSats, gross, `conservation failed for gross=${gross}`);
    }
  });

  it("floors fractional sats", () => {
    // 7 × 0.10 = 0.7 → floor = 0
    const { taxSats, netSats } = calcContractorTax(7);
    assert.equal(taxSats, 0);
    assert.equal(netSats, 7);
  });

  it("correct result for 10,000 sats", () => {
    const { taxSats, netSats } = calcContractorTax(10_000);
    assert.equal(taxSats, 1_000);
    assert.equal(netSats, 9_000);
  });

  it("employee tax is always higher than contractor tax for same gross", () => {
    for (const gross of [100, 1_000, 50_000]) {
      const emp = calcEmployeeTax(gross);
      const con = calcContractorTax(gross);
      assert.ok(emp.taxSats >= con.taxSats, `employee tax should be >= contractor tax for gross=${gross}`);
    }
  });
});

// ── validateTaxWithholding ────────────────────────────────────────────────────

describe("validateTaxWithholding", () => {
  it("returns null for null input", () => {
    assert.equal(validateTaxWithholding(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(validateTaxWithholding(undefined), null);
  });

  it("returns null when applied is false", () => {
    assert.equal(validateTaxWithholding({ applied: false }), null);
  });

  it("returns error when originalAmount is missing", () => {
    const result = validateTaxWithholding({ applied: true, type: "employee" });
    assert.ok(typeof result === "string");
    assert.ok(result.includes("originalAmount"));
  });

  it("returns null for correct employee withholding", () => {
    const gross = 10_000;
    const { taxSats, netSats } = calcEmployeeTax(gross);
    const tw = { applied: true, type: "employee", originalAmount: gross, taxAmount: taxSats, netAmount: netSats };
    assert.equal(validateTaxWithholding(tw), null);
  });

  it("returns null for correct contractor withholding", () => {
    const gross = 5_000;
    const { taxSats, netSats } = calcContractorTax(gross);
    const tw = { applied: true, type: "contractor", originalAmount: gross, taxAmount: taxSats, netAmount: netSats };
    assert.equal(validateTaxWithholding(tw), null);
  });

  it("returns error string when taxAmount is tampered", () => {
    const gross = 10_000;
    const { netSats } = calcEmployeeTax(gross);
    const tw = { applied: true, type: "employee", originalAmount: gross, taxAmount: 1, netAmount: netSats };
    const err = validateTaxWithholding(tw);
    assert.ok(typeof err === "string");
    assert.ok(err.includes("taxAmount mismatch"));
  });

  it("returns error string when netAmount is tampered", () => {
    const gross = 10_000;
    const { taxSats } = calcEmployeeTax(gross);
    const tw = { applied: true, type: "employee", originalAmount: gross, taxAmount: taxSats, netAmount: gross };
    const err = validateTaxWithholding(tw);
    assert.ok(typeof err === "string");
    assert.ok(err.includes("netAmount mismatch"));
  });

  it("defaults to employee rate when type is missing", () => {
    const gross = 10_000;
    const { taxSats, netSats } = calcEmployeeTax(gross);
    const tw = { applied: true, originalAmount: gross, taxAmount: taxSats, netAmount: netSats };
    assert.equal(validateTaxWithholding(tw), null);
  });
});

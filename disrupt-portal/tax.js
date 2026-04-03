"use strict";

/**
 * El Salvador payroll tax calculations.
 *
 * Employee side (withheld from employee):  ISSS 3.00% + AFP 7.25% = 10.25%
 * Employer side (borne by employer):       ISSS 7.50% + AFP 8.75% = 16.25%
 * Total flow to tax authority:                                      26.50%
 *
 * Contractor payments use a flat 10% withholding rate.
 *
 * All amounts are in satoshis. Math.floor() is used throughout because
 * satoshis are indivisible — fractional amounts always go to the recipient.
 */

const EMPLOYEE_RATE   = 0.265; // 26.5 %
const CONTRACTOR_RATE = 0.10;  // 10.0 %

/**
 * Calculate employee withholding for a gross payment.
 * @param {number} grossSats
 * @returns {{ taxSats: number, netSats: number, rate: number }}
 */
function calcEmployeeTax(grossSats) {
  const taxSats = Math.floor(grossSats * EMPLOYEE_RATE);
  return { taxSats, netSats: grossSats - taxSats, rate: EMPLOYEE_RATE };
}

/**
 * Calculate contractor withholding for a gross payment.
 * @param {number} grossSats
 * @returns {{ taxSats: number, netSats: number, rate: number }}
 */
function calcContractorTax(grossSats) {
  const taxSats = Math.floor(grossSats * CONTRACTOR_RATE);
  return { taxSats, netSats: grossSats - taxSats, rate: CONTRACTOR_RATE };
}

/**
 * Validate that a client-submitted taxWithholding object matches the
 * server-computed values for the given gross amount.
 *
 * Returns null when valid, or an error string describing the mismatch.
 *
 * @param {object|null|undefined} tw - taxWithholding from the request body
 * @returns {string|null}
 */
function validateTaxWithholding(tw) {
  if (!tw || !tw.applied) return null;

  if (typeof tw.originalAmount !== "number" || tw.originalAmount <= 0) {
    return "taxWithholding.originalAmount must be a positive number";
  }

  const calc =
    tw.type === "contractor"
      ? calcContractorTax(tw.originalAmount)
      : calcEmployeeTax(tw.originalAmount);

  if (tw.taxAmount !== calc.taxSats) {
    return `taxWithholding.taxAmount mismatch: client sent ${tw.taxAmount}, expected ${calc.taxSats}`;
  }
  if (tw.netAmount !== calc.netSats) {
    return `taxWithholding.netAmount mismatch: client sent ${tw.netAmount}, expected ${calc.netSats}`;
  }

  return null;
}

module.exports = {
  EMPLOYEE_RATE,
  CONTRACTOR_RATE,
  calcEmployeeTax,
  calcContractorTax,
  validateTaxWithholding,
};

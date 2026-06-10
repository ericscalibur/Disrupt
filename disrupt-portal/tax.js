"use strict";

/**
 * Configurable payroll tax calculations.
 *
 * Rates are set during setup and stored in .env. Defaults match El Salvador:
 *   Employee deduction (withheld from employee): 10.25%
 *   Employer contribution (extra employer cost):  16.25%
 *   Total to tax authority:                       26.50%
 *   Contractor withholding:                       10.00%
 *
 * All amounts are in satoshis. Math.floor() is used throughout because
 * satoshis are indivisible — fractional amounts always go to the recipient.
 */

const EMPLOYEE_DEDUCTION_RATE    = parseFloat(process.env.EMPLOYEE_DEDUCTION_RATE    ?? "10.25") / 100;
const EMPLOYER_CONTRIBUTION_RATE = parseFloat(process.env.EMPLOYER_CONTRIBUTION_RATE ?? "16.25") / 100;
const EMPLOYEE_RATE              = EMPLOYEE_DEDUCTION_RATE + EMPLOYER_CONTRIBUTION_RATE;
const CONTRACTOR_RATE            = parseFloat(process.env.CONTRACTOR_WITHHOLDING_RATE ?? "10")    / 100;

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
  EMPLOYEE_DEDUCTION_RATE,
  EMPLOYER_CONTRIBUTION_RATE,
  EMPLOYEE_RATE,
  CONTRACTOR_RATE,
  calcEmployeeTax,
  calcContractorTax,
  validateTaxWithholding,
};

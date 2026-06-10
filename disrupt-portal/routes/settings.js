"use strict";

const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const {
  EMPLOYEE_DEDUCTION_RATE,
  EMPLOYER_CONTRIBUTION_RATE,
  CONTRACTOR_RATE,
} = require("../tax");

router.get("/settings/tax-rates", authenticateToken, (req, res) => {
  res.json({
    success: true,
    employeeDeductionRate:    parseFloat((EMPLOYEE_DEDUCTION_RATE    * 100).toFixed(4)),
    employerContributionRate: parseFloat((EMPLOYER_CONTRIBUTION_RATE * 100).toFixed(4)),
    contractorWithholdingRate: parseFloat((CONTRACTOR_RATE           * 100).toFixed(4)),
  });
});

module.exports = router;

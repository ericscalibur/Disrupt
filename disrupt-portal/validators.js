"use strict";

const { z } = require("zod");

// ── Reusable primitives ───────────────────────────────────────────────────────
const email = z.string().email().max(254);
const nonEmpty = (max = 255) => z.string().min(1).max(max).trim();
const positiveSats = z.number().int().positive();
const lnAddress = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^@\s]+@[^@\s]+$/, "Must be a Lightning address (user@domain)");
const btcAddress = z
  .string()
  .max(128)
  .regex(
    /^(bc1[a-z0-9]{6,87}|[13][a-zA-HJ-NP-Z0-9]{25,34})$/,
    "Must be a valid Bitcoin address (bc1..., 1..., or 3...)"
  );

// ── Schemas ───────────────────────────────────────────────────────────────────
const schemas = {
  login: z.object({
    email: email,
    password: z.string().min(1).max(128),
  }),

  addUser: z.object({
    action: z.enum(["add", "remove"]).optional(),
    name: nonEmpty().optional(),
    email: email,
    role: z.enum(["Admin", "Manager", "Bookkeeper", "Employee"]).optional(),
    department: nonEmpty().optional(),
    lightningAddress: lnAddress.optional().or(z.literal("")).optional(),
    btcAddress: btcAddress.optional().or(z.literal("")).optional(),
  }),

  editUser: z.object({
    name: nonEmpty().optional(),
    role: z.enum(["Admin", "Manager", "Bookkeeper", "Employee"]).optional(),
    department: nonEmpty().optional(),
    lightningAddress: lnAddress.optional().or(z.literal("")).optional(),
    btcAddress: btcAddress.optional().or(z.literal("")).optional(),
  }),

  addDepartment: z.object({
    department: nonEmpty(100),
  }),

  deleteDepartment: z.object({
    department: nonEmpty(100),
    confirmDelete: z.boolean().optional(),
  }),

  createDraft: z.object({
    title: z.string().max(255).optional(),
    recipientEmail: email,
    company: nonEmpty(),
    contact: nonEmpty(),
    recipientLightningAddress: lnAddress,
    amount: z.number().int().positive(),
    note: z.string().max(1000).optional(),
    receiptId: z.string().uuid().optional(),
  }),

  approveDraft: z.object({
    draftId: nonEmpty(128),
  }),

  declineDraft: z.object({
    draftId: nonEmpty(128),
  }),

  forgotPassword: z.object({
    email: email,
  }),

  addSupplier: z.object({
    company: nonEmpty(),
    contact: nonEmpty(),
    email: email,
    lightningAddress: lnAddress.optional().or(z.literal("")).optional(),
    btcAddress: btcAddress.optional().or(z.literal("")).optional(),
    note: z.string().max(1000).optional(),
  }).refine(
    (d) => (d.lightningAddress && d.lightningAddress.trim()) || (d.btcAddress && d.btcAddress.trim()),
    { message: "At least one payment address (Lightning or Bitcoin) is required." }
  ),

  editSupplier: z.object({
    company: nonEmpty().optional(),
    contact: nonEmpty().optional(),
    email: email.optional(),
    lightningAddress: lnAddress.optional().or(z.literal("")).optional(),
    btcAddress: btcAddress.optional().or(z.literal("")).optional(),
    note: z.string().max(1000).optional(),
  }),

  pay: z.object({
    recipientType: z.enum(["employee", "supplier"]),
    recipientId: nonEmpty(512),
    contact: nonEmpty(),
    company: nonEmpty(),
    email: email.optional(),
    lightningAddress: lnAddress.optional().or(z.literal("")).optional(),
    btcAddress: btcAddress.optional().or(z.literal("")).optional(),
    paymentRail: z.enum(["lightning", "onchain"]).optional(),
    paymentAmount: z.number().positive(),
    paymentNote: z.string().max(1000).optional(),
    taxWithholding: z
      .object({
        applied: z.boolean(),
        originalAmount: z.number().positive(),
        netAmount: z.number().positive(),
        taxAmount: z.number().nonnegative(),
        type: z.string().optional(),
      })
      .optional(),
    btcUsdRate: z.number().positive().optional(),
  }).refine(
    (d) => (d.paymentRail === "onchain") ? !!d.btcAddress : !!d.lightningAddress,
    { message: "A payment address is required for the selected rail." }
  ),

  payInvoice: z.object({
    invoice: z.string().min(1).max(4096),
    note: z.string().max(1000).optional(),
    receiverName: z.string().max(255).optional(),
    lightningAddress: lnAddress.optional().or(z.literal("")).optional(),
    btcUsdRate: z.number().positive().optional(),
  }),

  batchPayment: z.object({
    payments: z
      .array(
        z.object({
          address: z.string().min(1).max(512),
          amount: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int().positive()),
          name: z.string().max(255).optional(),
          note: z.string().max(1000).optional(),
        }),
      )
      .min(1)
      .max(500),
  }),

  decodeInvoice: z.object({
    invoice: z.string().min(1).max(4096),
  }),

  sendTransaction: z.object({
    recipient: lnAddress,
    amountSats: z.union([z.string(), z.number()]).transform(Number).pipe(positiveSats),
    memo: z.string().max(1000).optional(),
  }),
};

// ── Middleware factory ────────────────────────────────────────────────────────
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid request data.",
        errors: result.error.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    req.body = result.data; // replace with coerced/trimmed values
    next();
  };
}

module.exports = { schemas, validate };

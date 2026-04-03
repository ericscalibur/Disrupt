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
  }),

  editUser: z.object({
    name: nonEmpty().optional(),
    role: z.enum(["Admin", "Manager", "Bookkeeper", "Employee"]).optional(),
    department: nonEmpty().optional(),
    lightningAddress: lnAddress.optional().or(z.literal("")).optional(),
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
    amount: z.number().positive(),
    note: z.string().max(1000).optional(),
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
    lightningAddress: lnAddress,
    note: z.string().max(1000).optional(),
  }),

  editSupplier: z.object({
    company: nonEmpty().optional(),
    contact: nonEmpty().optional(),
    email: email.optional(),
    lightningAddress: lnAddress.optional(),
    note: z.string().max(1000).optional(),
  }),

  pay: z.object({
    recipientType: z.enum(["employee", "supplier"]),
    recipientId: nonEmpty(512),
    contact: nonEmpty(),
    company: nonEmpty(),
    email: email.optional(),
    lightningAddress: lnAddress,
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
  }),

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
          lightningAddress: lnAddress,
          amount: z.union([z.string(), z.number()]).transform(Number),
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

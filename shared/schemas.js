/**
 * Canonical Zod schemas for LedgerGuard's API contracts.
 *
 * In a real monorepo these would live in an installable workspace package
 * (e.g. @ledgerguard/shared) consumed by every service, and OpenAPI docs
 * would be generated from them directly. For this portfolio project's Docker
 * Compose setup (each service = independent build context), the same
 * schema definitions are copied into each service's src/schemas folder so
 * every service can be built and deployed independently without a shared
 * package registry. This file is the single source of truth to copy from -
 * if you change a contract, change it here first, then sync it out.
 */
const { z } = require("zod");

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
  role: z.enum(["admin", "analyst", "customer"]).optional().default("customer"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createTransactionSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1).max(128),
  // raw Kaggle feature vector: Time, V1..V28, Amount - anonymized PCA components
  sourceFeatures: z.record(z.string(), z.number()).default({}),
});

module.exports = { registerSchema, loginSchema, createTransactionSchema };

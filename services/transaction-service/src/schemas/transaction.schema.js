const { z } = require("zod");

// Contract note: sourceFeatures carries the raw Kaggle dataset row
// (Time, V1..V28, Amount - PCA-anonymized) so the fraud pipeline has
// something to score. In a real bank this would instead be device,
// merchant, and geolocation metadata - see design doc section 2.
const createTransactionSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1).max(128),
  sourceFeatures: z.record(z.string(), z.number()).default({}),
});

module.exports = { createTransactionSchema };

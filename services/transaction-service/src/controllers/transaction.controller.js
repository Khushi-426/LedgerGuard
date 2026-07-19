const service = require("../services/transaction.service");
const { createTransactionSchema } = require("../schemas/transaction.schema");

async function create(req, res, next) {
  try {
    const parsed = createTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const transaction = await service.createTransaction(parsed.data);
    res.status(201).json({ transaction });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const transaction = await service.getTransaction(req.params.id);
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const { status, limit, offset } = req.query;
    const transactions = await service.listTransactions({
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json({ transactions });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, getById, list };

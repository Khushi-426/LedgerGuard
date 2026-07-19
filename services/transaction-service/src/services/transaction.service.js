const repository = require("../repositories/transaction.repository");
const { publishTransactionCreated } = require("../kafka/producer");

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

async function createTransaction(input) {
  // Idempotency guard: a client (or the replay simulator) retrying the same
  // request must not create a duplicate transaction. This is a real payments
  // requirement, not incidental - see design doc section 9.
  const existing = await repository.findByIdempotencyKey(input.idempotencyKey);
  if (existing) return existing;

  const transaction = await repository.create(input);

  // Publish after commit, not before: we never want an event in the log for
  // a transaction that didn't actually get persisted.
  await publishTransactionCreated(transaction);

  return transaction;
}

async function getTransaction(id) {
  const transaction = await repository.findById(id);
  if (!transaction) {
    const err = new Error("transaction not found");
    err.status = 404;
    throw err;
  }
  return transaction;
}

async function listTransactions(query) {
  return repository.list(query);
}

module.exports = { createTransaction, getTransaction, listTransactions, ValidationError };

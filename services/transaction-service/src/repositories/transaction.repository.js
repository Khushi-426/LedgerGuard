const { pool } = require("../db");

async function findByIdempotencyKey(idempotencyKey) {
  const { rows } = await pool.query(
    "SELECT * FROM transactions WHERE idempotency_key = $1",
    [idempotencyKey]
  );
  return rows[0] || null;
}

async function create({ accountId, amount, currency, occurredAt, idempotencyKey, sourceFeatures }) {
  const { rows } = await pool.query(
    `INSERT INTO transactions
       (account_id, amount, currency, occurred_at, idempotency_key, source_features, status)
     VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6, 'PENDING')
     RETURNING *`,
    [accountId, amount, currency, occurredAt || null, idempotencyKey, sourceFeatures]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM transactions WHERE id = $1", [id]);
  return rows[0] || null;
}

async function list({ status, limit = 50, offset = 0 }) {
  const clauses = [];
  const params = [];
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT * FROM transactions ${where}
     ORDER BY occurred_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

module.exports = { findByIdempotencyKey, create, findById, list };

const { Router } = require("express");
const { pool } = require("../db");

const router = Router();

// Read path for the dashboard's transaction detail view - "why was this
// transaction flagged" - and the one place a human-facing audit trail lives.
router.get("/:transactionId", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, actor, action, detail, created_at
       FROM audit_logs
       WHERE transaction_id = $1
       ORDER BY created_at ASC`,
      [req.params.transactionId]
    );
    res.json({ auditLogs: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

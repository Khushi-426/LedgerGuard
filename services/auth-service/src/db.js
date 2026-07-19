const { Pool } = require("pg");

// A single pooled connection shared across the process. Postgres handles
// connection-level concurrency far better than opening a client per request.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on("error", (err) => {
  console.error("[auth-service] unexpected postgres pool error", err);
});

module.exports = { pool };

const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on("error", (err) => console.error("[transaction-service] pg pool error", err));
module.exports = { pool };

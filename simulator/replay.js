/**
 * LedgerGuard transaction replay simulator.
 *
 * The Kaggle Credit Card Fraud Detection dataset is static and historical -
 * there is no live feed. This script is the harness that turns it into
 * "real-time-feeling" traffic by reading rows from creditcard.csv and
 * POSTing them to the Transaction Service at a configurable rate. This is
 * a simulation over historical data, not synthetic fraud data - see the
 * system design doc, section 2, for why this distinction is called out
 * explicitly rather than glossed over.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:8080 \
 *   EMAIL=demo@ledgerguard.dev PASSWORD=Password123! \
 *   ACCOUNT_ID=<uuid-of-a-seeded-account> \
 *   CSV_PATH=./data/creditcard.csv \
 *   RATE_PER_SECOND=5 \
 *   node replay.js
 *
 * `EMAIL` and `PASSWORD` default to `demo@ledgerguard.dev` / `Password123!` if not set.
 */
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { parse } = require("csv-parse/sync");
const crypto = require("crypto");
const { Client } = require("pg");

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8080";
const EMAIL = process.env.EMAIL || "demo@ledgerguard.dev";
const PASSWORD = process.env.PASSWORD || "Password123!";
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const CSV_PATH = process.env.CSV_PATH || path.join(__dirname, "data", "creditcard.csv");
const RATE_PER_SECOND = Number(process.env.RATE_PER_SECOND || 5);
const MAX_ROWS = Number(process.env.MAX_ROWS || 500);
const PG_HOST = process.env.PGHOST || "localhost";
const PG_PORT = Number(process.env.PGPORT || 5432);
const PG_USER = process.env.PGUSER || process.env.POSTGRES_USER || "ledgerguard";
const PG_PASSWORD = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || "ledgerguard";
const PG_DATABASE = process.env.PGDATABASE || process.env.POSTGRES_DB || "ledgerguard";

const FEATURE_COLUMNS = ["Time", ...Array.from({ length: 28 }, (_, i) => `V${i + 1}`), "Amount"];

async function login() {
  try {
    const { data } = await axios.post(`${API_BASE_URL}/auth/login`, { email: EMAIL, password: PASSWORD });
    return data.accessToken;
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 400) {
      throw new Error(
        "Unable to log in. Verify EMAIL and PASSWORD, and ensure the API Gateway/auth service are running."
      );
    }
    throw new Error(`Unable to log in to ${API_BASE_URL}/auth/login: ${err.message}`);
  }
}

function* readRows(csvPath, limit) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  for (let i = 0; i < Math.min(limit, records.length); i++) {
    yield records[i];
  }
}

function toFeatureVector(row) {
  const vector = {};
  for (const col of FEATURE_COLUMNS) {
    vector[col] = Number(row[col]);
  }
  return vector;
}

async function getDbClient() {
  const client = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: PG_DATABASE,
  });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Unable to connect to Postgres at ${PG_HOST}:${PG_PORT} as ${PG_USER}: ${err.message}`
    );
  }
  return client;
}

async function findOrCreateAccountId() {
  const db = await getDbClient();
  try {
    if (ACCOUNT_ID) {
      const { rows } = await db.query("SELECT id FROM accounts WHERE id = $1", [ACCOUNT_ID]);
      if (!rows.length) {
        throw new Error(`ACCOUNT_ID ${ACCOUNT_ID} was not found in the accounts table`);
      }
      console.log(`[simulator] using provided account ${ACCOUNT_ID}`);
      return ACCOUNT_ID;
    }

    if (!EMAIL || !PASSWORD) {
      throw new Error("Set EMAIL and PASSWORD env vars for a user registered via POST /auth/register");
    }

    let userId;
    try {
      await axios.post(`${API_BASE_URL}/auth/login`, { email: EMAIL, password: PASSWORD });
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 400) {
        try {
          const { data } = await axios.post(`${API_BASE_URL}/auth/register`, {
            email: EMAIL,
            password: PASSWORD,
            role: "analyst",
          });
          userId = data.user.id;
          console.log(`[simulator] created user ${EMAIL}`);
        } catch (registerErr) {
          if (registerErr.response?.status === 409) {
            console.log(`[simulator] user ${EMAIL} already exists, resolving existing account`);
          } else {
            throw registerErr;
          }
        }
      } else if (!err.response) {
        throw new Error(
          `Unable to reach auth service at ${API_BASE_URL}/auth/login: ${err.message}`
        );
      } else {
        throw err;
      }
    }

    if (!userId) {
      const { rows } = await db.query("SELECT id FROM users WHERE email = $1", [EMAIL]);
      if (!rows.length) {
        throw new Error(`User ${EMAIL} not found in the database after authentication`);
      }
      userId = rows[0].id;
    }

    const { rows: accounts } = await db.query(
      "SELECT id FROM accounts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    if (accounts.length) {
      console.log(`[simulator] using existing account ${accounts[0].id} for user ${EMAIL}`);
      return accounts[0].id;
    }

    const accountNumber = `ACCT${crypto.randomBytes(6).toString("hex")}`;
    const { rows: inserted } = await db.query(
      "INSERT INTO accounts (user_id, account_number) VALUES ($1, $2) RETURNING id",
      [userId, accountNumber]
    );
    console.log(`[simulator] created account ${inserted[0].id} for user ${EMAIL}`);
    return inserted[0].id;
  } finally {
    await db.end();
  }
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `${CSV_PATH} not found. Download creditcard.csv from ` +
        "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud and place it there."
    );
  }

  const accountId = await findOrCreateAccountId();
  const token = await login();
  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
  });

  const intervalMs = 1000 / RATE_PER_SECOND;
  let sent = 0;
  let flagged = 0;

  for (const row of readRows(CSV_PATH, MAX_ROWS)) {
    const amount = Number(row.Amount) || 0.01;

    try {
      const { data } = await client.post("/transactions", {
        accountId,
        amount: Math.max(amount, 0.01),
        currency: "USD",
        idempotencyKey: crypto.randomUUID(),
        sourceFeatures: toFeatureVector(row),
      });
      sent += 1;
      if (row.Class === "1") flagged += 1;
      process.stdout.write(
        `\rsent=${sent} known_fraud_rows_replayed=${flagged} last_txn=${data.transaction.id}`
      );
    } catch (err) {
      console.error(`\n[simulator] request failed: ${err.response?.data?.error || err.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.log(`\n[simulator] done. Sent ${sent} transactions (${flagged} were known-fraud rows in the source data).`);
}

main().catch((err) => {
  console.error("[simulator] fatal:", err.message);
  process.exit(1);
});

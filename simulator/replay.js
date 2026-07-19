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
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const axios = require("axios");
const { parse } = require("csv-parse/sync");
const crypto = require("crypto");

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8080";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const CSV_PATH = process.env.CSV_PATH || path.join(__dirname, "data", "creditcard.csv");
const RATE_PER_SECOND = Number(process.env.RATE_PER_SECOND || 5);
const MAX_ROWS = Number(process.env.MAX_ROWS || 500);

const FEATURE_COLUMNS = ["Time", ...Array.from({ length: 28 }, (_, i) => `V${i + 1}`), "Amount"];

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set EMAIL and PASSWORD env vars for a user registered via POST /auth/register");
  }
  const { data } = await axios.post(`${API_BASE_URL}/auth/login`, { email: EMAIL, password: PASSWORD });
  return data.accessToken;
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

async function main() {
  if (!ACCOUNT_ID) throw new Error("Set ACCOUNT_ID env var to an existing account's UUID");
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `${CSV_PATH} not found. Download creditcard.csv from ` +
        "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud and place it there."
    );
  }

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
        accountId: ACCOUNT_ID,
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

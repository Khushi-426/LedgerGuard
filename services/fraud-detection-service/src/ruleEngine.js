const { redis } = require("./redis");

// Thresholds are intentionally simple and explainable - a real bank tunes
// these against historical loss data, not gut feeling. The point here is
// the *shape* of a rule engine (fast, deterministic, explainable checks
// that run before/alongside the ML call), not a sophisticated ruleset.
const LARGE_AMOUNT_THRESHOLD = 2000;
const VELOCITY_WINDOW_SECONDS = 300; // 5 minutes
const VELOCITY_COUNT_THRESHOLD = 5;
const ODD_HOUR_START = 0;
const ODD_HOUR_END = 5;

async function checkVelocity(accountId) {
  const key = `velocity:${accountId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, VELOCITY_WINDOW_SECONDS);
  }
  return count > VELOCITY_COUNT_THRESHOLD;
}

function checkLargeAmount(amount) {
  return amount >= LARGE_AMOUNT_THRESHOLD;
}

function checkOddHour(occurredAt) {
  const hour = new Date(occurredAt).getUTCHours();
  return hour >= ODD_HOUR_START && hour <= ODD_HOUR_END;
}

/**
 * Runs all deterministic rules against a transaction. Returns the list of
 * rule names that fired - an empty array means "clean" by rule-engine logic
 * alone (the ML score can still flag it).
 */
async function evaluate(transaction) {
  const flags = [];

  if (checkLargeAmount(Number(transaction.amount))) flags.push("LARGE_AMOUNT");
  if (checkOddHour(transaction.occurred_at)) flags.push("ODD_HOUR");
  if (await checkVelocity(transaction.account_id)) flags.push("HIGH_VELOCITY");

  return flags;
}

module.exports = { evaluate };

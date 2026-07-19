const { Kafka } = require("kafkajs");
const { pool } = require("../db");
const ruleEngine = require("../ruleEngine");
const mlClient = require("../mlClient");
const { decide } = require("../decision");
const { publishDecision } = require("./producer");

const kafka = new Kafka({
  clientId: "fraud-detection-service",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  retry: { retries: 8 },
});

// Its own consumer group so it can be scaled horizontally: add more
// instances and Kafka rebalances partitions across them automatically.
const consumer = kafka.consumer({ groupId: "fraud-detection-group" });

async function processTransaction(transaction) {
  // Run rule engine
  const ruleFlags = await ruleEngine.evaluate(transaction);

  // ML prediction
  const { probability, modelVersion } = await mlClient.predict(
    transaction.source_features
  );

  // Final decision
  const { finalScore, decision } = decide({
    mlProbability: probability,
    ruleFlags,
  });

  // Save risk score
  await pool.query(
    `INSERT INTO risk_scores
      (transaction_id, ml_probability, rule_flags, final_score, decision, model_version)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (transaction_id) DO NOTHING`,
    [
      transaction.id,
      probability,
      JSON.stringify(ruleFlags),
      finalScore,
      decision,
      modelVersion,
    ]
  );

  // Map decision -> database enum value
  const statusMap = {
    APPROVE: "APPROVED",
    REVIEW: "REVIEW",
    BLOCK: "BLOCKED",
  };

  const status = statusMap[decision] || "BLOCKED";

  // Update transaction status
  await pool.query(
    `UPDATE transactions
     SET status = $2::txn_status
     WHERE id = $1`,
    [transaction.id, status]
  );

  // Publish decision for downstream services
  await publishDecision({
    transactionId: transaction.id,
    accountId: transaction.account_id,
    decision,
    finalScore,
    ruleFlags,
    mlProbability: probability,
    modelVersion,
    decidedAt: new Date().toISOString(),
  });

  console.log(
    `[fraud-detection-service] txn=${transaction.id} decision=${decision} status=${status} score=${finalScore.toFixed(
      3
    )} flags=${ruleFlags.join(",") || "none"}`
  );
}

async function start() {
  await consumer.connect();

  await consumer.subscribe({
    topic: "transactions",
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const transaction = JSON.parse(message.value.toString());
        await processTransaction(transaction);
      } catch (err) {
        // Don't crash the consumer on a bad message.
        console.error(
          "[fraud-detection-service] failed to process message",
          err
        );
      }
    },
  });

  console.log(
    "[fraud-detection-service] kafka consumer running (group: fraud-detection-group)"
  );
}

module.exports = { start };
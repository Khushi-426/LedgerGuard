const { Kafka } = require("kafkajs");
const { pool } = require("../db");

const kafka = new Kafka({
  clientId: "audit-service",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  retry: { retries: 8 },
});

// Its own consumer group on BOTH topics: audit gets an independent copy of
// every transaction-created and every decision event, without coordinating
// with the fraud-detection or notification consumer groups at all - the
// core benefit of pub/sub over point-to-point calls (design doc section 4/7).
const consumer = kafka.consumer({ groupId: "audit-group" });

async function writeAuditLog({ transactionId, actor, action, detail }) {
  // Append-only by convention here; the DB role for this service should
  // also have UPDATE/DELETE revoked in a real deployment (design doc section 6).
  await pool.query(
    `INSERT INTO audit_logs (transaction_id, actor, action, detail) VALUES ($1, $2, $3, $4)`,
    [transactionId, actor, action, JSON.stringify(detail)]
  );
}

async function start() {
  await consumer.connect();
  await consumer.subscribe({ topic: "transactions", fromBeginning: false });
  await consumer.subscribe({ topic: "fraud.decisions", fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());

        if (topic === "transactions") {
          await writeAuditLog({
            transactionId: payload.id,
            actor: "system",
            action: "TRANSACTION_CREATED",
            detail: { amount: payload.amount, currency: payload.currency },
          });
        } else if (topic === "fraud.decisions") {
          await writeAuditLog({
            transactionId: payload.transactionId,
            actor: "ml_model",
            action: `DECISION_${payload.decision}`,
            detail: {
              finalScore: payload.finalScore,
              ruleFlags: payload.ruleFlags,
              mlProbability: payload.mlProbability,
              modelVersion: payload.modelVersion,
            },
          });
        }
      } catch (err) {
        console.error("[audit-service] failed to write audit log", err);
      }
    },
  });

  console.log("[audit-service] kafka consumer running (group: audit-group)");
}

module.exports = { start };

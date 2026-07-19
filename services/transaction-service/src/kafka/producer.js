const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "transaction-service",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  retry: { retries: 8 },
});

const producer = kafka.producer();
let connected = false;

async function connect() {
  if (connected) return;
  await producer.connect();
  connected = true;
  console.log("[transaction-service] kafka producer connected");
}

// Keyed by account_id: guarantees per-account ordering on the partition,
// which the fraud-detection velocity checks depend on (see design doc section 7).
async function publishTransactionCreated(transaction) {
  await connect();
  await producer.send({
    topic: "transactions",
    messages: [
      {
        key: transaction.account_id,
        value: JSON.stringify(transaction),
        headers: { correlationId: transaction.id },
      },
    ],
  });
}

module.exports = { connect, publishTransactionCreated };

const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "fraud-detection-service-producer",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  retry: { retries: 8 },
});

const producer = kafka.producer();
let connected = false;

async function connect() {
  if (connected) return;
  await producer.connect();
  connected = true;
}

// Keyed by transaction_id: each decision is independent of the others, so
// keying this way spreads load evenly across partitions (see design doc section 7).
async function publishDecision(decisionEvent) {
  await connect();
  await producer.send({
    topic: "fraud.decisions",
    messages: [{ key: decisionEvent.transactionId, value: JSON.stringify(decisionEvent) }],
  });
}

module.exports = { connect, publishDecision };

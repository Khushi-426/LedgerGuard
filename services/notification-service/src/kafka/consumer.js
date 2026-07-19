const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "notification-service",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  retry: { retries: 8 },
});

const consumer = kafka.consumer({ groupId: "notification-group" });

async function start(broadcast) {
  await consumer.connect();
  await consumer.subscribe({ topic: "fraud.decisions", fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const decisionEvent = JSON.parse(message.value.toString());

        // Only push REVIEW/BLOCK to the dashboard - an analyst doesn't need
        // a toast for every routine APPROVE, that's just noise.
        if (decisionEvent.decision === "REVIEW" || decisionEvent.decision === "BLOCK") {
          broadcast({ type: "FRAUD_ALERT", ...decisionEvent });
          console.log(
            `[notification-service] pushed alert for txn=${decisionEvent.transactionId} decision=${decisionEvent.decision}`
          );
          // A real integration would also queue an email/SMS here via a
          // provider SDK and record it in the `notifications` table.
        }
      } catch (err) {
        console.error("[notification-service] failed to process message", err);
      }
    },
  });

  console.log("[notification-service] kafka consumer running (group: notification-group)");
}

module.exports = { start };

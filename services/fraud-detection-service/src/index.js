const { start } = require("./kafka/consumer");

start().catch((err) => {
  console.error("[fraud-detection-service] fatal startup error", err);
  process.exit(1);
});

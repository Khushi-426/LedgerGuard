const express = require("express");
const cors = require("cors");
const transactionRoutes = require("./routes/transaction.routes");
const { connect } = require("./kafka/producer");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "transaction-service" }));
app.use("/transactions", transactionRoutes);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error("[transaction-service] unhandled error", err);
  res.status(status).json({ error: err.message || "internal_server_error" });
});

const PORT = process.env.PORT || 4002;

// Connect the Kafka producer eagerly at boot rather than lazily on the first
// request, so a broken broker connection surfaces at startup, not mid-traffic.
connect()
  .catch((err) => console.error("[transaction-service] kafka connect failed, will retry lazily", err.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`[transaction-service] listening on :${PORT}`));
  });

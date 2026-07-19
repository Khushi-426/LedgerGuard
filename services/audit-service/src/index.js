const express = require("express");
const cors = require("cors");
const auditRoutes = require("./routes/audit.routes");
const { start } = require("./kafka/consumer");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "audit-service" }));
app.use("/audit", auditRoutes);

app.use((err, _req, res, _next) => {
  console.error("[audit-service] unhandled error", err);
  res.status(500).json({ error: "internal_server_error" });
});

const PORT = process.env.PORT || 4003;

start().catch((err) => console.error("[audit-service] kafka consumer failed to start", err));
app.listen(PORT, () => console.log(`[audit-service] listening on :${PORT}`));

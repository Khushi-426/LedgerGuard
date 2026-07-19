const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes");
const { AuthError } = require("./services/auth.service");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "auth-service" }));
app.use("/", authRoutes);

// Centralized error handler - keeps controllers free of try/catch boilerplate
// for anything beyond translating domain errors to HTTP status codes.
app.use((err, _req, res, _next) => {
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error("[auth-service] unhandled error", err);
  res.status(500).json({ error: "internal_server_error" });
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`[auth-service] listening on :${PORT}`));

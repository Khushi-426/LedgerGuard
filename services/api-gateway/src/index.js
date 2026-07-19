const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { requireAuth } = require("./middleware/auth");

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://localhost:4001";
const TRANSACTION_SERVICE_URL = process.env.TRANSACTION_SERVICE_URL || "http://localhost:4002";
const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL || "http://localhost:4003";
const API_RATE_LIMIT = Number(process.env.API_RATE_LIMIT || 600);
const API_RATE_WINDOW_MS = Number(process.env.API_RATE_WINDOW_MS || 60 * 1000);

const app = express();
app.use(cors());

// Centralized rate limiting - every business service is protected by one
// policy instead of each reimplementing it.
// Defaults are tuned for local dev/demo replay traffic but may be adjusted
// via API_RATE_LIMIT and API_RATE_WINDOW_MS.
app.use(
  rateLimit({
    windowMs: API_RATE_WINDOW_MS,
    limit: API_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "api-gateway" }));

// Auth routes are public (you can't require a JWT to log in).
app.use(
  "/auth",
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/auth": "" },
  })
);

// Everything else requires a verified JWT before the gateway forwards it.
app.use(
  "/transactions",
  requireAuth,
  createProxyMiddleware({
    target: TRANSACTION_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/(.*)$": "/transactions/$1" },
  })
);

app.use(
  "/audit",
  requireAuth,
  createProxyMiddleware({
    target: AUDIT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/(.*)$": "/audit/$1" },
  })
);

app.use((_req, res) => res.status(404).json({ error: "not_found" }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`[api-gateway] listening on :${PORT}`));

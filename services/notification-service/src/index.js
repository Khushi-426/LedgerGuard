const express = require("express");
const http = require("http");
const { createBroadcaster } = require("./ws");
const { start } = require("./kafka/consumer");

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok", service: "notification-service" }));

const server = http.createServer(app);
const { broadcast } = createBroadcaster(server);

const PORT = process.env.PORT || 4004;

start(broadcast).catch((err) => console.error("[notification-service] kafka consumer failed to start", err));
server.listen(PORT, () => console.log(`[notification-service] http+ws listening on :${PORT}`));

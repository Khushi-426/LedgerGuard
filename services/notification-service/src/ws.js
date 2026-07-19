const { WebSocketServer } = require("ws");

// A flaky downstream (email/SMS provider) must never stall this path - this
// service's only synchronous-feeling job is pushing to already-connected
// dashboard clients over an in-memory broadcast (design doc section 4).
function createBroadcaster(server) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "CONNECTED", message: "subscribed to fraud decisions" }));
  });

  function broadcast(event) {
    const payload = JSON.stringify(event);
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(payload);
    });
  }

  return { broadcast };
}

module.exports = { createBroadcaster };

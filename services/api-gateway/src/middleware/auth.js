const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Coarse-grained gate at the edge. Downstream services still re-verify
// (defense in depth, design doc section 8) - this middleware exists so
// unauthenticated traffic never even reaches a business service.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing bearer token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

module.exports = { requireAuth };

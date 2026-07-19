const authService = require("../services/auth.service");
const { registerSchema, loginSchema } = require("../schemas/auth.schema");

async function register(req, res, next) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const user = await authService.register(parsed.data);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const tokens = await authService.login(parsed.data);
    res.json(tokens);
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: "refreshToken is required" });
    const result = await authService.refresh(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// Called by other services / the gateway to verify a bearer token without
// duplicating JWT-verification logic everywhere.
async function verify(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "missing bearer token" });
    const decoded = authService.verify(token);
    res.json({ valid: true, claims: decoded });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refresh, verify };

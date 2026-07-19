const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const userRepository = require("../repositories/user.repository");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_TTL = process.env.REFRESH_EXPIRES_IN || "7d";
const BCRYPT_ROUNDS = 12;

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

async function register({ email, password, role }) {
  const existing = await userRepository.findByEmail(email);
  if (existing) throw new AuthError("an account with this email already exists", 409);

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await userRepository.create({ email, passwordHash, role });
  return user;
}

async function login({ email, password }) {
  const user = await userRepository.findByEmail(email);
  // Deliberately generic error message for both "no such user" and "wrong
  // password" - never reveal which one failed, that leaks account existence.
  if (!user) throw new AuthError("invalid email or password");

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AuthError("invalid email or password");

  return issueTokens(user);
}

function issueTokens(user) {
  const payload = { sub: user.id, email: user.email, role: user.role };
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = jwt.sign({ sub: user.id, type: "refresh" }, JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
  return { accessToken, refreshToken };
}

function refresh(refreshToken) {
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, JWT_SECRET);
  } catch (err) {
    throw new AuthError("invalid or expired refresh token");
  }
  if (decoded.type !== "refresh") throw new AuthError("not a refresh token");

  const accessToken = jwt.sign({ sub: decoded.sub }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  return { accessToken };
}

function verify(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw new AuthError("invalid or expired token");
  }
}

module.exports = { register, login, refresh, verify, AuthError };

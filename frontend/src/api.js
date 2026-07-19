import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
export const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4004";

// A thin client layer so components never construct URLs or attach the
// auth header themselves - one place to change if the gateway contract moves.
export function createApiClient(token) {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function login(email, password) {
  const { data } = await axios.post(`${API_BASE_URL}/auth/login`, { email, password });
  return data; // { accessToken, refreshToken }
}

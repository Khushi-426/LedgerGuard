import { useEffect, useMemo, useState } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { createApiClient, login as loginRequest, WS_URL } from "./api";
import TransactionTable from "./components/TransactionTable";
import RiskChart from "./components/RiskChart";

export default function App() {
  const [token, setToken] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(null);

  const [transactions, setTransactions] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const api = useMemo(() => createApiClient(token), [token]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError(null);
    try {
      const { accessToken } = await loginRequest(email, password);
      setToken(accessToken);
    } catch (err) {
      setLoginError(err.response?.data?.error || "login failed");
    }
  }

  // Poll the REST endpoint for the base transaction list, and layer live
  // WebSocket push notifications on top for REVIEW/BLOCK alerts - this
  // mirrors the design doc's split between the polled history view and the
  // real-time notification path (section 5, steps 7-8).
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    async function poll() {
      try {
        const { data } = await api.get("/transactions?limit=25");
        if (!cancelled) setTransactions(data.transactions);
      } catch (err) {
        console.error("failed to poll transactions", err);
      }
    }
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, api]);

  useEffect(() => {
    if (!token) return;

    const socket = new WebSocket(WS_URL);
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "FRAUD_ALERT") {
        setAlerts((prev) => [payload, ...prev].slice(0, 100));
      }
    };
    return () => socket.close();
  }, [token]);

  if (!token) {
    return (
      <Container maxWidth="xs" sx={{ mt: 10 }}>
        <Typography variant="h5" gutterBottom>
          LedgerGuard
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Fraud analyst sign in
        </Typography>
        <Box component="form" onSubmit={handleLogin} sx={{ mt: 2 }}>
          <Stack spacing={2}>
            {loginError && <Alert severity="error">{loginError}</Alert>}
            <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" variant="contained">
              Sign in
            </Button>
          </Stack>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 6 }}>
      <Typography variant="h5" gutterBottom>
        LedgerGuard - fraud analyst dashboard
      </Typography>

      <Stack spacing={3} sx={{ mt: 3 }}>
        <RiskChart alerts={alerts} />

        <Box>
          <Typography variant="subtitle1" gutterBottom>
            Recent transactions
          </Typography>
          <TransactionTable transactions={transactions} />
        </Box>

        <Box>
          <Typography variant="subtitle1" gutterBottom>
            Live fraud alerts ({alerts.length})
          </Typography>
          <Stack spacing={1}>
            {alerts.slice(0, 5).map((a, i) => (
              <Alert key={i} severity={a.decision === "BLOCK" ? "error" : "warning"}>
                {a.decision} · txn {a.transactionId.slice(0, 8)} · score {a.finalScore.toFixed(2)} · flags:{" "}
                {a.ruleFlags.join(", ") || "none"}
              </Alert>
            ))}
          </Stack>
        </Box>
      </Stack>
    </Container>
  );
}

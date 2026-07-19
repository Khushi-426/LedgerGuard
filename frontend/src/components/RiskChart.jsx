import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// Buckets live fraud-alert scores into a simple histogram so an analyst can
// see at a glance whether recent traffic is skewing toward high-risk.
export default function RiskChart({ alerts }) {
  const buckets = [0, 0, 0, 0, 0]; // 0-0.2, 0.2-0.4, ..., 0.8-1.0
  alerts.forEach((a) => {
    const idx = Math.min(Math.floor(a.finalScore * 5), 4);
    buckets[idx] += 1;
  });

  const data = {
    labels: ["0.0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"],
    datasets: [
      {
        label: "Flagged transactions by risk score",
        data: buckets,
        backgroundColor: "#D85A30",
      },
    ],
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        Risk score distribution (REVIEW / BLOCK alerts)
      </Typography>
      <Box sx={{ height: 240 }}>
        <Bar data={data} options={{ responsive: true, maintainAspectRatio: false }} />
      </Box>
    </Paper>
  );
}

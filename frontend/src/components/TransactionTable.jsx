import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";

const STATUS_COLOR = {
  APPROVED: "success",
  PENDING: "default",
  REVIEW: "warning",
  BLOCKED: "error",
};

export default function TransactionTable({ transactions }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Transaction</TableCell>
            <TableCell>Account</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Occurred at</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {transactions.map((txn) => (
            <TableRow key={txn.id} hover>
              <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{txn.id.slice(0, 8)}</TableCell>
              <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{txn.account_id?.slice(0, 8)}</TableCell>
              <TableCell align="right">
                {Number(txn.amount).toLocaleString(undefined, { style: "currency", currency: txn.currency || "USD" })}
              </TableCell>
              <TableCell>
                <Chip size="small" label={txn.status} color={STATUS_COLOR[txn.status] || "default"} />
              </TableCell>
              <TableCell>{new Date(txn.occurred_at).toLocaleString()}</TableCell>
            </TableRow>
          ))}
          {transactions.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} align="center" sx={{ color: "text.secondary" }}>
                No transactions yet - run the replay simulator to generate traffic.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

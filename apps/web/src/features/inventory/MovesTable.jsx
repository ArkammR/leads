import { Badge } from "../../components/ui";
import { STOCK_REASONS as REASONS, fmtDate, money } from "../../lib/constants";

export default function MovesTable({ rows, users = [], showProduct = true }) {
  const who = (uid) => (uid === "3pl-webhook" ? "Courier webhook" : users.find((u) => u.id === uid)?.name || uid);
  return (
    <table>
      <thead><tr><th>When</th>{showProduct && <th>Product</th>}<th>Type</th><th>Change</th><th>Balance</th><th>Unit cost</th><th>Details</th><th>By</th></tr></thead>
      <tbody>
        {rows.map((m) => {
          const [label, color] = REASONS[m.reason] || [m.reason, "gray"];
          return (
            <tr key={m.id}>
              <td>{fmtDate(m.createdAt)}</td>
              {showProduct && <td>{m.name}</td>}
              <td><Badge color={color}>{label}</Badge></td>
              <td style={{ color: m.delta < 0 ? "var(--red)" : "var(--green)" }}><b>{m.delta > 0 ? "+" : ""}{m.delta}</b></td>
              <td>{m.balance}</td>
              <td>{m.unitCost == null ? <span className="muted">—</span> : money(m.unitCost)}</td>
              <td>
                {m.orderId && <>Order #{m.orderId.slice(0, 6)} </>}
                {m.supplier && <>from {m.supplier} </>}
                {m.note && <span className="muted">{m.note}</span>}
              </td>
              <td>{who(m.by)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

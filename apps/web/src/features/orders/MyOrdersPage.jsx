import { collection, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, PageHead } from "../../components/ui";
import { fmtDate, money } from "../../lib/constants";

export default function MyOrders() {
  const { user } = useAuth();
  const { data, loading } = useLive(() => query(collection(db, "orders"), where("agentId", "==", user.uid)), [user.uid]);
  const rows = [...data].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  return (
    <>
      <PageHead title="My orders" sub="Orders you've created and their delivery progress" />
      <div className="card tablewrap">
        {!loading && rows.length === 0 ? <Empty>No orders yet.</Empty> : (
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id.slice(0, 6)}</td><td>{o.customer.name}</td>
                  <td>{o.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}</td>
                  <td>{money(o.total)}</td><td><Badge>{o.status}</Badge></td><td>{fmtDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

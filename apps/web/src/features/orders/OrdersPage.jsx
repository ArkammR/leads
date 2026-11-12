import { useState } from "react";
import { collection } from "firebase/firestore";
import { CheckCircle2, History } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, PageHead, useAction, useToast } from "../../components/ui";
import HistoryModal from "../../components/HistoryModal";
import { fmtDate, money } from "../../lib/constants";

export default function Orders() {
  const run = useAction();
  const toast = useToast();
  const { data, loading } = useLive(() => collection(db, "orders"), []);
  const users = useLive(() => collection(db, "users"), []).data;
  const [hist, setHist] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const rows = [...data].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const verify = async (o) => {
    setBusyId(o.id);
    let res;
    const ok = await run(async () => { res = await api.verifyOrder({ orderId: o.id }); }, "Order verified — stock deducted, customer notified");
    if (ok && res?.lowStock) toast(`${res.lowStock} product(s) now below minimum stock`, "err");
    setBusyId(null);
  };

  return (
    <>
      <PageHead title="Orders" sub="Verify pending orders; later statuses come from the 3PL webhook" />
      <div className="card tablewrap">
        {!loading && rows.length === 0 ? <Empty>No orders yet.</Empty> : (
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id.slice(0, 6)}</td>
                  <td><b>{o.customer.name}</b><div className="muted">{o.customer.phone}</div></td>
                  <td>{o.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}</td>
                  <td>{money(o.total)}</td>
                  <td><Badge>{o.status}</Badge></td>
                  <td>{fmtDate(o.createdAt)}</td>
                  <td className="actions">
                    {o.status === "Pending" && (
                      <button className="btn sm primary" disabled={busyId === o.id} onClick={() => verify(o)}><CheckCircle2 size={14} />Verify</button>
                    )}{" "}
                    <button className="btn sm" onClick={() => setHist(o)}><History size={14} />History</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {hist && <HistoryModal coll="orders" id={hist.id} title={`#${hist.id.slice(0, 6)}`} users={users} onClose={() => setHist(null)} />}
    </>
  );
}

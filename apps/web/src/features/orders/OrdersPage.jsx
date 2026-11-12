import { useState } from "react";
import { collection } from "firebase/firestore";
import { Ban, CheckCircle2, History } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, Field, Modal, PageHead, useAction, useToast } from "../../components/ui";
import HistoryModal from "../../components/HistoryModal";
import { fmtDate, money } from "../../lib/constants";

export default function Orders() {
  const run = useAction();
  const toast = useToast();
  const { data, loading } = useLive(() => collection(db, "orders"), []);
  const users = useLive(() => collection(db, "users"), []).data;
  const [hist, setHist] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [cancel, setCancel] = useState(null); // {order, reason}
  const [status, setStatus] = useState("");

  const doCancel = async () => {
    setBusyId(cancel.order.id);
    const ok = await run(() => api.cancelOrder({ orderId: cancel.order.id, reason: cancel.reason }), "Order cancelled, stock returned");
    setBusyId(null);
    if (ok) setCancel(null);
  };
  const statuses = [...new Set(data.map((o) => o.status))];
  const rows = [...data].filter((o) => !status || o.status === status).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const verify = async (o) => {
    setBusyId(o.id);
    let res;
    const ok = await run(async () => { res = await api.verifyOrder({ orderId: o.id }); }, "Order verified — stock deducted, customer notified");
    if (ok && res?.lowStock) toast(`${res.lowStock} product(s) now below minimum stock`, "err");
    setBusyId(null);
  };

  return (
    <>
      <PageHead title="Orders" sub="Verify pending orders; later statuses come from the 3PL webhook">
        <select className="select" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
      </PageHead>
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
                    {["Pending", "Verified"].includes(o.status) && (
                      <><button className="btn sm" disabled={busyId === o.id} onClick={() => setCancel({ order: o, reason: "" })}><Ban size={14} />Cancel</button>{" "}</>
                    )}
                    <button className="btn sm" onClick={() => setHist(o)}><History size={14} />History</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {cancel && (
        <Modal title={`Cancel order #${cancel.order.id.slice(0, 6)}`} onClose={() => setCancel(null)}
          footer={<><button className="btn" onClick={() => setCancel(null)}>Keep order</button>
            <button className="btn primary" disabled={busyId === cancel.order.id} onClick={doCancel}>Cancel order</button></>}>
          <p className="muted">{cancel.order.status === "Verified" ? "Deducted stock goes back on hand." : "Reserved stock is released."} The lead goes back to the agent's queue as Interested.</p>
          <Field label="Reason"><input className="input" value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} placeholder="Customer changed their mind, duplicate, fake order…" /></Field>
        </Modal>
      )}
      {hist && <HistoryModal coll="orders" id={hist.id} title={`#${hist.id.slice(0, 6)}`} users={users} onClose={() => setHist(null)} />}
    </>
  );
}

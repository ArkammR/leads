import { useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { CalendarClock, Phone, ShoppingCart } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, Field, Modal, PageHead, useAction } from "../../components/ui";
import { DISTRICTS } from "../../lib/districts";
import { AGENT_STATUSES, CALLBACK_STATUSES, available, fmtDate, money } from "../../lib/constants";

// datetime-local value (local time) for "tomorrow 10:00"
const defaultCallback = () => {
  const d = new Date(Date.now() + 24 * 3600e3);
  d.setHours(10, 0, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Queue() {
  const { user } = useAuth();
  const run = useAction();
  const leads = useLive(
    () => query(collection(db, "leads"), where("assignedTo", "==", user.uid), where("isActive", "==", true)),
    [user.uid]
  );
  const products = useLive(() => collection(db, "products"), []).data.filter((p) => p.isActive && available(p) > 0);

  const [cb, setCb] = useState(null);     // {lead, status, when}
  const [ord, setOrd] = useState(null);   // {lead, productId, qty, address}
  const [busy, setBusy] = useState(false);

  // Due callbacks first (oldest first), then fresh leads, then future callbacks.
  const queue = useMemo(() => {
    const now = Date.now();
    const rank = (l) => (l.callbackAt && l.callbackAt.toMillis() <= now ? 0 : l.callbackAt ? 2 : 1);
    return leads.data
      .filter((l) => !["Converted", "Not Interested"].includes(l.status))
      .sort((a, b) => rank(a) - rank(b) || (a.callbackAt?.toMillis() ?? 0) - (b.callbackAt?.toMillis() ?? 0));
  }, [leads.data]);
  const isDue = (l) => l.callbackAt && l.callbackAt.toMillis() <= Date.now();

  const setStatus = (lead, status) => {
    if (CALLBACK_STATUSES.includes(status)) return setCb({ lead, status, when: defaultCallback() });
    run(() => api.updateLeadStatus({ leadId: lead.id, status }), `Marked ${status}`);
  };
  const saveCallback = async () => {
    setBusy(true);
    const ok = await run(() => api.updateLeadStatus({ leadId: cb.lead.id, status: cb.status, callbackAtMs: new Date(cb.when).getTime() }), "Callback scheduled");
    setBusy(false);
    if (ok) setCb(null);
  };
  const saveOrder = async () => {
    setBusy(true);
    const ok = await run(() => api.createOrder({ leadId: ord.lead.id, address: ord.address, district: ord.district, city: ord.city, phone2: ord.phone2, items: [{ productId: ord.productId, qty: ord.qty }] }),
      "Order created — awaiting admin verification");
    setBusy(false);
    if (ok) setOrd(null);
  };
  const product = ord && products.find((p) => p.id === ord.productId);

  return (
    <>
      <PageHead title="My queue" sub={`${queue.length} leads to work. Due callbacks appear first.`} />
      {!leads.loading && queue.length === 0 ? <div className="card"><Empty>Nothing in your queue 🎉</Empty></div> : (
        <div className="queue">
          {queue.map((l) => (
            <div key={l.id} className={"card lead " + (isDue(l) ? "due" : "")}>
              <div className="info">
                <b>{l.name || "Unnamed"}</b> <Badge>{l.status}</Badge>
                <div className="meta">
                  <span>{l.phone}</span>{l.email && <span>{l.email}</span>}
                  {l.callbackAt && <span style={{ color: isDue(l) ? "var(--amber)" : undefined }}><CalendarClock size={13} /> {isDue(l) ? "Due: " : "Callback: "}{fmtDate(l.callbackAt)}</span>}
                </div>
              </div>
              <a className="callnow" href={`tel:+${l.phone}`}><Phone size={15} />Call</a>
              <div className="acts">
                <select className="select" style={{ width: "auto" }} value="" onChange={(e) => e.target.value && setStatus(l, e.target.value)}>
                  <option value="">Update status…</option>
                  {AGENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <button className="btn primary" onClick={() => setOrd({ lead: l, productId: products[0]?.id || "", qty: 1, address: "", district: "", city: "", phone2: "" })}>
                  <ShoppingCart size={15} />Create order
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {cb && (
        <Modal title={`${cb.status} — schedule callback`} onClose={() => setCb(null)}
          footer={<><button className="btn" onClick={() => setCb(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !cb.when} onClick={saveCallback}>Save</button></>}>
          <p className="muted">Pick when to call <b>{cb.lead.name}</b> back. The lead moves to the top of your queue at that time.</p>
          <Field label="Callback date & time">
            <input className="input" type="datetime-local" value={cb.when} onChange={(e) => setCb({ ...cb, when: e.target.value })} />
          </Field>
        </Modal>
      )}

      {ord && (
        <Modal title={`New order — ${ord.lead.name}`} onClose={() => setOrd(null)}
          footer={<><button className="btn" onClick={() => setOrd(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !ord.productId || !ord.address || !ord.district || !ord.city || ord.qty < 1 || (product && ord.qty > available(product))} onClick={saveOrder}>Create order</button></>}>
          {products.length === 0 ? <Empty>No products in stock.</Empty> : (
            <>
              <Field label="Product">
                <select className="select" value={ord.productId} onChange={(e) => setOrd({ ...ord, productId: e.target.value })}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)} ({available(p)} available)</option>)}
                </select>
              </Field>
              <Field label="Quantity"><input className="input" type="number" min="1" max={product ? available(product) : undefined} value={ord.qty} onChange={(e) => setOrd({ ...ord, qty: e.target.value })} /></Field>
              <Field label="Delivery address"><textarea className="input" rows="3" value={ord.address} onChange={(e) => setOrd({ ...ord, address: e.target.value })} /></Field>
              <div className="row2">
                <Field label="District">
                  <select className="select" value={ord.district} onChange={(e) => setOrd({ ...ord, district: e.target.value })}>
                    <option value="">Choose…</option>
                    {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="City / town"><input className="input" value={ord.city} onChange={(e) => setOrd({ ...ord, city: e.target.value })} placeholder="e.g. Nugegoda" /></Field>
              </div>
              <Field label="Second phone (optional)"><input className="input" value={ord.phone2} onChange={(e) => setOrd({ ...ord, phone2: e.target.value })} placeholder="07XXXXXXXX" /></Field>
              {product && <p><b>Total: {money(product.price * (ord.qty || 0))}</b></p>}
            </>
          )}
        </Modal>
      )}
    </>
  );
}

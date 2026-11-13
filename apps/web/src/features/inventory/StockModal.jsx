import { useState } from "react";
import { api } from "../../lib/firebase";
import { Field, Modal, useAction } from "../../components/ui";

const ADJUST_REASONS = [["damaged", "Damaged"], ["lost", "Lost or stolen"], ["recount", "Stock count correction"], ["other", "Other"]];

// Stock in (goods received) or a manual adjustment for one product.
export default function StockModal({ product, type, onClose }) {
  const run = useAction();
  const [f, setF] = useState({ qty: "", unitCost: "", supplier: "", reason: "recount", note: "", sign: "-" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isIn = type === "in";
  const qty = parseInt(f.qty, 10) || 0;
  const delta = isIn ? qty : f.sign === "-" ? -qty : qty;

  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.adjustStock({
      productId: product.id, type, qty: delta, note: f.note,
      ...(isIn ? { unitCost: f.unitCost, supplier: f.supplier } : { reason: f.reason }),
    }), isIn ? "Stock received" : "Stock adjusted");
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title={`${isIn ? "Stock in" : "Adjust stock"} — ${product.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || qty < 1} onClick={save}>Save</button></>}>
      <p className="muted">On hand now: <b>{product.stock}</b> · after this: <b>{(product.stock || 0) + delta}</b></p>
      {isIn ? (
        <>
          <div className="row">
            <Field label="Quantity received"><input className="input" type="number" min="1" value={f.qty} onChange={set("qty")} /></Field>
            <Field label="Unit cost (optional)"><input className="input" type="number" min="0" step="0.01" value={f.unitCost} onChange={set("unitCost")} /></Field>
          </div>
          <Field label="Supplier (optional)"><input className="input" value={f.supplier} onChange={set("supplier")} /></Field>
        </>
      ) : (
        <>
          <div className="row">
            <Field label="Direction">
              <select className="select" value={f.sign} onChange={set("sign")}>
                <option value="-">Remove stock</option><option value="+">Add stock</option>
              </select>
            </Field>
            <Field label="Quantity"><input className="input" type="number" min="1" value={f.qty} onChange={set("qty")} /></Field>
          </div>
          <Field label="Reason">
            <select className="select" value={f.reason} onChange={set("reason")}>
              {ADJUST_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </>
      )}
      <Field label="Note (optional)"><input className="input" value={f.note} onChange={set("note")} /></Field>
    </Modal>
  );
}

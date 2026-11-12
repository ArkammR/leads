import { useState } from "react";
import { collection } from "firebase/firestore";
import { Pencil, Plus } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, Field, Modal, PageHead, useAction } from "../../components/ui";
import { money } from "../../lib/constants";

const blank = { name: "", sku: "", price: "", stock: "", minStockLevel: "" };

export default function Products() {
  const run = useAction();
  const { data, loading } = useLive(() => collection(db, "products"), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.saveProduct(form), "Product saved");
    setBusy(false);
    if (ok) setForm(null);
  };

  const rows = [...data].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <>
      <PageHead title="Products" sub="Inventory and minimum stock levels">
        <button className="btn primary" onClick={() => setForm(blank)}><Plus size={16} />New product</button>
      </PageHead>
      <div className="card tablewrap">
        {!loading && rows.length === 0 ? <Empty>No products yet.</Empty> : (
          <table>
            <thead><tr><th>SKU</th><th>Name</th><th>Price</th><th>Stock</th><th>Min</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={(p.isActive ? "" : "inactive ") + (p.isActive && p.stock <= p.minStockLevel ? "warn" : "")}>
                  <td>{p.sku}</td><td>{p.name}</td><td>{money(p.price)}</td>
                  <td><b>{p.stock}</b> {p.isActive && p.stock <= p.minStockLevel && <Badge color="red">Low</Badge>}</td>
                  <td>{p.minStockLevel}</td>
                  <td><Badge color={p.isActive ? "green" : "gray"}>{p.isActive ? "Active" : "Inactive"}</Badge></td>
                  <td className="actions">
                    <button className="btn sm" onClick={() => setForm({ ...p })}><Pencil size={14} />Edit</button>{" "}
                    <button className="btn sm" onClick={() => run(() => api.setActive({ collection: "products", id: p.id, isActive: !p.isActive }))}>
                      {p.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <Modal title={form.id ? "Edit product" : "New product"} onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !form.name || !form.sku} onClick={save}>Save</button></>}>
          <Field label="Name"><input className="input" value={form.name} onChange={set("name")} /></Field>
          <Field label="SKU"><input className="input" value={form.sku} onChange={set("sku")} /></Field>
          <div className="row">
            <Field label="Price"><input className="input" type="number" min="0" step="0.01" value={form.price} onChange={set("price")} /></Field>
            <Field label="Stock"><input className="input" type="number" min="0" value={form.stock} onChange={set("stock")} /></Field>
            <Field label="Min stock level"><input className="input" type="number" min="0" value={form.minStockLevel} onChange={set("minStockLevel")} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

import { useState } from "react";
import { collection } from "firebase/firestore";
import { History, PackagePlus, Pencil, Plus, SlidersHorizontal } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, Field, Modal, PageHead, useAction } from "../../components/ui";
import { available, money } from "../../lib/constants";
import StockModal from "../inventory/StockModal";
import StockLogModal from "../inventory/StockLogModal";

const blank = { name: "", sku: "", price: "", costPrice: "", stock: "", minStockLevel: "" };

export default function Products() {
  const run = useAction();
  const { data, loading } = useLive(() => collection(db, "products"), []);
  const costs = Object.fromEntries(useLive(() => collection(db, "productCosts"), []).data.map((c) => [c.id, c.costPrice]));
  const [form, setForm] = useState(null);
  const [stock, setStock] = useState(null); // {product, type}
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.saveProduct(form), "Product saved");
    setBusy(false);
    if (ok) setForm(null);
  };

  const rows = [...data].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const low = (p) => p.isActive && available(p) <= p.minStockLevel;

  return (
    <>
      <PageHead title="Products" sub="Prices, costs and stock. Stock changes are logged on the Inventory page.">
        <button className="btn primary" onClick={() => setForm(blank)}><Plus size={16} />New product</button>
      </PageHead>
      <div className="card tablewrap">
        {!loading && rows.length === 0 ? <Empty>No products yet.</Empty> : (
          <table>
            <thead><tr><th>SKU</th><th>Name</th><th>Price</th><th>Cost</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Min</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={(p.isActive ? "" : "inactive ") + (low(p) ? "warn" : "")}>
                  <td>{p.sku}</td><td>{p.name}</td><td>{money(p.price)}</td>
                  <td>{costs[p.id] == null ? <span className="muted">—</span> : money(costs[p.id])}</td>
                  <td>{p.stock}</td>
                  <td>{p.reserved || 0}</td>
                  <td><b>{available(p)}</b> {low(p) && <Badge color="red">Low</Badge>}</td>
                  <td>{p.minStockLevel}</td>
                  <td><Badge color={p.isActive ? "green" : "gray"}>{p.isActive ? "Active" : "Inactive"}</Badge></td>
                  <td className="actions">
                    <button className="btn sm primary" onClick={() => setStock({ product: p, type: "in" })}><PackagePlus size={14} />Stock in</button>{" "}
                    <button className="btn sm" onClick={() => setStock({ product: p, type: "adjust" })}><SlidersHorizontal size={14} />Adjust</button>{" "}
                    <button className="btn sm" onClick={() => setLog(p)}><History size={14} />Log</button>{" "}
                    <button className="btn sm" onClick={() => setForm({ ...p, costPrice: costs[p.id] ?? "" })}><Pencil size={14} />Edit</button>{" "}
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
            <Field label="Selling price"><input className="input" type="number" min="0" step="0.01" value={form.price} onChange={set("price")} /></Field>
            <Field label="Cost price"><input className="input" type="number" min="0" step="0.01" value={form.costPrice} onChange={set("costPrice")} /></Field>
          </div>
          <div className="row">
            {!form.id && <Field label="Opening stock"><input className="input" type="number" min="0" value={form.stock} onChange={set("stock")} /></Field>}
            <Field label="Min stock level"><input className="input" type="number" min="0" value={form.minStockLevel} onChange={set("minStockLevel")} /></Field>
          </div>
          {form.id && <p className="muted">To change stock, use Stock in or Adjust so the change is logged.</p>}
          <p className="muted">Cost price is only visible to admins. Stock in with a unit cost updates it to the weighted average.</p>
        </Modal>
      )}
      {stock && <StockModal product={stock.product} type={stock.type} onClose={() => setStock(null)} />}
      {log && <StockLogModal product={log} onClose={() => setLog(null)} />}
    </>
  );
}

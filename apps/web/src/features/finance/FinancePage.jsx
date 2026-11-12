import { useMemo, useState } from "react";
import { collection } from "firebase/firestore";
import { Banknote, Pencil, Plus, Receipt, TrendingUp, Truck, Undo2, Wallet } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, ExportButton, Field, Modal, PageHead, Stat, useAction } from "../../components/ui";
import RangePicker from "../../components/RangePicker";
import { EXPENSE_CATEGORIES, RANGE_PRESETS as PRESETS, fmtDate, money, orderDate, payStatus, ts, ymd } from "../../lib/constants";

const IN_TRANSIT = ["Verified", "Dispatched", "OutForDelivery"];

export default function Finance() {
  const run = useAction();
  const orders = useLive(() => collection(db, "orders"), []).data;
  const expenses = useLive(() => collection(db, "expenses"), []).data.filter((e) => e.isActive);
  const remits = useLive(() => collection(db, "remittances"), []).data;
  const [range, setRange] = useState(() => PRESETS["This month"]().map(ymd));
  const [exp, setExp] = useState(null);
  const [picked, setPicked] = useState(null); // Set of orderIds for a remittance
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  const from = new Date(range[0] + "T00:00:00"), to = new Date(range[1] + "T23:59:59.999");
  const inRange = (d) => d && d >= from && d <= to;

  const r = useMemo(() => {
    const delivered = orders.filter((o) => o.status === "Delivered" && inRange(orderDate(o)));
    const returned = orders.filter((o) => ["Returned", "Failed"].includes(o.status) && inRange(ts(o.createdAt)));
    const exps = expenses.filter((e) => inRange(ts(e.date)));
    const revenue = delivered.reduce((s, o) => s + (o.total || 0), 0);
    const cogs = delivered.reduce((s, o) => s + (o.costTotal || 0), 0);
    const noCost = delivered.filter((o) => o.costTotal == null).length;
    const expTotal = exps.reduce((s, e) => s + e.amount, 0);
    const byCat = {};
    exps.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + e.amount));
    const byProduct = {};
    delivered.forEach((o) => o.items.forEach((i) => {
      const b = (byProduct[i.productId] ||= { name: i.name, units: 0, revenue: 0, cost: 0, noCost: false });
      b.units += i.qty; b.revenue += i.qty * i.price;
      if (i.unitCost == null) b.noCost = true; else b.cost += i.qty * i.unitCost;
    }));
    return {
      delivered, returned, exps: exps.sort((a, b) => ts(b.date) - ts(a.date)), revenue, cogs, noCost, expTotal, byCat,
      gross: revenue - cogs, net: revenue - cogs - expTotal,
      byProduct: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue),
      returnedValue: returned.reduce((s, o) => s + (o.total || 0), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, expenses, range[0], range[1]]);

  // Courier balance is not limited by the date range: it's what's owed right now.
  const owed = orders.filter((o) => o.status === "Delivered" && payStatus(o) === "collected")
    .sort((a, b) => (orderDate(a) || 0) - (orderDate(b) || 0));
  const owedTotal = owed.reduce((s, o) => s + (o.total || 0), 0);
  const transitValue = orders.filter((o) => IN_TRANSIT.includes(o.status)).reduce((s, o) => s + (o.total || 0), 0);
  const pickedTotal = picked ? owed.filter((o) => picked.has(o.id)).reduce((s, o) => s + o.total, 0) : 0;

  const saveExp = async () => {
    setBusy(true);
    const ok = await run(() => api.saveExpense({ ...exp, dateMs: new Date(exp.date + "T12:00:00").getTime() }), "Expense saved");
    setBusy(false);
    if (ok) setExp(null);
  };
  const saveRemit = async () => {
    setBusy(true);
    const ok = await run(() => api.recordRemittance({ orderIds: [...picked], reference: ref }), "Remittance recorded");
    setBusy(false);
    if (ok) { setPicked(null); setRef(""); }
  };
  const toggle = (id) => { const s = new Set(picked); if (s.has(id)) s.delete(id); else s.add(id); setPicked(s); };
  const pct = (a, b) => (b ? ` · ${Math.round((a / b) * 100)}%` : "");

  return (
    <>
      <PageHead title="Finance" sub="Profit from delivered orders, expenses and cash owed by the courier">
        <RangePicker range={range} onChange={setRange} />
      </PageHead>

      <div className="grid stats">
        <Stat icon={TrendingUp} value={money(r.revenue)} label={`Revenue from ${r.delivered.length} delivered orders`} color="green" />
        <Stat icon={Receipt} value={money(r.cogs)} label={`Cost of goods${r.noCost ? ` (${r.noCost} orders without cost)` : ""}`} />
        <Stat icon={Wallet} value={money(r.gross)} label={`Gross profit${pct(r.gross, r.revenue)}`} color="green" />
        <Stat icon={Receipt} value={money(r.expTotal)} label="Expenses" color="amber" />
        <Stat icon={Banknote} value={money(r.net)} label={`Net profit${pct(r.net, r.revenue)}`} color={r.net < 0 ? "red" : "green"} />
        <Stat icon={Undo2} value={money(r.returnedValue)} label={`${r.returned.length} returned or failed`} color="red" />
        <Stat icon={Truck} value={money(transitValue)} label="In transit now (not yet revenue)" />
        <Stat icon={Banknote} value={money(owedTotal)} label={`Courier owes you (${owed.length} orders)`} color="amber" />
      </div>

      <div className="card">
        <div className="toolbar">
          <h2 style={{ flex: 1 }}>Cash with the courier</h2>
          {!picked && <ExportButton name="courier-owed" rows={owed} columns={[["Order", (o) => o.id], ["Customer", (o) => o.customer.name], ["Phone", (o) => o.customer.phone], ["Delivered", (o) => ts(o.deliveredAt || o.createdAt)], ["Amount", (o) => o.total]]} />}
          {picked ? (
            <>
              <span className="muted">{picked.size} selected · {money(pickedTotal)}</span>
              <button className="btn" onClick={() => setPicked(null)}>Cancel</button>
            </>
          ) : owed.length > 0 && <button className="btn primary" onClick={() => setPicked(new Set(owed.map((o) => o.id)))}>Record remittance</button>}
        </div>
        {owed.length === 0 ? <Empty>The courier has paid you for every delivered order.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr>{picked && <th />}<th>Order</th><th>Customer</th><th>Delivered</th><th>Amount</th></tr></thead>
            <tbody>
              {owed.map((o) => (
                <tr key={o.id}>
                  {picked && <td><input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} /></td>}
                  <td>#{o.id.slice(0, 6)}</td><td>{o.customer.name}</td><td>{fmtDate(o.deliveredAt || o.createdAt)}</td><td>{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {picked && picked.size > 0 && (
          <div className="toolbar" style={{ borderTop: "1px solid var(--line)", borderBottom: 0 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Payment reference (bank transfer ID, courier statement…)" value={ref} onChange={(e) => setRef(e.target.value)} />
            <button className="btn primary" disabled={busy} onClick={saveRemit}>Confirm {money(pickedTotal)} received</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <h2 style={{ flex: 1 }}>Expenses</h2>
          <ExportButton name="expenses" rows={r.exps} columns={[["Date", (e) => ymd(ts(e.date))], ["Category", (e) => e.category], ["Note", (e) => e.note], ["Amount", (e) => e.amount]]} />
          <button className="btn primary" onClick={() => setExp({ category: "Advertising", amount: "", note: "", date: ymd(new Date()) })}><Plus size={16} />Add expense</button>
        </div>
        {r.exps.length === 0 ? <Empty>No expenses in this range.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Amount</th><th /></tr></thead>
            <tbody>
              {r.exps.map((e) => (
                <tr key={e.id}>
                  <td>{ts(e.date)?.toLocaleDateString()}</td><td><Badge color="gray">{e.category}</Badge></td><td>{e.note}</td><td>{money(e.amount)}</td>
                  <td className="actions">
                    <button className="btn sm" onClick={() => setExp({ ...e, date: ymd(ts(e.date)) })}><Pencil size={14} />Edit</button>{" "}
                    <button className="btn sm" onClick={() => run(() => api.setActive({ collection: "expenses", id: e.id, isActive: false }), "Expense removed")}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {Object.entries(r.byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                <tr key={c}><td /><td className="muted">{c}</td><td /><td><b>{money(v)}</b></td><td /></tr>
              ))}
            </tfoot>
          </table></div>
        )}
      </div>

      <div className="card">
        <div className="toolbar"><h2>Profit by product</h2></div>
        {r.byProduct.length === 0 ? <Empty>No delivered orders in this range.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Product</th><th>Units</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr></thead>
            <tbody>
              {r.byProduct.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td><td>{b.units}</td><td>{money(b.revenue)}</td>
                  <td>{money(b.cost)}{b.noCost && <span className="muted"> (some without cost)</span>}</td>
                  <td><b>{money(b.revenue - b.cost)}</b></td><td>{b.revenue ? Math.round(((b.revenue - b.cost) / b.revenue) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {remits.length > 0 && (
        <div className="card">
          <div className="toolbar"><h2>Remittance history</h2></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Received</th><th>Reference</th><th>Orders</th><th>Amount</th></tr></thead>
            <tbody>
              {[...remits].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map((m) => (
                <tr key={m.id}><td>{fmtDate(m.createdAt)}</td><td>{m.reference || <span className="muted">—</span>}</td><td>{m.orderIds.length}</td><td>{money(m.amount)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {exp && (
        <Modal title={exp.id ? "Edit expense" : "Add expense"} onClose={() => setExp(null)}
          footer={<><button className="btn" onClick={() => setExp(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !(Number(exp.amount) > 0) || !exp.date} onClick={saveExp}>Save</button></>}>
          <div className="row">
            <Field label="Date"><input className="input" type="date" value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} /></Field>
            <Field label="Amount"><input className="input" type="number" min="0" step="0.01" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} /></Field>
          </div>
          <Field label="Category">
            <select className="select" value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Note"><input className="input" value={exp.note} onChange={(e) => setExp({ ...exp, note: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}

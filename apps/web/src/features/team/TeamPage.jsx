import { useState } from "react";
import { collection } from "firebase/firestore";
import { BadgeDollarSign, KeyRound, Plus, Target } from "lucide-react";
import { sendPasswordResetEmail } from "firebase/auth";
import { api, auth, db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, ExportButton, Field, Modal, PageHead, Progress, useAction, useToast } from "../../components/ui";
import RangePicker from "../../components/RangePicker";
import { RANGE_PRESETS, TARGET_KEYS, agentStats, fmtCommission, money, monthRange, thisMonth, ymd } from "../../lib/constants";

const blank = { name: "", email: "", password: "", role: "agent" };

export default function Users() {
  const run = useAction();
  const toast = useToast();
  const { profile } = useAuth();
  const { data, loading } = useLive(() => collection(db, "users"), []);
  const orders = useLive(() => collection(db, "orders"), []).data;
  const [range, setRange] = useState(() => RANGE_PRESETS["This month"]().map(ymd));
  const [comm, setComm] = useState(null); // {user, type, value}
  const [pay, setPay] = useState(null);   // {user, amount}
  const [form, setForm] = useState(null);
  const [month, setMonth] = useState(thisMonth);
  const [tgt, setTgt] = useState(null);   // {user, orders, delivered, revenue}
  const targets = useLive(() => collection(db, "targets"), []).data;
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.createUser(form), "User created");
    setBusy(false);
    if (ok) setForm(null);
  };

  const saveComm = async () => {
    setBusy(true);
    const ok = await run(() => api.setCommission({ userId: comm.user.id, type: comm.type, value: comm.value }), "Commission updated");
    setBusy(false);
    if (ok) setComm(null);
  };
  const doPay = async () => {
    setBusy(true);
    let res;
    const ok = await run(async () => { res = await api.payCommissions({ agentId: pay.user.id }); });
    setBusy(false);
    if (ok) { setPay(null); toast(`Paid ${money(res.amount)} for ${res.orders} orders, added to expenses`); }
  };
  const saveTarget = async () => {
    setBusy(true);
    const ok = await run(() => api.setTarget({ agentId: tgt.user.id, month, orders: tgt.orders, delivered: tgt.delivered, revenue: tgt.revenue }), "Target saved");
    setBusy(false);
    if (ok) setTgt(null);
  };
  const monthBoard = data.filter((u) => u.role === "agent" && u.isActive).map((u) => ({
    u, s: agentStats(orders.filter((o) => o.agentId === u.id), monthRange(month)),
    t: targets.find((t) => t.agentId === u.id && t.month === month) || {},
  }));
  const board = data.filter((u) => u.role === "agent")
    .map((u) => ({ u, ...agentStats(orders.filter((o) => o.agentId === u.id), range) }))
    .sort((a, b) => b.revenue - a.revenue || b.delivered - a.delivered);

  return (
    <>
      <PageHead title="Team" sub="Agents and admins. Deactivating keeps all their history.">
        <button className="btn primary" onClick={() => setForm(blank)}><Plus size={16} />New user</button>
      </PageHead>
      <div className="card tablewrap">
        {!loading && data.length === 0 ? <Empty>No users.</Empty> : (
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Commission</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "inactive"}>
                  <td>{u.name}</td><td>{u.email}</td>
                  <td><Badge color={u.role === "admin" ? "blue" : "gray"}>{u.role}</Badge></td>
                  <td>{u.role === "agent" ? fmtCommission(u.commission) : <span className="muted">—</span>}</td>
                  <td><Badge color={u.isActive ? "green" : "gray"}>{u.isActive ? "Active" : "Inactive"}</Badge></td>
                  <td className="actions">
                    {u.role === "agent" && (
                      <><button className="btn sm" onClick={() => setComm({ user: u, type: u.commission?.type || "flat", value: u.commission?.value ?? "" })}>
                        <BadgeDollarSign size={14} />Commission</button>{" "}</>
                    )}
                    <button className="btn sm" title="Email a password reset link" onClick={() => run(() => sendPasswordResetEmail(auth, u.email), `Reset link sent to ${u.email}`)}>
                      <KeyRound size={14} />Reset password</button>{" "}
                    {u.id !== profile.id && (
                      <button className="btn sm" onClick={() => run(() => api.setActive({ collection: "users", id: u.id, isActive: !u.isActive }))}>
                        {u.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="toolbar">
          <h2 style={{ flex: 1 }}>Agent leaderboard</h2>
          <RangePicker range={range} onChange={setRange} />
          <ExportButton name="leaderboard" rows={board} columns={[
            ["Agent", (b) => b.u.name], ["Orders", (b) => b.orders], ["Delivered", (b) => b.delivered], ["Returned/failed", (b) => b.lost],
            ["Delivery rate %", (b) => b.deliveryRate ?? ""], ["Revenue", (b) => b.revenue], ["Commission", (b) => b.commission], ["Unpaid commission", (b) => b.unpaid],
          ]} />
        </div>
        {board.length === 0 ? <Empty>No agents yet.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>#</th><th>Agent</th><th>Orders</th><th>Delivered</th><th>Returned/failed</th><th>Delivery rate</th><th>Revenue</th><th>Commission</th><th>Unpaid (all time)</th><th /></tr></thead>
            <tbody>
              {board.map((b, i) => (
                <tr key={b.u.id} className={b.u.isActive ? "" : "inactive"}>
                  <td>{i + 1}</td><td>{b.u.name}</td><td>{b.orders}</td><td>{b.delivered}</td><td>{b.lost}</td>
                  <td>{b.deliveryRate === null ? <span className="muted">—</span> : `${b.deliveryRate}%`}</td>
                  <td>{money(b.revenue)}</td><td>{money(b.commission)}</td><td><b>{money(b.unpaid)}</b></td>
                  <td className="actions">
                    {b.unpaid > 0 && <button className="btn sm primary" onClick={() => setPay({ user: b.u, amount: b.unpaid })}>Pay</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="toolbar">
          <h2 style={{ flex: 1 }}>Monthly targets</h2>
          <input className="input" style={{ width: "auto" }} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        {monthBoard.length === 0 ? <Empty>No active agents.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Agent</th>{TARGET_KEYS.map(([, l]) => <th key={l}>{l}</th>)}<th /></tr></thead>
            <tbody>
              {monthBoard.map(({ u, s, t }) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  {TARGET_KEYS.map(([k]) => <td key={k}><Progress value={s[k]} target={t[k]} format={k === "revenue" ? money : undefined} /></td>)}
                  <td className="actions">
                    <button className="btn sm" onClick={() => setTgt({ user: u, orders: t.orders ?? "", delivered: t.delivered ?? "", revenue: t.revenue ?? "" })}><Target size={14} />Set target</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {tgt && (
        <Modal title={`Target for ${tgt.user.name}, ${month}`} onClose={() => setTgt(null)}
          footer={<><button className="btn" onClick={() => setTgt(null)}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={saveTarget}>Save</button></>}>
          <div className="row">
            {TARGET_KEYS.map(([k, l]) => (
              <Field key={k} label={l}><input className="input" type="number" min="0" step={k === "revenue" ? "0.01" : "1"} value={tgt[k]} onChange={(e) => setTgt({ ...tgt, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <p className="muted">Leave a box at 0 for no target. The agent sees their progress on My performance.</p>
        </Modal>
      )}

      {comm && (
        <Modal title={`Commission — ${comm.user.name}`} onClose={() => setComm(null)}
          footer={<><button className="btn" onClick={() => setComm(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || comm.value === "" || Number(comm.value) < 0} onClick={saveComm}>Save</button></>}>
          <div className="row">
            <Field label="Type">
              <select className="select" value={comm.type} onChange={(e) => setComm({ ...comm, type: e.target.value })}>
                <option value="flat">Fixed amount per delivered order</option>
                <option value="percent">Percent of delivered order total</option>
              </select>
            </Field>
            <Field label={comm.type === "percent" ? "Percent" : "Amount"}>
              <input className="input" type="number" min="0" step="0.01" max={comm.type === "percent" ? 100 : undefined} value={comm.value} onChange={(e) => setComm({ ...comm, value: e.target.value })} />
            </Field>
          </div>
          <p className="muted">Applies to orders delivered from now on. Orders already delivered keep the commission they earned.</p>
        </Modal>
      )}

      {pay && (
        <Modal title={`Pay ${pay.user.name}`} onClose={() => setPay(null)}
          footer={<><button className="btn" onClick={() => setPay(null)}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={doPay}>Mark {money(pay.amount)} as paid</button></>}>
          <p>This marks every unpaid commission for {pay.user.name} as paid and adds a {money(pay.amount)} Commissions expense on the Finance page. Pay them outside the app first.</p>
        </Modal>
      )}

      {form && (
        <Modal title="New user" onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !form.name || !form.email || form.password.length < 6} onClick={save}>Create</button></>}>
          <Field label="Name"><input className="input" value={form.name} onChange={set("name")} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Temporary password (min 6)"><input className="input" type="password" value={form.password} onChange={set("password")} /></Field>
          <Field label="Role">
            <select className="select" value={form.role} onChange={set("role")}><option value="agent">Agent</option><option value="admin">Admin</option></select>
          </Field>
        </Modal>
      )}
    </>
  );
}

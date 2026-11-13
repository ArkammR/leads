import { useMemo, useState } from "react";
import { collection } from "firebase/firestore";
import { History, Search, Upload, UserRoundCog } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, Field, Modal, PageHead, useAction, useToast } from "../../components/ui";
import HistoryModal from "../../components/HistoryModal";
import { fmtDate } from "../../lib/constants";
import { parseCsv } from "./parseCsv";

export default function Leads() {
  const run = useAction();
  const toast = useToast();
  const leads = useLive(() => collection(db, "leads"), []);
  const users = useLive(() => collection(db, "users"), []).data;
  const agents = users.filter((u) => u.role === "agent" && u.isActive);
  const uname = (id) => users.find((u) => u.id === id)?.name || "—";

  const [q, setQ] = useState("");
  const [imp, setImp] = useState(null); // {rows, mode, agentId, fileName}
  const [result, setResult] = useState(null);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [agentFilter, setAgentFilter] = useState("");
  const [move, setMove] = useState(null); // target agentId

  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return leads.data
      .filter((l) => !agentFilter || l.assignedTo === agentFilter)
      .filter((l) => !s || [l.name, l.phone, l.email].some((v) => (v || "").toLowerCase().includes(s)))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }, [leads.data, q, agentFilter]);

  const pick = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const parsed = parseCsv(await f.text());
    if (!parsed.length) return toast("No rows found in that file", "err");
    setImp({ rows: parsed, mode: "roundRobin", agentId: agents[0]?.id || "", fileName: f.name });
  };

  const doImport = async () => {
    setBusy(true);
    let res;
    const ok = await run(async () => { res = await api.importLeads({ rows: imp.rows, mode: imp.mode, agentId: imp.agentId }); });
    setBusy(false);
    if (ok) { setImp(null); setResult(res); }
  };

  const toggle = (id) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const allSel = rows.length > 0 && rows.every((l) => sel.has(l.id));
  const doMove = async () => {
    setBusy(true);
    let res;
    const ok = await run(async () => { res = await api.reassignLeads({ leadIds: [...sel], agentId: move }); });
    setBusy(false);
    if (ok) { toast(`${res.moved} leads reassigned`); setMove(null); setSel(new Set()); }
  };

  return (
    <>
      <PageHead title="Leads" sub="Upload a CSV (name, phone, email). Duplicates are skipped automatically.">
        <label className="btn primary" style={{ cursor: "pointer" }}>
          <Upload size={16} />Import CSV
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { pick(e); e.target.value = ""; }} />
        </label>
      </PageHead>

      <div className="card">
        <div className="toolbar">
          <div className="search"><Search size={16} /><input className="input" placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select" style={{ width: "auto" }} value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
            <option value="">All agents</option>
            {users.filter((u) => u.role === "agent").map((u) => <option key={u.id} value={u.id}>{u.name}{u.isActive ? "" : " (inactive)"}</option>)}
          </select>
          <span className="muted">{rows.length} leads</span>
          {sel.size > 0 && (
            <button className="btn primary" onClick={() => setMove(agents[0]?.id || "")}><UserRoundCog size={16} />Reassign {sel.size}</button>
          )}
        </div>
        {!leads.loading && rows.length === 0 ? <Empty>No leads yet. Import a CSV to get started.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th><input type="checkbox" aria-label="Select all" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((l) => l.id)))} /></th><th>Name</th><th>Phone</th><th>Status</th><th>Agent</th><th>Callback</th><th /></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className={l.isActive ? "" : "inactive"}>
                  <td><input type="checkbox" aria-label="Select" checked={sel.has(l.id)} onChange={() => toggle(l.id)} /></td>
                  <td><b>{l.name || "—"}</b><div className="muted">{l.email}</div></td>
                  <td>{l.phone}</td>
                  <td><Badge>{l.status}</Badge></td>
                  <td>{uname(l.assignedTo)}</td>
                  <td>{fmtDate(l.callbackAt)}</td>
                  <td className="actions">
                    <button className="btn sm" onClick={() => setHist(l)}><History size={14} />History</button>{" "}
                    <button className="btn sm" onClick={() => run(() => api.setActive({ collection: "leads", id: l.id, isActive: !l.isActive }))}>
                      {l.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {imp && (
        <Modal title="Import leads" onClose={() => setImp(null)}
          footer={<><button className="btn" onClick={() => setImp(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || (imp.mode === "manual" && !imp.agentId) || (imp.mode === "roundRobin" && !agents.length)} onClick={doImport}>
              {busy ? "Importing…" : `Import ${imp.rows.length} rows`}</button></>}>
          <p><b>{imp.fileName}</b> — {imp.rows.length} rows</p>
          <Field label="Assignment">
            <select className="select" value={imp.mode} onChange={(e) => setImp({ ...imp, mode: e.target.value })}>
              <option value="roundRobin">Round-robin across all active agents ({agents.length})</option>
              <option value="manual">All to one agent</option>
            </select>
          </Field>
          {imp.mode === "manual" && (
            <Field label="Agent">
              <select className="select" value={imp.agentId} onChange={(e) => setImp({ ...imp, agentId: e.target.value })}>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
        </Modal>
      )}

      {move !== null && (
        <Modal title={`Reassign ${sel.size} leads`} onClose={() => setMove(null)}
          footer={<><button className="btn" onClick={() => setMove(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !move} onClick={doMove}>Reassign</button></>}>
          <Field label="New agent">
            <select className="select" value={move} onChange={(e) => setMove(e.target.value)}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <p className="muted">Callbacks and statuses stay as they are. Orders already created keep their original agent and commission.</p>
        </Modal>
      )}

      {result && (
        <Modal title="Import complete" onClose={() => setResult(null)} footer={<button className="btn primary" onClick={() => setResult(null)}>Done</button>}>
          <p><b>{result.created}</b> leads created, <b>{result.duplicates.length}</b> skipped.</p>
          {result.duplicates.length > 0 && (
            <div className="tablewrap"><table>
              <thead><tr><th><input type="checkbox" aria-label="Select all" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((l) => l.id)))} /></th><th>Name</th><th>Phone</th><th>Reason</th></tr></thead>
              <tbody>{result.duplicates.map((d, i) => <tr key={i}><td>{d.name}</td><td>{d.phone}</td><td>{d.reason}</td></tr>)}</tbody>
            </table></div>
          )}
        </Modal>
      )}

      {hist && <HistoryModal coll="leads" id={hist.id} title={hist.name} users={users} onClose={() => setHist(null)} />}
    </>
  );
}

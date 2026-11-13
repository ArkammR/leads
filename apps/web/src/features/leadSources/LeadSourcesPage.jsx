import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { Copy, KeyRound, Pause, Play, Plug, Plus, Settings } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, Field, Modal, PageHead, useAction, useToast } from "../../components/ui";
import { fmtDate } from "../../lib/constants";
import { SETUP, SOURCE_LABEL } from "./sources";

const TYPES = ["facebook", "google", "tiktok", "website", "whatsapp"];
const EVENT_TONE = { created: "green", duplicate: "amber", rejected: "red", error: "red", test: "blue" };

export default function LeadSourcesPage() {
  const run = useAction();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const sources = useLive(() => collection(db, "leadSources"), []);
  const events = useLive(() => query(collection(db, "leadEvents"), orderBy("createdAt", "desc"), limit(100)), []).data;
  const users = useLive(() => collection(db, "users"), []).data;
  const agents = users.filter((u) => u.role === "agent" && u.isActive);
  const [edit, setEdit] = useState(null); // {id?, type, name, mode, agentId, isActive, waPhoneNumberId}
  const [busy, setBusy] = useState(false);
  const [evFilter, setEvFilter] = useState("");

  // Back from Facebook sign-in
  useEffect(() => {
    const ok = params.get("connected"), err = params.get("error");
    if (ok) toast("Facebook connected. New leads will import automatically.");
    if (err) toast(err, "err");
    if (ok || err) setParams({}, { replace: true });
  }, [params, setParams, toast]);

  const origin = window.location.origin;
  const hookUrl = (s, withKey = true) => `${origin}/webhook/leads/${s.id}${withKey ? `?key=${s.key}` : ""}`;
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => toast(`${what} copied`), () => toast("Copy failed", "err"));
  const srcName = (id) => sources.data.find((s) => s.id === id)?.name || "—";

  const save = async () => {
    setBusy(true);
    let res;
    const ok = await run(async () => { res = await api.saveLeadSource(edit); });
    setBusy(false);
    if (ok) {
      setEdit(null);
      if (!edit.id && edit.type === "facebook") connectFb(res.id);
      else toast(edit.id ? "Saved" : "Source added. Follow the setup steps on its card.");
    }
  };
  const connectFb = (id) => run(async () => { const { url } = await api.startMetaConnect({ id }); window.location.href = url; });

  const list = [...sources.data].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  const shown = events.filter((e) => !evFilter || e.sourceId === evFilter);

  return (
    <>
      <PageHead title="Lead sources" sub="Connect ad platforms and forms so leads arrive automatically. Manual CSV / Excel upload stays on the Leads page.">
        <button className="btn primary" onClick={() => setEdit({ type: "facebook", name: "", mode: "roundRobin", agentId: agents[0]?.id || "", isActive: true })}>
          <Plus size={16} />Add source
        </button>
      </PageHead>

      {!sources.loading && list.length === 0 && (
        <div className="card"><Empty>No sources yet. Add Facebook, Google Ads, TikTok, your website or WhatsApp to start importing leads automatically.</Empty></div>
      )}

      <div className="grid sources">
        {list.map((s) => {
          const setup = SETUP[s.type];
          const st = { received: s.stats?.received || 0, created: s.stats?.created || 0 };
          return (
            <div key={s.id} className="card">
              <div className="toolbar">
                <h2 style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Plug size={16} />{s.name}</h2>
                <Badge color="gray">{SOURCE_LABEL[s.type]}</Badge>
                <Badge color={s.isActive ? "green" : "gray"}>{s.isActive ? "Live" : "Paused"}</Badge>
                <span className="grow" />
                <button className="btn sm" title="Settings" onClick={() => setEdit({ id: s.id, type: s.type, name: s.name, mode: s.mode, agentId: s.agentId || agents[0]?.id || "", isActive: s.isActive, waPhoneNumberId: s.waPhoneNumberId || "" })}><Settings size={14} /></button>
                <button className="btn sm" title={s.isActive ? "Pause" : "Resume"} onClick={() => run(() => api.saveLeadSource({ id: s.id, mode: s.mode, agentId: s.agentId, waPhoneNumberId: s.waPhoneNumberId, isActive: !s.isActive }))}>
                  {s.isActive ? <Pause size={14} /> : <Play size={14} />}
                </button>
              </div>
              <div className="card-pad">
              <p className="muted" style={{ marginTop: 0 }}>{setup.blurb}</p>
              <p>
                <b>{st.created}</b> leads created from <b>{st.received}</b> received · last lead {s.lastLeadAt ? fmtDate(s.lastLeadAt) : "never"}
                {" · "}{s.mode === "manual" ? `all to ${users.find((u) => u.id === s.agentId)?.name || "—"}` : "round-robin"}
              </p>

              {s.type === "facebook" ? (
                <>
                  {s.pages?.length > 0
                    ? <p>Connected Pages: {s.pages.map((p) => <Badge key={p.id} color={p.subscribed ? "green" : "red"}>{p.name}</Badge>)}</p>
                    : <p className="muted">Not connected yet.</p>}
                  <button className="btn primary" onClick={() => connectFb(s.id)}>{s.pages?.length ? "Reconnect / add Pages" : "Connect Facebook"}</button>
                </>
              ) : (
                <>
                  <Field label="Webhook URL">
                    <div className="copyrow">
                      <input className="input grow" readOnly value={hookUrl(s, s.type !== "google")} onFocus={(e) => e.target.select()} />
                      <button className="btn sm" onClick={() => copy(hookUrl(s, s.type !== "google"), "URL")}><Copy size={14} /></button>
                    </div>
                  </Field>
                  {s.type === "google" && (
                    <Field label="Key">
                      <div className="copyrow">
                        <input className="input grow" readOnly value={s.key} onFocus={(e) => e.target.select()} />
                        <button className="btn sm" onClick={() => copy(s.key, "Key")}><Copy size={14} /></button>
                      </div>
                    </Field>
                  )}
                  <button className="btn sm" onClick={() => window.confirm("Make a new key? The old URL stops working until you paste the new one into the platform.") && run(() => api.rotateLeadSourceKey({ id: s.id }), "New key made")}>
                    <KeyRound size={14} />New key
                  </button>
                </>
              )}
              {s.type === "whatsapp" && s.waPhoneNumberId && <p className="muted">WhatsApp Cloud API phone number ID: {s.waPhoneNumberId} (Meta webhook: {origin}/webhook/meta)</p>}

              <details style={{ marginTop: 12 }}>
                <summary>Setup steps</summary>
                <ol>{setup.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
              </details>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Recent activity</h2>
          <select className="select" style={{ width: "auto" }} value={evFilter} onChange={(e) => setEvFilter(e.target.value)}>
            <option value="">All sources</option>
            {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {shown.length === 0 ? <Empty>Nothing received yet. Send a test lead from the platform and it shows up here.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>When</th><th>Source</th><th>Result</th><th>Lead</th><th>Details</th></tr></thead>
            <tbody>{shown.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.createdAt)}</td>
                <td>{srcName(e.sourceId)}</td>
                <td><Badge color={EVENT_TONE[e.status]}>{e.status}</Badge></td>
                <td>{e.name || ""} {e.phone || ""}</td>
                <td className="muted">{e.reason || (e.assignedTo ? `assigned to ${users.find((u) => u.id === e.assignedTo)?.name || "—"}` : e.status === "created" ? "unassigned: no active agent" : "")}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : "Add lead source"} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || (edit.mode === "manual" && !edit.agentId)} onClick={save}>
              {busy ? "Saving…" : edit.id ? "Save" : edit.type === "facebook" ? "Add and connect Facebook" : "Add source"}</button></>}>
          {!edit.id && (
            <Field label="Platform">
              <select className="select" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{SOURCE_LABEL[t]}</option>)}
              </select>
            </Field>
          )}
          <p className="muted">{SETUP[edit.type].blurb}</p>
          <Field label="Name (for your reference)">
            <input className="input" placeholder={SOURCE_LABEL[edit.type]} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label="Assign new leads">
            <select className="select" value={edit.mode} onChange={(e) => setEdit({ ...edit, mode: e.target.value })}>
              <option value="roundRobin">Round-robin across all active agents ({agents.length})</option>
              <option value="manual">All to one agent</option>
            </select>
          </Field>
          {edit.mode === "manual" && (
            <Field label="Agent">
              <select className="select" value={edit.agentId} onChange={(e) => setEdit({ ...edit, agentId: e.target.value })}>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          {edit.type === "whatsapp" && (
            <Field label="WhatsApp Cloud API phone number ID (leave empty if you use Twilio)">
              <input className="input" value={edit.waPhoneNumberId || ""} onChange={(e) => setEdit({ ...edit, waPhoneNumberId: e.target.value })} />
            </Field>
          )}
          {edit.id && (
            <label><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> Live (untick to pause)</label>
          )}
        </Modal>
      )}
    </>
  );
}

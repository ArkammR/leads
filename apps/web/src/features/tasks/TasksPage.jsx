import { useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { CheckCircle2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, ExportButton, Field, Modal, PageHead, useAction } from "../../components/ui";
import { PRIORITY_TONE, fmtDate, ts } from "../../lib/constants";

const p2 = (n) => String(n).padStart(2, "0");
const toLocalInput = (t) => { const d = ts(t); return d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` : ""; };
const overdue = (t) => t.status === "open" && t.dueAt && t.dueAt.toMillis() < Date.now();
const rank = { high: 0, normal: 1, low: 2 };

// Admin assigns tasks to anyone; staff see their own and mark them done.
export default function Tasks() {
  const { profile } = useAuth();
  const admin = profile.role === "admin";
  const run = useAction();
  const { data, loading } = useLive(
    () => query(collection(db, "tasks"), ...(admin ? [] : [where("assignedTo", "==", profile.id)])),
    [admin, profile.id]
  );
  const users = useLive(() => (admin ? collection(db, "users") : null), [admin]).data.filter((u) => u.isActive);
  const [show, setShow] = useState("open");
  const [who, setWho] = useState("");
  const [form, setForm] = useState(null);
  const [done, setDone] = useState(null); // {task, note}
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => data
    .filter((t) => t.isActive !== false && (show === "all" || t.status === show) && (!who || t.assignedTo === who))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1)
      || (a.dueAt?.toMillis() ?? Infinity) - (b.dueAt?.toMillis() ?? Infinity)
      || rank[a.priority] - rank[b.priority]), [data, show, who]);

  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.saveTask({
      id: form.id, title: form.title, details: form.details, assignedTo: form.assignedTo, priority: form.priority,
      dueAtMs: form.due ? new Date(form.due).getTime() : null,
    }), form.id ? "Task updated" : "Task assigned");
    setBusy(false);
    if (ok) setForm(null);
  };
  const finish = async () => {
    setBusy(true);
    const ok = await run(() => api.setTaskStatus({ id: done.task.id, status: "done", note: done.note }), "Task done");
    setBusy(false);
    if (ok) setDone(null);
  };
  const blank = () => ({ title: "", details: "", assignedTo: users.find((u) => u.role === "agent")?.id || users[0]?.id || "", priority: "normal", due: "" });

  return (
    <>
      <PageHead title={admin ? "Tasks" : "My tasks"} sub={admin ? "Give staff follow-ups with a due date. They see them under My tasks." : "Tasks from your admin. Overdue ones are highlighted."}>
        <select className="select" style={{ width: "auto" }} value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="open">Open</option><option value="done">Done</option><option value="all">All</option>
        </select>
        {admin && (
          <>
            <select className="select" style={{ width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Everyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <ExportButton name="tasks" rows={rows} columns={[
              ["Title", (t) => t.title], ["Assigned to", (t) => t.assignedName], ["Priority", (t) => t.priority], ["Due", (t) => ts(t.dueAt)],
              ["Status", (t) => t.status], ["Done at", (t) => ts(t.doneAt)], ["Note", (t) => t.doneNote], ["Details", (t) => t.details],
            ]} />
            <button className="btn primary" onClick={() => setForm(blank())}><Plus size={16} />New task</button>
          </>
        )}
      </PageHead>

      <div className="card tablewrap">
        {!loading && rows.length === 0 ? <Empty>{show === "open" ? "No open tasks." : "No tasks."}</Empty> : (
          <table>
            <thead><tr><th>Task</th>{admin && <th>Assigned to</th>}<th>Priority</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={overdue(t) ? "warn" : ""}>
                  <td><b>{t.title}</b>{t.details && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{t.details}</div>}
                    {t.status === "done" && t.doneNote && <div className="muted">Note: {t.doneNote}</div>}</td>
                  {admin && <td>{t.assignedName}</td>}
                  <td><Badge color={PRIORITY_TONE[t.priority]}>{t.priority}</Badge></td>
                  <td>{t.dueAt ? fmtDate(t.dueAt) : <span className="muted">—</span>}{overdue(t) && <div><Badge color="red">Overdue</Badge></div>}</td>
                  <td><Badge color={t.status === "done" ? "green" : "amber"}>{t.status === "done" ? "Done" : "Open"}</Badge>
                    {t.doneAt && <div className="muted">{fmtDate(t.doneAt)}</div>}</td>
                  <td className="actions">
                    {t.status === "open"
                      ? <button className="btn sm primary" onClick={() => setDone({ task: t, note: "" })}><CheckCircle2 size={14} />Done</button>
                      : <button className="btn sm" onClick={() => run(() => api.setTaskStatus({ id: t.id, status: "open" }), "Task reopened")}><RotateCcw size={14} />Reopen</button>}
                    {admin && (
                      <>{" "}<button className="btn sm" onClick={() => setForm({ ...t, due: toLocalInput(t.dueAt) })}><Pencil size={14} />Edit</button>{" "}
                        <button className="btn sm danger" onClick={() => run(() => api.setActive({ collection: "tasks", id: t.id, isActive: false }), "Task removed")}><Trash2 size={14} /></button></>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <Modal title={form.id ? "Edit task" : "New task"} onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !form.title.trim() || !form.assignedTo} onClick={save}>{form.id ? "Save" : "Assign"}</button></>}>
          <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Call back last week's Hold leads" /></Field>
          <Field label="Details"><textarea className="input" rows="3" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></Field>
          <div className="row">
            <Field label="Assign to">
              <select className="select" value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
              </select>
            </Field>
          </div>
          <Field label="Due (optional)"><input className="input" type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
        </Modal>
      )}

      {done && (
        <Modal title={`Done: ${done.task.title}`} onClose={() => setDone(null)}
          footer={<><button className="btn" onClick={() => setDone(null)}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={finish}>Mark done</button></>}>
          <Field label="Note for your admin (optional)"><textarea className="input" rows="3" value={done.note} onChange={(e) => setDone({ ...done, note: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}

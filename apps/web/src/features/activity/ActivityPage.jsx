import { useMemo, useState } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { Search } from "lucide-react";
import { db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, ExportButton, PageHead } from "../../components/ui";
import { fmtDate, ts } from "../../lib/constants";

// Area of the app, from the action prefix ("order.verify" → order).
const AREA = {
  order: ["Orders", "blue"], leads: ["Leads", "blue"], product: ["Products", "gray"], stock: ["Inventory", "gray"],
  expense: ["Finance", "green"], remittance: ["Finance", "green"], commission: ["Staff", "amber"], target: ["Staff", "amber"],
  user: ["Team", "amber"], users: ["Team", "amber"], task: ["Tasks", "gray"], tasks: ["Tasks", "gray"],
  announcement: ["Announcements", "gray"], announcements: ["Announcements", "gray"], attendance: ["Attendance", "gray"],
  products: ["Products", "gray"], expenses: ["Finance", "green"],
};
const area = (a) => AREA[a.action.split(".")[0]] || ["Other", "gray"];
const MAX = 1000;

// Admin-only "who did what". Per-lead and per-order timelines stay in their History buttons.
export default function Activity() {
  const { data, loading } = useLive(() => query(collection(db, "activity"), orderBy("createdAt", "desc"), limit(MAX)), []);
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const [kind, setKind] = useState("");
  const people = [...new Map(data.map((a) => [a.userId, a.userName || a.userId])).entries()];
  const kinds = [...new Set(data.map((a) => area(a)[0]))].sort();

  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return data.filter((a) => (!who || a.userId === who) && (!kind || area(a)[0] === kind) && (!s || `${a.summary} ${a.action}`.toLowerCase().includes(s)));
  }, [data, q, who, kind]);

  return (
    <>
      <PageHead title="Activity log" sub={`Who did what, newest first (last ${MAX} actions).`}>
        <ExportButton name="activity" rows={rows} columns={[
          ["When", (a) => ts(a.createdAt)], ["Who", (a) => a.userName], ["Role", (a) => a.role], ["Area", (a) => area(a)[0]], ["Action", (a) => a.action], ["Details", (a) => a.summary],
        ]} />
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <div className="search"><Search size={15} /><input className="input" placeholder="Search details…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select" style={{ width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className="select" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All areas</option>
            {kinds.map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        {!loading && rows.length === 0 ? <Empty>No activity yet. Actions show up here as people use the app.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>When</th><th>Who</th><th>Area</th><th>What happened</th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const [label, color] = area(a);
                return (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(a.createdAt)}</td>
                    <td>{a.userName}<div className="muted">{a.role}</div></td>
                    <td><Badge color={color}>{label}</Badge></td>
                    <td>{a.summary}<div className="muted">{a.action}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

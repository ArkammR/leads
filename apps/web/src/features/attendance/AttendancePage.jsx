import { useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { LogOut } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, ExportButton, PageHead, useAction } from "../../components/ui";
import RangePicker from "../../components/RangePicker";
import { PRESENCE, RANGE_PRESETS, breakMins, fmtMins, fmtTime, workedMins, ymd } from "../../lib/constants";

const lastOut = (a) => { const s = a.sessions || []; return s.length ? s[s.length - 1].out : null; };

// Admin: who is working now + daily records for everyone. Agent: own records only.
export default function Attendance() {
  const { profile } = useAuth();
  const admin = profile.role === "admin";
  const run = useAction();
  const [range, setRange] = useState(() => RANGE_PRESETS["This month"]().map(ymd));
  const [who, setWho] = useState("");
  const users = useLive(() => (admin ? collection(db, "users") : null), [admin]).data;
  const { data, loading } = useLive(
    () => query(collection(db, "attendance"), ...(admin ? [] : [where("userId", "==", profile.id)])),
    [admin, profile.id]
  );

  const rows = useMemo(() => data
    .filter((a) => a.date >= range[0] && a.date <= range[1] && (!who || a.userId === who))
    .sort((a, b) => b.date.localeCompare(a.date) || (a.userName || "").localeCompare(b.userName || "")), [data, range, who]);

  const totals = useMemo(() => {
    const t = {};
    for (const a of rows) {
      const k = a.userId; t[k] = t[k] || { name: a.userName, days: 0, worked: 0, brk: 0 };
      t[k].days++; t[k].worked += workedMins(a); t[k].brk += breakMins(a);
    }
    return Object.entries(t).sort((a, b) => b[1].worked - a[1].worked);
  }, [rows]);

  const live = users.filter((u) => u.isActive && u.presence && u.presence.state !== "out");
  const staff = users.filter((u) => u.isActive);

  return (
    <>
      <PageHead title={admin ? "Attendance" : "My attendance"} sub="Clock in, breaks and clock out from the sidebar. Hours count from clock in to clock out, minus breaks.">
        {admin && (
          <select className="select" style={{ width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <RangePicker range={range} onChange={setRange} />
        <ExportButton name="attendance" rows={rows} columns={[
          ["Date", (a) => a.date], ["Name", (a) => a.userName], ["Role", (a) => a.role],
          ["First in", (a) => fmtTime(a.firstIn)], ["Last out", (a) => (a.state === "out" ? fmtTime(lastOut(a)) : "")],
          ["Worked minutes", (a) => Math.round(workedMins(a))], ["Break minutes", (a) => Math.round(breakMins(a))], ["Status", (a) => a.state],
        ]} />
      </PageHead>

      {admin && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="toolbar"><h2>Working now ({live.length} of {staff.length})</h2></div>
          {live.length === 0 ? <Empty>Nobody is clocked in.</Empty> : (
            <div className="tablewrap"><table>
              <thead><tr><th>Name</th><th>Status</th><th>Since</th><th>Shift day</th><th /></tr></thead>
              <tbody>
                {live.map((u) => {
                  const [label, color] = PRESENCE[u.presence.state];
                  const stale = u.presence.day < ymd(new Date());
                  return (
                    <tr key={u.id} className={stale ? "warn" : ""}>
                      <td>{u.name}</td><td><Badge color={color}>{label}</Badge></td><td>{fmtTime(u.presence.since)}</td>
                      <td>{u.presence.day}{stale && <span className="muted"> · forgot to clock out?</span>}</td>
                      <td className="actions">
                        <button className="btn sm" onClick={() => run(() => api.clockAction({ action: "out", userId: u.id }), `${u.name} clocked out`)}><LogOut size={14} />Clock out</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {totals.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="toolbar"><h2>Totals for this range</h2></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th>Days</th><th>Worked</th><th>Breaks</th><th>Average per day</th></tr></thead>
            <tbody>
              {totals.map(([id, t]) => (
                <tr key={id}><td>{t.name}</td><td>{t.days}</td><td><b>{fmtMins(t.worked)}</b></td><td>{fmtMins(t.brk)}</td><td>{fmtMins(t.worked / t.days)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="card tablewrap">
        {!loading && rows.length === 0 ? <Empty>No attendance in this range.</Empty> : (
          <table>
            <thead><tr><th>Date</th>{admin && <th>Name</th>}<th>First in</th><th>Last out</th><th>Worked</th><th>Breaks</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const [label, color] = PRESENCE[a.state] || PRESENCE.out;
                return (
                  <tr key={`${a.userId}_${a.date}`}>
                    <td>{a.date}</td>{admin && <td>{a.userName}</td>}
                    <td>{fmtTime(a.firstIn)}</td><td>{a.state === "out" ? fmtTime(lastOut(a)) : "—"}</td>
                    <td><b>{fmtMins(workedMins(a))}</b></td><td>{fmtMins(breakMins(a))}</td>
                    <td><Badge color={color}>{a.state === "out" ? "Done" : label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

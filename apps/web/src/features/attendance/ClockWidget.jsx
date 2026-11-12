import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { Coffee, LogIn, LogOut, Play } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useAction } from "../../components/ui";
import { PRESENCE, fmtMins, workedMins } from "../../lib/constants";

// Sidebar clock in / break / clock out. State comes from users/{uid}.presence (live via AuthContext).
export default function ClockWidget() {
  const { profile } = useAuth();
  const run = useAction();
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(null);
  const [, tick] = useState(0);
  const p = profile.presence || { state: "out" };

  useEffect(() => {
    if (!p.day) return;
    return onSnapshot(doc(db, "attendance", `${profile.id}_${p.day}`), (s) => setToday(s.exists() ? s.data() : null), () => setToday(null));
  }, [profile.id, p.day]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const act = async (action, msg) => {
    setBusy(true);
    await run(() => api.clockAction({ action, tzOffsetMin: new Date().getTimezoneOffset() }), msg);
    setBusy(false);
  };
  const [label, color] = PRESENCE[p.state] || PRESENCE.out;

  return (
    <div className="clock">
      <div className="clock-head">
        <span className={"dot " + color} />{label}
        {today && p.state !== "out" && <span className="muted"> · {fmtMins(workedMins(today))} today</span>}
      </div>
      <div className="row">
        {p.state === "out" && <button className="btn sm primary" disabled={busy} onClick={() => act("in", "Clocked in")}><LogIn size={14} />Clock in</button>}
        {p.state === "in" && <button className="btn sm" disabled={busy} onClick={() => act("break", "Break started")}><Coffee size={14} />Break</button>}
        {p.state === "break" && <button className="btn sm primary" disabled={busy} onClick={() => act("resume", "Back at work")}><Play size={14} />Resume</button>}
        {p.state !== "out" && <button className="btn sm" disabled={busy} onClick={() => act("out", "Clocked out")}><LogOut size={14} />Clock out</button>}
      </div>
    </div>
  );
}

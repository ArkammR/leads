import { useState } from "react";
import { Zap } from "lucide-react";
import { useAuth } from "./AuthContext";

export default function Login({ setupNeeded, blocked }) {
  const { login, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { await login(email, pw); } catch { setErr("Invalid email or password."); }
    setBusy(false);
  };

  return (
    <div className="authwrap">
      <div className="card authcard">
        <div className="brand"><span className="logo"><Zap size={18} /></span>Leads CRM</div>
        {setupNeeded && (
          <div className="notice">
            Firebase isn't configured yet. Fill in <b>web/.env</b> (see <b>.env.example</b>) and restart the dev server.
          </div>
        )}
        {blocked ? (
          <>
            <p className="err">This account has no active profile. Ask an admin to activate it.</p>
            <button className="btn" onClick={logout}>Sign out</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="field"><label>Email</label>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={setupNeeded} /></div>
            <div className="field"><label>Password</label>
              <input className="input" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} disabled={setupNeeded} /></div>
            {err && <p className="err">{err}</p>}
            <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy || setupNeeded}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

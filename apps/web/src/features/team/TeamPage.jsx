import { useState } from "react";
import { collection } from "firebase/firestore";
import { Plus } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, Field, Modal, PageHead, useAction } from "../../components/ui";

const blank = { name: "", email: "", password: "", role: "agent" };

export default function Users() {
  const run = useAction();
  const { profile } = useAuth();
  const { data, loading } = useLive(() => collection(db, "users"), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.createUser(form), "User created");
    setBusy(false);
    if (ok) setForm(null);
  };

  return (
    <>
      <PageHead title="Team" sub="Agents and admins. Deactivating keeps all their history.">
        <button className="btn primary" onClick={() => setForm(blank)}><Plus size={16} />New user</button>
      </PageHead>
      <div className="card tablewrap">
        {!loading && data.length === 0 ? <Empty>No users.</Empty> : (
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "inactive"}>
                  <td>{u.name}</td><td>{u.email}</td>
                  <td><Badge color={u.role === "admin" ? "blue" : "gray"}>{u.role}</Badge></td>
                  <td><Badge color={u.isActive ? "green" : "gray"}>{u.isActive ? "Active" : "Inactive"}</Badge></td>
                  <td className="actions">
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

import { useEffect, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { Pin, Plus, Trash2 } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useLive } from "../../hooks/useLive";
import { Badge, Empty, Field, Modal, PageHead, useAction } from "../../components/ui";
import { fmtDate } from "../../lib/constants";

const AUDIENCE = { all: "Everyone", agent: "Agents", admin: "Admins" };

export default function Announcements() {
  const { profile } = useAuth();
  const admin = profile.role === "admin";
  const run = useAction();
  const { data, loading } = useLive(() => query(collection(db, "announcements"), where("isActive", "==", true)), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  // Read marker as it was when the page opened, so new posts stay highlighted while you read them.
  const [seenAt] = useState(() => profile.announcementsSeenAt?.toMillis?.() || 0);

  const list = data
    .filter((a) => admin || a.audience === "all" || a.audience === profile.role)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const unreadCount = list.filter((a) => (a.createdAt?.toMillis?.() || 0) > (profile.announcementsSeenAt?.toMillis?.() || 0) && a.by !== profile.id).length;

  useEffect(() => {
    if (unreadCount > 0) api.markAnnouncementsRead({}).catch(() => {});
  }, [unreadCount]);

  const post = async () => {
    setBusy(true);
    const ok = await run(() => api.postAnnouncement(form), "Announcement posted");
    setBusy(false);
    if (ok) setForm(null);
  };

  return (
    <>
      <PageHead title="Announcements" sub={admin ? "Notices for the team. Staff see an unread badge and a banner until they open this page." : "Notices from your admins."}>
        {admin && <button className="btn primary" onClick={() => setForm({ title: "", body: "", audience: "all", pinned: false })}><Plus size={16} />New announcement</button>}
      </PageHead>
      {!loading && list.length === 0 ? <div className="card"><Empty>No announcements yet.</Empty></div> : list.map((a) => {
        const unread = (a.createdAt?.toMillis?.() || 0) > seenAt && a.by !== profile.id;
        return (
          <div key={a.id} className={"card ann " + (unread ? "unread" : "")}>
            <div className="row">
              {a.pinned && <Pin size={15} />}
              <h2 className="grow" style={{ flex: 1 }}>{a.title}</h2>
              {unread && <Badge color="blue">New</Badge>}
              {admin && <Badge color="gray">{AUDIENCE[a.audience]}</Badge>}
              {admin && <button className="btn sm danger" title="Remove" onClick={() => run(() => api.setActive({ collection: "announcements", id: a.id, isActive: false }), "Announcement removed")}><Trash2 size={14} /></button>}
            </div>
            <div className="muted">{a.byName} · {fmtDate(a.createdAt)}</div>
            {a.body && <p>{a.body}</p>}
          </div>
        );
      })}

      {form && (
        <Modal title="New announcement" onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !form.title.trim()} onClick={post}>Post</button></>}>
          <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Message"><textarea className="input" rows="5" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <div className="row">
            <Field label="Who sees it">
              <select className="select" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />Pin to top</label>
          </div>
        </Modal>
      )}
    </>
  );
}

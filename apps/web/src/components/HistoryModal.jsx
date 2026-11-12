import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Badge, Modal, Empty } from "./ui";
import { fmtDate } from "../lib/constants";

// Read-only audit trail from <collection>/<id>/history (written only by Cloud Functions).
export default function HistoryModal({ coll, id, title, users = [], onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    getDocs(query(collection(db, coll, id, "history"), orderBy("timestamp", "desc")))
      .then((s) => setRows(s.docs.map((d) => d.data())))
      .catch(() => setRows([]));
  }, [coll, id]);
  const who = (uid) => users.find((u) => u.id === uid)?.name || uid;

  return (
    <Modal title={`History — ${title}`} onClose={onClose}>
      {rows === null ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>No history yet.</Empty> : (
        <ul className="timeline">
          {rows.map((r, i) => (
            <li key={i}>
              {r.previousStatus ? <><Badge>{r.previousStatus}</Badge> → </> : null}<Badge>{r.newStatus}</Badge>
              <div className="muted">{who(r.userId)} · {fmtDate(r.timestamp)}{r.note ? ` · ${r.note}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

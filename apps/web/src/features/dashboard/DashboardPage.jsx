import { collection } from "firebase/firestore";
import { AlertTriangle, ClipboardCheck, PackageX, Users, Undo2 } from "lucide-react";
import { db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Empty, PageHead, Stat, useAction } from "../../components/ui";
import { api } from "../../lib/firebase";
import { fmtDate } from "../../lib/constants";

export default function Dashboard() {
  const run = useAction();
  const alerts = useLive(() => collection(db, "alerts"), []).data;
  const leads = useLive(() => collection(db, "leads"), []).data;
  const orders = useLive(() => collection(db, "orders"), []).data;

  const open = alerts.filter((a) => !a.resolved).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const activeLeads = leads.filter((l) => l.isActive);

  return (
    <>
      <PageHead title="Dashboard" sub="What needs your attention right now" />
      <div className="grid stats">
        <Stat icon={Users} value={activeLeads.filter((l) => l.status === "New").length} label="New leads" />
        <Stat icon={ClipboardCheck} value={orders.filter((o) => o.status === "Pending").length} label="Orders to verify" color="amber" />
        <Stat icon={PackageX} value={open.filter((a) => a.type === "low_stock").length} label="Low-stock products" color="red" />
        <Stat icon={Undo2} value={open.filter((a) => a.type === "rma").length} label="Open returns" color="red" />
      </div>

      <div className="card">
        <div className="toolbar"><h2>Open alerts</h2></div>
        {open.length === 0 ? <Empty>All clear 🎉</Empty> : (
          <div className="tablewrap"><table><tbody>
            {open.map((a) => (
              <tr key={a.id}>
                <td style={{ width: 28 }}><AlertTriangle size={18} color="var(--amber)" /></td>
                <td>
                  {a.type === "low_stock"
                    ? <><b>{a.name}</b> is low on stock — {a.stock} left (minimum {a.minStockLevel})</>
                    : <>Order <b>#{a.orderId.slice(0, 6)}</b> was <b>{a.status.toLowerCase()}</b> — items restocked automatically</>}
                  <div className="muted">{fmtDate(a.createdAt)}</div>
                </td>
                <td className="actions">
                  <button className="btn sm" onClick={() => run(() => api.resolveAlert({ id: a.id }))}>Resolve</button>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </div>
    </>
  );
}

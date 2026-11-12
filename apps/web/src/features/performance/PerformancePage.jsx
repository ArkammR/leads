import { useState } from "react";
import { collection, doc, query, where } from "firebase/firestore";
import { BadgeDollarSign, CheckCircle2, PhoneCall, ShoppingCart, Target, Undo2 } from "lucide-react";
import { db } from "../../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { useLive, useLiveDoc } from "../../hooks/useLive";
import { Badge, Empty, PageHead, Progress, Stat } from "../../components/ui";
import RangePicker from "../../components/RangePicker";
import { RANGE_PRESETS, TARGET_KEYS, agentStats, fmtCommission, fmtDate, inRange, money, monthRange, orderDate, thisMonth, ymd } from "../../lib/constants";

// Agent's own results and commission. Reads only their own leads, orders and user doc (Firestore rules).
export default function Performance() {
  const { user, profile } = useAuth();
  const orders = useLive(() => query(collection(db, "orders"), where("agentId", "==", user.uid)), [user.uid]).data;
  const leads = useLive(() => query(collection(db, "leads"), where("assignedTo", "==", user.uid), where("isActive", "==", true)), [user.uid]).data;
  const [range, setRange] = useState(() => RANGE_PRESETS["This month"]().map(ymd));

  const month = thisMonth();
  const target = useLiveDoc(() => doc(db, "targets", `${user.uid}_${month}`), [user.uid, month]);
  const ms = agentStats(orders, monthRange(month));
  const s = agentStats(orders, range);
  const contacted = leads.filter((l) => l.status !== "New").length;
  const converted = leads.filter((l) => l.status === "Converted").length;
  const earned = orders.filter((o) => o.status === "Delivered" && inRange(range, orderDate(o)))
    .sort((a, b) => orderDate(b) - orderDate(a));

  return (
    <>
      <PageHead title="My performance" sub={`Your commission: ${fmtCommission(profile.commission)}`}>
        <RangePicker range={range} onChange={setRange} />
      </PageHead>
      {target && TARGET_KEYS.some(([k]) => target[k] > 0) && (
        <>
          <h2 style={{ margin: "0 0 10px" }}>Targets for {month}</h2>
          <div className="grid targets">
            {TARGET_KEYS.filter(([k]) => target[k] > 0).map(([k, l]) => (
              <div key={k} className="card"><div className="muted">{l}</div><Progress value={ms[k]} target={target[k]} format={k === "revenue" ? money : undefined} /></div>
            ))}
          </div>
        </>
      )}
      <div className="grid stats">
        <Stat icon={PhoneCall} value={`${contacted} / ${leads.length}`} label="Leads contacted (all time)" />
        <Stat icon={Target} value={leads.length ? `${Math.round((converted / leads.length) * 100)}%` : "—"} label="Leads converted to orders" color="green" />
        <Stat icon={ShoppingCart} value={s.orders} label="Orders created" />
        <Stat icon={CheckCircle2} value={s.delivered} label={`Delivered${s.deliveryRate === null ? "" : ` · ${s.deliveryRate}% delivery rate`}`} color="green" />
        <Stat icon={Undo2} value={s.lost} label="Returned or failed" color="red" />
        <Stat icon={BadgeDollarSign} value={money(s.commission)} label="Commission earned" color="green" />
        <Stat icon={BadgeDollarSign} value={money(s.unpaid)} label="Commission not paid yet" color="amber" />
      </div>
      <div className="card">
        <div className="toolbar"><h2>Delivered orders</h2></div>
        {earned.length === 0 ? <Empty>No delivered orders in this range.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Order</th><th>Customer</th><th>Delivered</th><th>Total</th><th>Commission</th><th /></tr></thead>
            <tbody>
              {earned.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id.slice(0, 6)}</td><td>{o.customer.name}</td><td>{fmtDate(o.deliveredAt || o.createdAt)}</td><td>{money(o.total)}</td>
                  <td>{money(o.commission || 0)}</td>
                  <td>{o.commission > 0 && <Badge color={o.commissionPaid ? "green" : "amber"}>{o.commissionPaid ? "Paid" : "Unpaid"}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

export const AGENT_STATUSES = ["Called", "Not Answered", "Hold", "Interested", "Not Interested"];
export const CALLBACK_STATUSES = ["Not Answered", "Hold"];
export const ts = (t) => (t && t.toDate ? t.toDate() : null);
export const fmtDate = (t) => {
  const d = ts(t);
  return d ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
};
export const money = (n) => Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
export const tone = (s) =>
  ({
    New: "blue", Called: "gray", "Not Answered": "amber", Hold: "amber", Interested: "green", Converted: "green", "Not Interested": "red",
    Pending: "amber", Verified: "blue", Dispatched: "blue", OutForDelivery: "blue", Delivered: "green", Failed: "red", Returned: "red", Cancelled: "gray",
  }[s] || "gray");

// Units that can still be sold: on hand minus units reserved by pending orders.
export const available = (p) => (p.stock || 0) - (p.reserved || 0);

// Stock movement types: [label, badge color]
export const STOCK_REASONS = {
  opening: ["Opening", "gray"], purchase: ["Stock in", "green"], adjustment: ["Adjustment", "amber"],
  sale: ["Sale", "blue"], return: ["Return", "red"],
};

export const EXPENSE_CATEGORIES = ["Advertising", "Courier", "Packaging", "Salaries", "Commissions", "Rent", "Software", "Other"];
// When an order counts for revenue: delivery time, falling back to creation for older orders.
export const orderDate = (o) => ts(o.deliveredAt) || ts(o.createdAt);
// COD state; Delivered orders from before payment tracking count as collected.
export const payStatus = (o) => o.payment?.status || (o.status === "Delivered" ? "collected" : "unpaid");

export const fmtCommission = (c) => (!c || !(c.value > 0) ? "None" : c.type === "percent" ? `${c.value}% of order` : `${money(c.value)} per order`);

// Date range helpers shared by Finance and performance pages.
const p2 = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const RANGE_PRESETS = {
  "This month": () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n]; },
  "Last month": () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)]; },
  "Last 30 days": () => [new Date(Date.now() - 29 * 864e5), new Date()],
  "All time": () => [new Date(2000, 0, 1), new Date()],
};
export const inRange = (range, d) => !!d && d >= new Date(range[0] + "T00:00:00") && d <= new Date(range[1] + "T23:59:59.999");

// One agent's results for a date range. Orders count by creation date; delivered/commission by delivery date.
export function agentStats(orders, range) {
  const created = orders.filter((o) => inRange(range, ts(o.createdAt)));
  const delivered = orders.filter((o) => o.status === "Delivered" && inRange(range, orderDate(o)));
  const lost = created.filter((o) => ["Returned", "Failed"].includes(o.status)).length;
  const closed = created.filter((o) => o.status === "Delivered").length + lost;
  return {
    orders: created.length,
    delivered: delivered.length,
    lost,
    deliveryRate: closed ? Math.round((created.filter((o) => o.status === "Delivered").length / closed) * 100) : null,
    revenue: delivered.reduce((s, o) => s + (o.total || 0), 0),
    commission: delivered.reduce((s, o) => s + (o.commission || 0), 0),
    unpaid: orders.filter((o) => o.status === "Delivered" && o.commission > 0 && !o.commissionPaid).reduce((s, o) => s + o.commission, 0),
  };
}

// Minutes → "7h 05m".
export const fmtMins = (m) => { const n = Math.max(0, Math.round(m || 0)); return `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, "0")}m`; };
// Worked minutes for an attendance doc, counting a running session up to now.
export const workedMins = (a, now = Date.now()) => (a.sessions || []).reduce((s, x) => s + ((x.out ?? now) - x.in), 0) / 60000;
export const breakMins = (a, now = Date.now()) => (a.breaks || []).reduce((s, x) => s + ((x.end ?? now) - x.start), 0) / 60000;
export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
export const PRESENCE = { in: ["Working", "green"], break: ["On break", "amber"], out: ["Off", "gray"] };
export const PRIORITY_TONE = { high: "red", normal: "blue", low: "gray" };
// "YYYY-MM" for the current local month.
export const thisMonth = () => ymd(new Date()).slice(0, 7);
// ["YYYY-MM-01", "YYYY-MM-<last>"] for a "YYYY-MM" month, for agentStats/inRange.
export const monthRange = (m) => { const [y, mo] = m.split("-").map(Number); return [ymd(new Date(y, mo - 1, 1)), ymd(new Date(y, mo, 0))]; };
export const TARGET_KEYS = [["orders", "Orders created"], ["delivered", "Delivered"], ["revenue", "Revenue"]];

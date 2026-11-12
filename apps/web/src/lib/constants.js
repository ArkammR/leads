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
    Pending: "amber", Verified: "blue", Dispatched: "blue", OutForDelivery: "blue", Delivered: "green", Failed: "red", Returned: "red",
  }[s] || "gray");

// Units that can still be sold: on hand minus units reserved by pending orders.
export const available = (p) => (p.stock || 0) - (p.reserved || 0);

// Stock movement types: [label, badge color]
export const STOCK_REASONS = {
  opening: ["Opening", "gray"], purchase: ["Stock in", "green"], adjustment: ["Adjustment", "amber"],
  sale: ["Sale", "blue"], return: ["Return", "red"],
};

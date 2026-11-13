// Commission an agent earns on one delivered order.
// user.commission = { type: "flat" | "percent", value }
function commissionFor(order, user) {
  const c = user && user.commission;
  if (!c || !(c.value > 0)) return 0;
  const amt = c.type === "percent" ? ((order.total || 0) * c.value) / 100 : c.value;
  return Math.round(amt * 100) / 100;
}

module.exports = { commissionFor };

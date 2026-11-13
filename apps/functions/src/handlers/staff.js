const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue, Timestamp } = require("../lib/firebase");
const { requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");

exports.setCommission = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { userId, type } = req.data;
  const value = Number(req.data.value);
  if (!["flat", "percent"].includes(type) || !(value >= 0) || (type === "percent" && value > 100)) throw new HttpsError("invalid-argument", "Bad commission.");
  const ref = db.doc(`users/${userId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "User not found.");
  await ref.update({ commission: { type, value } });
  await logActivity(u, "commission.set", `${snap.data().name}: ${type === "percent" ? `${value}%` : `${value} flat`}`, { type: "user", id: userId });
  return { ok: true };
});

// Pay an agent every unpaid commission on their delivered orders, and book it as a "Commissions" expense.
exports.payCommissions = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { agentId, note } = req.data;
  const q = db.collection("orders").where("agentId", "==", agentId).where("status", "==", "Delivered");
  const agent = await db.doc(`users/${agentId}`).get();
  if (!agent.exists) throw new HttpsError("not-found", "Agent not found.");
  const result = await db.runTransaction(async (tx) => {
    const snaps = (await tx.get(q)).docs.filter((d) => !d.data().commissionPaid && d.data().commission > 0);
    if (!snaps.length) throw new HttpsError("failed-precondition", "Nothing to pay.");
    if (snaps.length > 450) throw new HttpsError("failed-precondition", "Too many orders in one payout.");
    const amount = Math.round(snaps.reduce((s, d) => s + d.data().commission, 0) * 100) / 100;
    const expRef = db.collection("expenses").doc();
    for (const d of snaps) tx.update(d.ref, { commissionPaid: true, commissionExpenseId: expRef.id });
    tx.set(expRef, {
      category: "Commissions", amount, date: Timestamp.now(), isActive: true, by: u.uid, agentId,
      note: `${agent.data().name}: ${snaps.length} delivered orders${note ? ` (${note})` : ""}`, createdAt: FieldValue.serverTimestamp(),
    });
    return { amount, orders: snaps.length };
  });
  await logActivity(u, "commission.pay", `${agent.data().name}: ${result.amount} for ${result.orders} orders`, { type: "user", id: agentId });
  return result;
});

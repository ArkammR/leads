const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue, Timestamp } = require("../lib/firebase");
const { requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { auditRef, auditData } = require("../lib/audit");

const EXPENSE_CATEGORIES = ["Advertising", "Courier", "Packaging", "Salaries", "Commissions", "Rent", "Software", "Other"];

// Create or edit an expense. Void with setActive({collection: "expenses"}).
exports.saveExpense = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { id, category, note } = req.data;
  const amount = Number(req.data.amount);
  const dateMs = Number(req.data.dateMs);
  if (!(amount > 0)) throw new HttpsError("invalid-argument", "Amount must be more than 0.");
  if (!EXPENSE_CATEGORIES.includes(category)) throw new HttpsError("invalid-argument", "Bad category.");
  if (!Number.isFinite(dateMs)) throw new HttpsError("invalid-argument", "Bad date.");
  const data = { category, amount: Math.round(amount * 100) / 100, note: String(note || "").slice(0, 300), date: Timestamp.fromMillis(dateMs) };
  if (id) await db.doc(`expenses/${id}`).update({ ...data, updatedBy: u.uid });
  else await db.collection("expenses").add({ ...data, by: u.uid, isActive: true, createdAt: FieldValue.serverTimestamp() });
  await logActivity(u, id ? "expense.edit" : "expense.create", `${category} ${data.amount}${data.note ? `: ${data.note}` : ""}`);
  return { ok: true };
});

// Courier paid us the cash it collected for these delivered orders.
exports.recordRemittance = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { orderIds, reference, note } = req.data;
  if (!Array.isArray(orderIds) || !orderIds.length || orderIds.length > 400) throw new HttpsError("invalid-argument", "Pick 1 to 400 orders.");
  const remRef = db.collection("remittances").doc();
  const amount = await db.runTransaction(async (tx) => {
    const refs = [...new Set(orderIds)].map((id) => db.doc(`orders/${id}`));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    let sum = 0;
    for (const s of snaps) {
      if (!s.exists) throw new HttpsError("not-found", `Order ${s.id} not found.`);
      const o = s.data();
      if (o.status !== "Delivered") throw new HttpsError("failed-precondition", `Order #${s.id.slice(0, 6)} is not delivered.`);
      if (o.payment?.status === "remitted") throw new HttpsError("failed-precondition", `Order #${s.id.slice(0, 6)} is already remitted.`);
      sum += o.total || 0;
    }
    for (const s of snaps) {
      tx.update(s.ref, { payment: { ...(s.data().payment || { method: "COD" }), status: "remitted", remittedAt: FieldValue.serverTimestamp(), remittanceId: remRef.id } });
      tx.set(auditRef(s.ref), auditData(u.uid, "Delivered", "Delivered", `cash remitted (${reference || remRef.id})`));
    }
    tx.set(remRef, { orderIds: snaps.map((s) => s.id), amount: sum, reference: String(reference || ""), note: String(note || ""), by: u.uid, createdAt: FieldValue.serverTimestamp() });
    return sum;
  });
  await logActivity(u, "remittance.record", `${amount} for ${orderIds.length} orders${reference ? ` (${reference})` : ""}`, { type: "remittance", id: remRef.id });
  return { id: remRef.id, amount };
});

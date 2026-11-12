const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { getUser, requireAdmin } = require("../lib/auth");
const { auditRef, auditData } = require("../lib/audit");
const { syncLowStockAlert } = require("../services/alerts");
const { notify } = require("../services/notify");

exports.createOrder = onCall(async (req) => {
  const u = await getUser(req.auth);
  const { leadId, address, items } = req.data; // items: [{productId, qty}]
  if (!Array.isArray(items) || !items.length) throw new HttpsError("invalid-argument", "No items.");
  const leadRef = db.doc(`leads/${leadId}`);
  const lead = await leadRef.get();
  if (!lead.exists) throw new HttpsError("not-found", "Lead not found.");
  if (u.role !== "admin" && lead.data().assignedTo !== u.uid) throw new HttpsError("permission-denied", "Not your lead.");

  const lines = [];
  for (const it of items) {
    const p = await db.doc(`products/${it.productId}`).get();
    const qty = parseInt(it.qty, 10);
    if (!p.exists || !p.data().isActive || !(qty > 0)) throw new HttpsError("invalid-argument", "Bad item.");
    lines.push({ productId: p.id, name: p.data().name, qty, price: p.data().price });
  }
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const orderRef = db.collection("orders").doc();
  const batch = db.batch();
  batch.set(orderRef, {
    leadId, agentId: lead.data().assignedTo, customer: { name: lead.data().name, phone: lead.data().phone, address: address || "" },
    items: lines, total, status: "Pending", stockDeducted: false, trackingUrl: null, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(auditRef(orderRef), auditData(u.uid, null, "Pending", "created"));
  batch.update(leadRef, { status: "Converted", callbackAt: null });
  batch.set(auditRef(leadRef), auditData(u.uid, lead.data().status, "Converted", `order ${orderRef.id}`));
  await batch.commit();
  return { orderId: orderRef.id };
});

exports.verifyOrder = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { orderId } = req.data;
  const ref = db.doc(`orders/${orderId}`);
  const lowStock = [];
  const order = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    const o = snap.data();
    if (o.status !== "Pending") throw new HttpsError("failed-precondition", `Order is ${o.status}.`);
    // all reads before writes
    const prodRefs = o.items.map((i) => db.doc(`products/${i.productId}`));
    const prods = await Promise.all(prodRefs.map((r) => tx.get(r)));
    const need = {};
    o.items.forEach((i) => (need[i.productId] = (need[i.productId] || 0) + i.qty));
    for (const p of prods) {
      if (!p.exists || p.data().stock < need[p.id]) throw new HttpsError("failed-precondition", `Insufficient stock: ${p.data()?.name || p.id}`);
    }
    const done = new Set();
    for (const p of prods) {
      if (done.has(p.id)) continue; done.add(p.id);
      const newStock = p.data().stock - need[p.id];
      tx.update(p.ref, { stock: newStock });
      if (newStock <= (p.data().minStockLevel || 0)) lowStock.push({ id: p.id, name: p.data().name, stock: newStock, min: p.data().minStockLevel || 0 });
    }
    tx.update(ref, { status: "Verified", stockDeducted: true });
    tx.set(auditRef(ref), auditData(u.uid, "Pending", "Verified", "stock deducted"));
    return o;
  });
  for (const l of lowStock) await syncLowStockAlert(l.id, l.name, l.stock, l.min);
  await notify(orderId, order.customer.phone,
    `Hi ${order.customer.name}, your order #${orderId.slice(0, 6)} (total ${order.total}) is confirmed. We'll message you when it ships.`);
  return { ok: true, lowStock: lowStock.length };
});

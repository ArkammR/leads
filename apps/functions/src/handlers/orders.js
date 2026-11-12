const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { getUser, requireAdmin } = require("../lib/auth");
const { auditRef, auditData } = require("../lib/audit");
const { syncLowStockAlert } = require("../services/alerts");
const { notify } = require("../services/notify");
const { qtyByProduct, stockMove } = require("../lib/stock");

exports.createOrder = onCall(async (req) => {
  const u = await getUser(req.auth);
  const { leadId, address, items } = req.data; // items: [{productId, qty}]
  if (!Array.isArray(items) || !items.length) throw new HttpsError("invalid-argument", "No items.");
  const leadRef = db.doc(`leads/${leadId}`);
  const lead = await leadRef.get();
  if (!lead.exists) throw new HttpsError("not-found", "Lead not found.");
  if (u.role !== "admin" && lead.data().assignedTo !== u.uid) throw new HttpsError("permission-denied", "Not your lead.");

  const qtys = items.map((it) => parseInt(it.qty, 10));
  if (qtys.some((q) => !(q > 0))) throw new HttpsError("invalid-argument", "Bad quantity.");

  // Reserve stock in the same transaction that creates the order, so two agents
  // can't sell the last unit twice. Verification later turns the reservation into a sale.
  const orderRef = db.collection("orders").doc();
  await db.runTransaction(async (tx) => {
    const need = qtyByProduct(items.map((it, i) => ({ productId: String(it.productId), qty: qtys[i] })));
    const ids = Object.keys(need);
    const prods = await Promise.all(ids.map((id) => tx.get(db.doc(`products/${id}`))));
    const byId = {};
    for (const p of prods) {
      if (!p.exists || !p.data().isActive) throw new HttpsError("invalid-argument", "Bad item.");
      const available = (p.data().stock || 0) - (p.data().reserved || 0);
      if (available < need[p.id]) throw new HttpsError("failed-precondition", `Only ${Math.max(available, 0)} ${p.data().name} available.`);
      byId[p.id] = p;
    }
    const lines = items.map((it, i) => {
      const p = byId[String(it.productId)];
      return { productId: p.id, name: p.data().name, qty: qtys[i], price: p.data().price };
    });
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    for (const p of prods) tx.update(p.ref, { reserved: FieldValue.increment(need[p.id]) });
    tx.set(orderRef, {
      leadId, agentId: lead.data().assignedTo, customer: { name: lead.data().name, phone: lead.data().phone, address: address || "" },
      items: lines, total, status: "Pending", stockDeducted: false, stockReserved: true, trackingUrl: null, createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(auditRef(orderRef), auditData(u.uid, null, "Pending", "created, stock reserved"));
    tx.update(leadRef, { status: "Converted", callbackAt: null });
    tx.set(auditRef(leadRef), auditData(u.uid, lead.data().status, "Converted", `order ${orderRef.id}`));
  });
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
    const need = qtyByProduct(o.items);
    const ids = Object.keys(need);
    const prods = await Promise.all(ids.map((id) => tx.get(db.doc(`products/${id}`))));
    const costs = await Promise.all(ids.map((id) => tx.get(db.doc(`productCosts/${id}`))));
    for (const p of prods) {
      if (!p.exists || p.data().stock < need[p.id]) throw new HttpsError("failed-precondition", `Insufficient stock: ${p.data()?.name || p.id}`);
    }
    const unitCost = {};
    ids.forEach((id, i) => (unitCost[id] = costs[i].exists ? costs[i].data().costPrice : null));
    for (const p of prods) {
      const newStock = p.data().stock - need[p.id];
      const upd = { stock: newStock };
      // Orders created before reservations existed have nothing to release.
      if (o.stockReserved) upd.reserved = Math.max((p.data().reserved || 0) - need[p.id], 0);
      tx.update(p.ref, upd);
      stockMove(tx, { productId: p.id, name: p.data().name, delta: -need[p.id], balance: newStock, reason: "sale", by: u.uid, orderId, unitCost: unitCost[p.id] });
      if (newStock <= (p.data().minStockLevel || 0)) lowStock.push({ id: p.id, name: p.data().name, stock: newStock, min: p.data().minStockLevel || 0 });
    }
    // Snapshot cost at the moment of sale so profit stays correct when costs change later.
    const items = o.items.map((i) => ({ ...i, unitCost: unitCost[i.productId] }));
    const costTotal = items.every((i) => i.unitCost !== null) ? items.reduce((s, i) => s + i.qty * i.unitCost, 0) : null;
    tx.update(ref, { status: "Verified", stockDeducted: true, stockReserved: false, items, costTotal });
    tx.set(auditRef(ref), auditData(u.uid, "Pending", "Verified", "stock deducted"));
    return o;
  });
  for (const l of lowStock) await syncLowStockAlert(l.id, l.name, l.stock, l.min);
  await notify(orderId, order.customer.phone,
    `Hi ${order.customer.name}, your order #${orderId.slice(0, 6)} (total ${order.total}) is confirmed. We'll message you when it ships.`);
  return { ok: true, lowStock: lowStock.length };
});

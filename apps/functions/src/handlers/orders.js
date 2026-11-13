const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { getUser, requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { auditRef, auditData } = require("../lib/audit");
const { syncLowStockAlert } = require("../services/alerts");
const { notify } = require("../services/notify");
const { qtyByProduct, stockMove } = require("../lib/stock");
const { shippingSettings, bookOne } = require("../services/shipping");
const { BY_ID } = require("../couriers");

const OPEN_STATUSES = ["Pending", "Verified", "Dispatched", "OutForDelivery"];

exports.createOrder = onCall(async (req) => {
  const u = await getUser(req.auth);
  const { leadId, address, items } = req.data; // items: [{productId, qty}]
  const ship = (k, n = 60) => String(req.data[k] || "").trim().slice(0, n); // courier delivery details
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
    const existing = await tx.get(db.collection("orders").where("leadId", "==", leadId));
    const open = existing.docs.find((d) => OPEN_STATUSES.includes(d.data().status));
    if (open) throw new HttpsError("already-exists", `This lead already has an open order (#${open.id.slice(0, 6)}, ${open.data().status}).`);
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
      leadId, agentId: lead.data().assignedTo, customer: { name: lead.data().name, phone: lead.data().phone, address: String(address || "").slice(0, 300), district: ship("district"), city: ship("city"), phone2: ship("phone2", 20) },
      items: lines, total, status: "Pending", stockDeducted: false, stockReserved: true, trackingUrl: null, payment: { method: "COD", status: "unpaid" }, createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(auditRef(orderRef), auditData(u.uid, null, "Pending", "created, stock reserved"));
    tx.update(leadRef, { status: "Converted", callbackAt: null });
    tx.set(auditRef(leadRef), auditData(u.uid, lead.data().status, "Converted", `order ${orderRef.id}`));
  });
  await logActivity(u, "order.create", `order #${orderRef.id.slice(0, 6)} for ${lead.data().name}`, { type: "order", id: orderRef.id });
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
  await logActivity(u, "order.verify", `order #${orderId.slice(0, 6)} (${order.total})`, { type: "order", id: orderId });
  // Auto-book with the default courier when switched on. A courier problem never undoes the verification;
  // it shows on the order so the admin can fix the address and book again.
  let booking = null;
  const settings = await shippingSettings();
  if (settings.autoBook && BY_ID[settings.defaultCourier]?.api) {
    try { booking = await bookOne(orderId, settings.defaultCourier, u.uid); }
    catch (e) { booking = { orderId, ok: false, error: e.message }; }
  }
  return { ok: true, lowStock: lowStock.length, booking };
});

// Admin cancels an order before the courier has it. Pending releases the reservation;
// Verified puts the deducted stock back. The lead returns to the agent's queue as Interested.
exports.cancelOrder = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { orderId, reason } = req.data;
  const ref = db.doc(`orders/${orderId}`);
  const lowStock = [];
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    const o = snap.data();
    if (!["Pending", "Verified"].includes(o.status)) throw new HttpsError("failed-precondition", `A ${o.status} order can't be cancelled here.`);
    if (o.shipment?.state === "booked" && BY_ID[o.shipment.courier]?.api) {
      throw new HttpsError("failed-precondition", `Booked with ${o.shipment.courierName} (waybill ${o.shipment.waybill}). Cancel it with the courier, remove the waybill, then cancel the order.`);
    }
    const need = qtyByProduct(o.items);
    const prods = await Promise.all(Object.keys(need).map((id) => tx.get(db.doc(`products/${id}`))));
    const leadRef = db.doc(`leads/${o.leadId}`);
    const lead = await tx.get(leadRef);
    for (const p of prods) {
      if (!p.exists) continue;
      const d = p.data();
      if (o.stockDeducted) {
        const balance = (d.stock || 0) + need[p.id];
        tx.update(p.ref, { stock: balance });
        stockMove(tx, { productId: p.id, name: d.name, delta: need[p.id], balance, reason: "return", by: u.uid, orderId, note: "order cancelled" });
        lowStock.push({ id: p.id, name: d.name, stock: balance, min: d.minStockLevel || 0 });
      } else if (o.stockReserved) {
        tx.update(p.ref, { reserved: Math.max((d.reserved || 0) - need[p.id], 0) });
      }
    }
    tx.update(ref, { status: "Cancelled", stockReserved: false, stockDeducted: false, cancelReason: String(reason || "") });
    tx.set(auditRef(ref), auditData(u.uid, o.status, "Cancelled", reason || ""));
    if (lead.exists && lead.data().status === "Converted") {
      tx.update(leadRef, { status: "Interested" });
      tx.set(auditRef(leadRef), auditData(u.uid, "Converted", "Interested", `order ${orderId} cancelled`));
    }
  });
  for (const l of lowStock) await syncLowStockAlert(l.id, l.name, l.stock, l.min);
  await logActivity(u, "order.cancel", `order #${orderId.slice(0, 6)}${reason ? `: ${reason}` : ""}`, { type: "order", id: orderId });
  return { ok: true };
});

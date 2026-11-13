const { HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("./firebase");
const { auditRef, auditData } = require("./audit");
const { syncLowStockAlert } = require("../services/alerts");
const { notify } = require("../services/notify");
const { qtyByProduct, stockMove } = require("./stock");
const { commissionFor } = require("./commission");

// Statuses a shipment moves through after admin verification.
const SHIP_STATUSES = ["Dispatched", "OutForDelivery", "Delivered", "Failed", "Returned"];
const CLOSED = ["Delivered", "Returned", "Cancelled"];
// Forward-only order for courier tracking sync, so an old event never moves an order back.
const RANK = { Verified: 0, Dispatched: 1, OutForDelivery: 2, Failed: 3, Delivered: 4, Returned: 4 };

// Move an order to a delivery status, used by the 3PL webhook, courier tracking sync and the admin.
// Handles COD collection, commission, restock on Failed/Returned, alerts and customer messages.
// opts: { by, trackingUrl, forwardOnly, extra (more order fields to set) }
// Throws HttpsError("not-found" | "failed-precondition"). Returns { changed }.
async function applyOrderStatus(orderId, newStatus, opts = {}) {
  const { by = "system", trackingUrl = null, forwardOnly = false, extra = null, note = "" } = opts;
  if (!SHIP_STATUSES.includes(newStatus)) throw new HttpsError("invalid-argument", "Bad status.");
  const ref = db.doc(`orders/${orderId}`);
  const restocked = [];
  let order, changed = false;
  await db.runTransaction(async (tx) => {
    restocked.length = 0; changed = false;
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "order");
    order = snap.data();
    if (order.status === newStatus) { if (extra) tx.update(ref, extra); return; } // idempotent retry
    if (order.status === "Pending") throw new HttpsError("failed-precondition", "order not verified");
    if (CLOSED.includes(order.status)) throw new HttpsError("failed-precondition", "order closed");
    if (forwardOnly && (RANK[newStatus] ?? 0) <= (RANK[order.status] ?? 0)) { if (extra) tx.update(ref, extra); return; }
    changed = true;
    const update = { ...(extra || {}), status: newStatus };
    if (trackingUrl) update.trackingUrl = trackingUrl;
    if (newStatus === "Delivered") {
      // Cash on delivery: the courier now holds the money until it remits it (recordRemittance).
      update.deliveredAt = FieldValue.serverTimestamp();
      update.payment = { ...(order.payment || { method: "COD" }), status: "collected", collectedAt: FieldValue.serverTimestamp() };
      // Commission is fixed at the agent's rate on the day of delivery.
      const agent = order.agentId ? await tx.get(db.doc(`users/${order.agentId}`)) : null;
      update.commission = commissionFor(order, agent && agent.exists ? agent.data() : null);
      update.commissionPaid = false;
    }

    const restock = ["Failed", "Returned"].includes(newStatus) && order.stockDeducted;
    if (restock) {
      const need = qtyByProduct(order.items);
      const prods = await Promise.all(Object.keys(need).map((id) => tx.get(db.doc(`products/${id}`))));
      for (const p of prods) {
        if (!p.exists) continue;
        const balance = (p.data().stock || 0) + need[p.id];
        tx.update(p.ref, { stock: balance });
        stockMove(tx, { productId: p.id, name: p.data().name, delta: need[p.id], balance, reason: "return", by, orderId, note: newStatus.toLowerCase() });
        restocked.push({ id: p.id, name: p.data().name, qty: need[p.id] });
      }
      update.stockDeducted = false; // guards against double restock
    }
    tx.update(ref, update);
    tx.set(auditRef(ref), auditData(by, order.status, newStatus, [note, restock ? "stock restored" : ""].filter(Boolean).join(", ")));
  });
  if (!changed) return { changed: false };

  for (const r of restocked) {
    const p = await db.doc(`products/${r.id}`).get();
    if (p.exists) await syncLowStockAlert(p.id, p.data().name, p.data().stock, p.data().minStockLevel || 0);
  }
  if (["Failed", "Returned"].includes(newStatus)) {
    await db.collection("alerts").add({ type: "rma", orderId, status: newStatus, restocked, resolved: false, createdAt: FieldValue.serverTimestamp() });
  }
  if (newStatus === "OutForDelivery") {
    const link = trackingUrl || order.trackingUrl;
    await notify(orderId, order.customer.phone,
      `Your order #${orderId.slice(0, 6)} is out for delivery.${link ? " Track it here: " + link : ""}`);
  }
  return { changed: true };
}

module.exports = { applyOrderStatus, SHIP_STATUSES };

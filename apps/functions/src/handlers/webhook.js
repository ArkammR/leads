const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { auditRef, auditData } = require("../lib/audit");
const { env } = require("../lib/util");
const { syncLowStockAlert } = require("../services/alerts");
const { notify } = require("../services/notify");
const { qtyByProduct, stockMove } = require("../lib/stock");
const { commissionFor } = require("../lib/commission");

const STATUS_MAP = {
  dispatched: "Dispatched", shipped: "Dispatched",
  out_for_delivery: "OutForDelivery", delivered: "Delivered",
  failed: "Failed", returned: "Returned",
};

exports.threePLWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  if (!env("WEBHOOK_SECRET") || req.get("x-webhook-secret") !== env("WEBHOOK_SECRET")) return res.status(401).send("unauthorized");
  const { orderId, status, trackingUrl } = req.body || {};
  const newStatus = STATUS_MAP[String(status || "").toLowerCase().replace(/[\s-]/g, "_")];
  if (!orderId || !newStatus) return res.status(400).send("orderId and valid status required");

  const ref = db.doc(`orders/${orderId}`);
  const restocked = [];
  let order, changed = false;
  try {
    await db.runTransaction(async (tx) => {
      restocked.length = 0;
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "order");
      order = snap.data();
      if (order.status === newStatus) return; // idempotent retry
      if (["Pending"].includes(order.status)) throw new HttpsError("failed-precondition", "order not verified");
      if (["Delivered", "Returned"].includes(order.status)) throw new HttpsError("failed-precondition", "order closed");
      changed = true;
      const update = { status: newStatus };
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
          stockMove(tx, { productId: p.id, name: p.data().name, delta: need[p.id], balance, reason: "return", by: "3pl-webhook", orderId, note: newStatus.toLowerCase() });
          restocked.push({ id: p.id, name: p.data().name, qty: need[p.id] });
        }
        update.stockDeducted = false; // guards against double restock
      }
      tx.update(ref, update);
      tx.set(auditRef(ref), auditData("3pl-webhook", order.status, newStatus, restock ? "stock restored" : ""));
    });
  } catch (e) {
    if (e instanceof HttpsError) return res.status(e.code === "not-found" ? 404 : 409).send(e.message);
    console.error(e); return res.status(500).send("error");
  }
  if (!changed) return res.status(200).send("no-op");

  if (restocked.length) {
    for (const r of restocked) {
      const p = await db.doc(`products/${r.id}`).get();
      if (p.exists) await syncLowStockAlert(p.id, p.data().name, p.data().stock, p.data().minStockLevel || 0);
    }
  }
  if (["Failed", "Returned"].includes(newStatus)) {
    await db.collection("alerts").add({ type: "rma", orderId, status: newStatus, restocked, resolved: false, createdAt: FieldValue.serverTimestamp() });
  }
  if (newStatus === "OutForDelivery") {
    const link = trackingUrl || order.trackingUrl;
    await notify(orderId, order.customer.phone,
      `Your order #${orderId.slice(0, 6)} is out for delivery.${link ? " Track it here: " + link : ""}`);
  }
  res.status(200).send("ok");
});

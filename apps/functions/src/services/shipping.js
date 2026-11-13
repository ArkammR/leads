const { HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { auditRef, auditData } = require("../lib/audit");
const { applyOrderStatus } = require("../lib/orderStatus");
const { notify } = require("./notify");
const { loadConfig, missing } = require("../couriers");
const { mapCourierStatus } = require("../couriers/status");

// Booking orders with couriers and pulling their tracking status. Used by the shipping handlers
// and by verifyOrder (auto-booking).
const SETTINGS = "settings/shipping";
const CLOSED = ["Delivered", "Returned", "Cancelled"];
const STALE_LOCK_MS = 5 * 60 * 1000;
const str = (v, n = 300) => String(v ?? "").trim().slice(0, n);

async function shippingSettings() {
  const s = await db.doc(SETTINGS).get();
  return { autoBook: false, defaultCourier: "", currency: "LKR", sender: {}, ...(s.exists ? s.data() : {}) };
}

// What a courier needs to know about one order.
function shipmentFor(orderId, o, extra = {}) {
  const c = o.customer || {};
  const cod = (o.payment?.method || "COD") === "COD" && o.payment?.status !== "collected" && o.payment?.status !== "remitted" ? o.total || 0 : 0;
  return {
    orderNo: orderId, name: c.name || "", phone: c.phone || "", phone2: c.phone2 || "", address: c.address || "",
    district: c.district || "", city: c.city || "", cod, weight: o.weight || 1, note: o.shipNote || "",
    description: (o.items || []).map((i) => `${i.name} x ${i.qty}`).join(", "),
    ...extra,
  };
}

// Book one verified order with a courier. Never throws for courier errors: they are saved on the
// order (shipment.state "error") so the admin can fix the address and retry.
async function bookOne(orderId, courierId, by, { courierName = "", waybill = "" } = {}) {
  const conf = await loadConfig(courierId);
  if (!conf) throw new HttpsError("invalid-argument", "Unknown courier.");
  const { adapter, cfg, enabled } = conf;
  if (!enabled) throw new HttpsError("failed-precondition", `${adapter.name} is switched off in Courier settings.`);
  const gaps = missing(adapter, cfg);
  if (adapter.api && gaps.length) throw new HttpsError("failed-precondition", `${adapter.name} settings missing: ${gaps.join(", ")}.`);

  const ref = db.doc(`orders/${orderId}`);
  // Lock first so two clicks (or auto-book + a click) can't create two waybills.
  const order = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    const o = snap.data(), sh = o.shipment;
    if (o.status !== "Verified") throw new HttpsError("failed-precondition", `Order is ${o.status}; only Verified orders can be booked.`);
    if (sh?.state === "booked") throw new HttpsError("already-exists", `Already booked with ${sh.courierName} (${sh.waybill || "no waybill"}).`);
    if (sh?.state === "booking" && Date.now() - (sh.startedAt || 0) < STALE_LOCK_MS) throw new HttpsError("aborted", "Booking already in progress.");
    tx.update(ref, { shipment: { state: "booking", courier: courierId, startedAt: Date.now() } });
    return o;
  });

  try {
    const r = await adapter.book(shipmentFor(orderId, order, { waybill, courierName }), cfg);
    const name = r.courierName || cfg.displayName || adapter.name;
    const shipment = {
      state: "booked", courier: courierId, courierName: name, waybill: r.waybill || null, trackingUrl: r.trackingUrl || null,
      bookedAt: FieldValue.serverTimestamp(), bookedBy: by, courierStatus: "", error: null, printedAt: null,
    };
    await ref.update({ shipment, ...(r.trackingUrl ? { trackingUrl: r.trackingUrl } : {}) });
    await auditRef(ref).set(auditData(by, "Verified", "Verified", `booked with ${name}${r.waybill ? `, waybill ${r.waybill}` : ""}`));
    if (r.waybill) {
      await notify(orderId, order.customer.phone,
        `Hi ${order.customer.name}, your order #${orderId.slice(0, 6)} will be delivered by ${name}. Waybill: ${r.waybill}.${r.trackingUrl ? " Track: " + r.trackingUrl : ""}`);
    }
    return { orderId, ok: true, waybill: r.waybill || null, courierName: name };
  } catch (e) {
    const error = str(e.message || e, 500);
    await ref.update({ shipment: { state: "error", courier: courierId, courierName: cfg.displayName || adapter.name, error, failedAt: Date.now() } });
    return { orderId, ok: false, error };
  }
}

// Ask the courier where one booked order is; move the order forward when the courier status maps.
async function syncOne(id, o) {
  const sh = o.shipment;
  const conf = await loadConfig(sh.courier);
  if (!conf || !conf.adapter.track || !sh.waybill) return { orderId: id, skipped: true };
  try {
    const { courierStatus } = await conf.adapter.track(sh.waybill, conf.cfg);
    const shipment = { ...sh, courierStatus: str(courierStatus, 120), lastSyncAt: Date.now(), syncError: null };
    const next = mapCourierStatus(courierStatus);
    if (next) {
      await applyOrderStatus(id, next, { by: `courier:${sh.courier}`, forwardOnly: true, extra: { shipment }, note: courierStatus });
    } else {
      await db.doc(`orders/${id}`).update({ shipment });
    }
    return { orderId: id, ok: true, courierStatus, status: next };
  } catch (e) {
    const syncError = str(e.message || e, 300);
    await db.doc(`orders/${id}`).update({ shipment: { ...sh, syncError, lastSyncAt: Date.now() } }).catch(() => {});
    return { orderId: id, ok: false, error: syncError };
  }
}

async function syncBooked(orderIds = null, max = 300) {
  let docs;
  if (orderIds) docs = (await Promise.all(orderIds.map((id) => db.doc(`orders/${id}`).get()))).filter((d) => d.exists);
  else docs = (await db.collection("orders").where("shipment.state", "==", "booked").get()).docs;
  const open = docs.filter((d) => d.data().shipment?.state === "booked" && !CLOSED.includes(d.data().status)).slice(0, max);
  const results = [];
  for (const d of open) results.push(await syncOne(d.id, d.data()));
  return results;
}

module.exports = { SETTINGS, CLOSED, str, shippingSettings, shipmentFor, bookOne, syncBooked };

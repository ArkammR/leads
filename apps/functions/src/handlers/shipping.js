const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { db, FieldValue } = require("../lib/firebase");
const { requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { auditRef, auditData } = require("../lib/audit");
const { applyOrderStatus, SHIP_STATUSES } = require("../lib/orderStatus");
const { BY_ID, loadConfig, missing } = require("../couriers");

const { SETTINGS, str, shippingSettings, bookOne, syncBooked } = require("../services/shipping");

/* ---------------- callables ---------------- */

// Courier list with field definitions and current (non-secret) values, for the settings page.
exports.listCouriers = onCall(async (req) => {
  await requireAdmin(req.auth);
  const out = [];
  for (const a of Object.values(BY_ID)) {
    const { cfg, enabled } = await loadConfig(a.id);
    out.push({
      id: a.id, name: a.name, api: a.api, canTrack: !!a.track, enabled,
      fields: a.fields.map((f) => ({ ...f, value: f.secret ? "" : cfg[f.key] ?? "", isSet: !!String(cfg[f.key] || "") })),
      missing: missing(a, cfg),
    });
  }
  return { couriers: out, settings: await shippingSettings() };
});

// Save one courier's settings. Secret fields left blank keep their current value.
exports.saveCourierConfig = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { courierId, enabled, values = {} } = req.data;
  const a = BY_ID[courierId];
  if (!a) throw new HttpsError("invalid-argument", "Unknown courier.");
  const pub = {}, sec = {};
  for (const f of a.fields) {
    if (!(f.key in values)) continue;
    const v = str(values[f.key], 4000);
    if (f.secret) { if (v) sec[f.key] = v; } else pub[f.key] = /url/i.test(f.key) ? v.replace(/\/+$/, "") : v;
  }
  const cur = await db.doc(`courierConfigs/${courierId}`).get();
  await db.doc(`courierConfigs/${courierId}`).set({
    enabled: !!enabled, values: { ...(cur.exists ? cur.data().values || {} : {}), ...pub }, updatedBy: u.uid, updatedAt: FieldValue.serverTimestamp(),
  });
  if (Object.keys(sec).length) await db.doc(`courierSecrets/${courierId}`).set(sec, { merge: true });
  await logActivity(u, "courier.settings", `${a.name} ${enabled ? "on" : "off"}${Object.keys(sec).length ? ", key updated" : ""}`);
  return { ok: true };
});

// Default courier, auto-booking on verify, and sender details printed on waybills.
exports.saveShippingSettings = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { autoBook, defaultCourier, sender = {}, currency } = req.data;
  if (defaultCourier && !BY_ID[defaultCourier]) throw new HttpsError("invalid-argument", "Unknown courier.");
  if (autoBook && (!defaultCourier || !BY_ID[defaultCourier].api)) throw new HttpsError("invalid-argument", "Auto-booking needs a default courier with an API.");
  await db.doc(SETTINGS).set({
    autoBook: !!autoBook, defaultCourier: defaultCourier || "", currency: str(currency, 6) || "LKR",
    sender: { name: str(sender.name, 80), phone: str(sender.phone, 30), address: str(sender.address, 200), note: str(sender.note, 120) },
    updatedBy: u.uid, updatedAt: FieldValue.serverTimestamp(),
  });
  await logActivity(u, "courier.settings", `shipping defaults (auto-book ${autoBook ? "on" : "off"}${defaultCourier ? `, ${defaultCourier}` : ""})`);
  return { ok: true };
});

// Fix the delivery details before booking (couriers reject unknown cities).
exports.updateShipTo = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { orderId } = req.data;
  const ref = db.doc(`orders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const o = snap.data();
  if (o.shipment?.state === "booked") throw new HttpsError("failed-precondition", "Already booked; remove the waybill first.");
  const c = o.customer || {};
  const customer = { ...c };
  for (const k of ["address", "district", "city", "phone2"]) if (k in req.data) customer[k] = str(req.data[k], k === "address" ? 300 : 60);
  const upd = { customer };
  if ("note" in req.data) upd.shipNote = str(req.data.note, 200);
  if ("weight" in req.data) { const w = Number(req.data.weight); upd.weight = w > 0 && w < 100 ? w : 1; }
  await ref.update(upd);
  await logActivity(u, "order.shipTo", `order #${orderId.slice(0, 6)} delivery details`, { type: "order", id: orderId });
  return { ok: true };
});

// Book Verified orders with a courier. waybills: { orderId: "typed waybill" } for couriers without an API.
exports.bookShipments = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { orderIds, courierId, courierName = "", waybills = {} } = req.data;
  if (!Array.isArray(orderIds) || !orderIds.length || orderIds.length > 100) throw new HttpsError("invalid-argument", "Pick 1 to 100 orders.");
  if (!BY_ID[courierId]) throw new HttpsError("invalid-argument", "Unknown courier.");
  const results = [];
  for (const id of orderIds) {
    try { results.push(await bookOne(id, courierId, u.uid, { courierName: str(courierName, 60), waybill: str(waybills[id], 40) })); }
    catch (e) { if (e instanceof HttpsError && ["invalid-argument", "failed-precondition"].includes(e.code) && /settings|switched off|Unknown courier/.test(e.message)) throw e; results.push({ orderId: id, ok: false, error: e.message }); }
  }
  const ok = results.filter((r) => r.ok).length;
  await logActivity(u, "courier.book", `${ok}/${orderIds.length} orders booked with ${courierName || BY_ID[courierId].name}`);
  return { results, booked: ok };
});

// Remove a waybill from an order (e.g. booked with the wrong courier). Cancel it with the courier yourself.
exports.clearShipment = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { orderId } = req.data;
  const ref = db.doc(`orders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const o = snap.data();
  if (o.status !== "Verified") throw new HttpsError("failed-precondition", `Order is ${o.status}; the courier already has it.`);
  if (!o.shipment) return { ok: true };
  await ref.update({ shipment: null, trackingUrl: null });
  await auditRef(ref).set(auditData(u.uid, o.status, o.status, `waybill removed (${o.shipment.courierName || o.shipment.courier} ${o.shipment.waybill || ""})`.trim()));
  await logActivity(u, "courier.clear", `order #${orderId.slice(0, 6)} waybill removed`, { type: "order", id: orderId });
  return { ok: true };
});

// Pull the latest courier status now (also runs every 30 minutes).
exports.syncShipments = onCall(async (req) => {
  await requireAdmin(req.auth);
  const ids = Array.isArray(req.data?.orderIds) ? req.data.orderIds.slice(0, 100) : null;
  const results = await syncBooked(ids, 100);
  return { results, checked: results.filter((r) => !r.skipped).length, moved: results.filter((r) => r.status).length };
});

// Admin sets the delivery status by hand (couriers without an API or webhook).
exports.setShipmentStatus = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { orderId, status } = req.data;
  if (!SHIP_STATUSES.includes(status)) throw new HttpsError("invalid-argument", "Bad status.");
  const { changed } = await applyOrderStatus(orderId, status, { by: u.uid, note: "set by admin" });
  if (changed) await logActivity(u, "order.status", `order #${orderId.slice(0, 6)} → ${status}`, { type: "order", id: orderId });
  return { ok: true, changed };
});

// Remember which waybills were printed, so the Orders page can show "not printed yet".
exports.markWaybillsPrinted = onCall(async (req) => {
  await requireAdmin(req.auth);
  const ids = Array.isArray(req.data?.orderIds) ? req.data.orderIds.slice(0, 200) : [];
  const batch = db.batch();
  const snaps = await Promise.all(ids.map((id) => db.doc(`orders/${id}`).get()));
  for (const s of snaps) if (s.exists && s.data().shipment) batch.update(s.ref, { shipment: { ...s.data().shipment, printedAt: Date.now() } });
  await batch.commit();
  return { ok: true };
});

exports.scheduledShipmentSync = onSchedule({ schedule: "every 30 minutes", timeZone: "Asia/Colombo" }, async () => {
  const results = await syncBooked();
  console.log(`shipment sync: ${results.length} checked, ${results.filter((r) => r.status).length} moved, ${results.filter((r) => r.ok === false).length} errors`);
});


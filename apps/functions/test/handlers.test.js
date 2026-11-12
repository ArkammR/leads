const Module = require("module"); const path = require("path"); const assert = require("assert");
// Runs the callable/HTTP handlers against an in-memory Firestore stand-in. No emulator or deps needed: npm test
const FN = path.resolve(__dirname, "..");
const store = new Map(); let idc = 0;
const INC = Symbol("inc");
const FieldValue = { serverTimestamp: () => "TS", increment: (n) => ({ [INC]: n }) };
const apply = (old, data) => { const o = { ...(old || {}) }; for (const [k, v] of Object.entries(data)) o[k] = v && v[INC] !== undefined ? (o[k] || 0) + v[INC] : v; return o; };
function ref(p) { return { path: p, id: p.split("/").pop(),
  collection: (c) => col(`${p}/${c}`),
  get: async () => snap(p), set: async (d, o) => set(p, d, o), update: async (d) => upd(p, d) }; }
const dig = (d, f) => f.split(".").reduce((o, k) => (o == null ? o : o[k]), d);
function qry(c, filters) { return { isQuery: true, where: (f, op, v) => qry(c, [...filters, [f, v]]), get: async () => ({ docs: qry(c, filters).docs() }),
  docs: () => [...store].filter(([k, d]) => k.startsWith(c + "/") && k.split("/").length === c.split("/").length + 1 && filters.every(([f, v]) => dig(d, f) === v)).map(([k]) => snap(k)) }; }
function col(c) { return { where: (f, op, v) => qry(c, [[f, v]]), doc: (id) => ref(`${c}/${id || "auto" + ++idc}`), add: async (d) => { const r = ref(`${c}/auto${++idc}`); set(r.path, d); return r; } }; }
function snap(p) { const d = store.get(p); return { exists: !!d, id: p.split("/").pop(), ref: ref(p), data: () => d && { ...d } }; }
function set(p, d, o) { store.set(p, o && o.merge ? apply(store.get(p), d) : apply({}, d)); }
function upd(p, d) { if (!store.has(p)) throw new Error("no doc " + p); store.set(p, apply(store.get(p), d)); }
const db = { doc: ref, collection: col,
  getAll: async (...rs) => rs.map((r) => snap(r.path)),
  batch: () => { const ops = []; return { set: (r, d, o) => ops.push(() => set(r.path, d, o)), update: (r, d) => ops.push(() => upd(r.path, d)), commit: async () => ops.forEach((f) => f()) }; },
  runTransaction: async (fn) => { const ops = []; let wrote = false;
    const tx = { get: async (r) => { if (wrote) throw new Error("read after write"); return r.isQuery ? { docs: r.docs() } : snap(r.path); },
      set: (r, d, o) => { wrote = true; ops.push(() => set(r.path, d, o)); }, update: (r, d) => { wrote = true; ops.push(() => upd(r.path, d)); } };
    const res = await fn(tx); ops.forEach((f) => f()); return res; } };
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const mocks = {
  "firebase-functions/v2/https": { onCall: (h) => h, onRequest: (h) => h, HttpsError },
  "firebase-functions/v2/scheduler": { onSchedule: (o, h) => h },
  [path.join(FN, "src/lib/firebase.js")]: { db, FieldValue, Timestamp: { fromMillis: (m) => ({ ms: m }), now: () => ({ ms: Date.now() }) }, admin: {} },
  [path.join(FN, "src/services/notify.js")]: { notify: async () => {} },
};
const orig = Module._load;
Module._load = function (req, parent, isMain) { const r = mocks[req] ? req : (() => { try { return Module._resolveFilename(req, parent); } catch { return req; } })(); return mocks[r] || orig.apply(this, arguments); };
const P = require(FN + "/src/handlers/products.js"), O = require(FN + "/src/handlers/orders.js"), W = require(FN + "/src/handlers/webhook.js"), F = require(FN + "/src/handlers/finance.js"), S = require(FN + "/src/handlers/staff.js"), L = require(FN + "/src/handlers/leads.js"), A = require(FN + "/src/handlers/attendance.js"), WP = require(FN + "/src/handlers/workplace.js"), SH = require(FN + "/src/handlers/shipping.js");
const { mapCourierStatus } = require(FN + "/src/couriers/status.js");
// Fake courier APIs: records requests, answers by URL.
const calls = []; let trackStatus = "Processing";
global.fetch = async (url, init) => {
  calls.push({ url, init });
  const json = (b, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });
  if (url.endsWith("/orders/upload/single-auto-without-city")) {
    const b = JSON.parse(init.body);
    return b.city === "Nowhere" ? json({ message: "Invalid city" }, 422) : json({ success: "Record successfully added", order: { waybill_id: "TE000001" } });
  }
  if (url.endsWith("/tracking")) return json({ data: { current_status: trackStatus } });
  if (url.endsWith("/Waybils/users")) return json({ waybills: [{ waybill_id: "459654070" }] });
  if (url.endsWith("/Cities/users")) return json({ data: [{ city_id: 77, city_name: "Kohuwala" }] });
  if (url.endsWith("/Addorders/users")) return json({ status: "success" });
  return json({ message: "unexpected " + url }, 404);
};
const admin = { auth: { uid: "a1" } }, agent = { auth: { uid: "g1" } };
const moves = () => [...store].filter(([k]) => k.startsWith("stockMoves/")).map(([, v]) => v);
const rejects = async (p, code) => { try { await p; assert.fail("should reject"); } catch (e) { assert.equal(e.code, code, e.message); } };
(async () => {
  store.set("users/a1", { role: "admin", isActive: true }); store.set("users/g1", { role: "agent", isActive: true });
  store.set("leads/L1", { name: "Cust", phone: "1", assignedTo: "g1", status: "Interested" });
  store.set("leads/L2", { name: "Cust2", phone: "2", assignedTo: "g1", status: "Interested" });
  const { id } = await P.saveProduct({ ...admin, data: { name: "Widget", sku: "W", price: 10, stock: 5, minStockLevel: 1, costPrice: 4 } });
  const pr = () => store.get(`products/${id}`);
  assert.deepEqual([pr().stock, pr().reserved], [5, 0]); assert.equal(store.get(`productCosts/${id}`).costPrice, 4);
  assert.equal(moves()[0].reason, "opening");
  await P.adjustStock({ ...admin, data: { productId: id, type: "in", qty: 5, unitCost: 6, supplier: "S" } });
  assert.equal(pr().stock, 10); assert.equal(store.get(`productCosts/${id}`).costPrice, 5);
  // edit doesn't touch stock
  await P.saveProduct({ ...admin, data: { id, name: "Widget", sku: "W", price: 12, stock: 999, minStockLevel: 1 } });
  assert.equal(pr().stock, 10); assert.equal(pr().price, 12);
  const { orderId } = await O.createOrder({ ...agent, data: { leadId: "L1", address: "x", items: [{ productId: id, qty: 4 }, { productId: id, qty: 4 }] } });
  assert.equal(pr().reserved, 8);
  await rejects(O.createOrder({ ...agent, data: { leadId: "L2", address: "x", items: [{ productId: id, qty: 3 }] } }), "failed-precondition");
  await rejects(P.adjustStock({ ...admin, data: { productId: id, type: "adjust", qty: -3, reason: "damaged" } }), "failed-precondition");
  await P.adjustStock({ ...admin, data: { productId: id, type: "adjust", qty: -2, reason: "damaged", note: "box" } });
  assert.equal(pr().stock, 8);
  const r = await O.verifyOrder({ ...admin, data: { orderId } });
  assert.deepEqual([pr().stock, pr().reserved], [0, 0]); assert.equal(r.lowStock, 1);
  const o = store.get(`orders/${orderId}`); assert.equal(o.costTotal, 40); assert.equal(o.status, "Verified");
  assert.equal(store.get(`alerts/low_${id}`).resolved, false);
  // webhook return
  process.env.WEBHOOK_SECRET = "s";
  const res = { code: 0, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  const req = (status) => ({ method: "POST", get: () => "s", body: { orderId, status } });
  await W.threePLWebhook(req("dispatched"), res); assert.equal(res.code, 200);
  await W.threePLWebhook(req("returned"), res); assert.equal(res.code, 200, res.body);
  assert.equal(pr().stock, 8);
  await W.threePLWebhook(req("returned"), res); assert.equal(pr().stock, 8);
  // legacy order without reservation
  store.set(`orders/OLD`, { status: "Pending", items: [{ productId: id, qty: 1, name: "Widget", price: 10 }], customer: { name: "c", phone: "1" }, total: 10 });
  await O.verifyOrder({ ...admin, data: { orderId: "OLD" } }); assert.deepEqual([pr().stock, pr().reserved], [7, 0]);
  await S.setCommission({ ...admin, data: { userId: "g1", type: "percent", value: 10 } });
  await rejects(S.setCommission({ ...admin, data: { userId: "g1", type: "percent", value: 101 } }), "invalid-argument");
  // finance: deliver a second order, then remit
  await P.adjustStock({ ...admin, data: { productId: id, type: "in", qty: 3 } });
  const o2 = (await O.createOrder({ ...agent, data: { leadId: "L2", address: "x", items: [{ productId: id, qty: 2 }] } })).orderId;
  assert.equal(store.get(`orders/${o2}`).payment.status, "unpaid");
  await rejects(F.recordRemittance({ ...admin, data: { orderIds: [o2] } }), "failed-precondition");
  await O.verifyOrder({ ...admin, data: { orderId: o2 } });
  const rq = (status) => ({ method: "POST", get: () => "s", body: { orderId: o2, status } });
  await W.threePLWebhook(rq("dispatched"), res); await W.threePLWebhook(rq("delivered"), res);
  assert.equal(res.code, 200, res.body);
  assert.equal(store.get(`orders/${o2}`).payment.status, "collected"); assert.ok(store.get(`orders/${o2}`).deliveredAt);
  const rem = await F.recordRemittance({ ...admin, data: { orderIds: [o2], reference: "TX1" } });
  assert.equal(rem.amount, 24); assert.equal(store.get(`orders/${o2}`).payment.status, "remitted");
  await rejects(F.recordRemittance({ ...admin, data: { orderIds: [o2] } }), "failed-precondition");
  await F.saveExpense({ ...admin, data: { category: "Advertising", amount: "12.345", dateMs: 1, note: "fb" } });
  await rejects(F.saveExpense({ ...admin, data: { category: "Nope", amount: 1, dateMs: 1 } }), "invalid-argument");
  await rejects(F.saveExpense({ ...agent, data: { category: "Other", amount: 1, dateMs: 1 } }), "permission-denied");
  const ex = [...store].filter(([k]) => k.startsWith("expenses/")).map(([, v]) => v);
  assert.equal(ex.length, 1); assert.equal(ex[0].amount, 12.35);
  assert.equal(store.get(`orders/${o2}`).commission, 2.4);
  const paid = await S.payCommissions({ ...admin, data: { agentId: "g1" } });
  assert.deepEqual(paid, { amount: 2.4, orders: 1 }); assert.equal(store.get(`orders/${o2}`).commissionPaid, true);
  await rejects(S.payCommissions({ ...admin, data: { agentId: "g1" } }), "failed-precondition");
  assert.equal([...store].filter(([k, v]) => k.startsWith("expenses/") && v.category === "Commissions").length, 1);
  // gaps: duplicate open order, cancel, reassign
  store.set("leads/L3", { name: "C3", phone: "3", assignedTo: "g1", status: "Interested" });
  const o3 = (await O.createOrder({ ...agent, data: { leadId: "L3", address: "x", items: [{ productId: id, qty: 1 }] } })).orderId;
  await rejects(O.createOrder({ ...agent, data: { leadId: "L3", address: "x", items: [{ productId: id, qty: 1 }] } }), "already-exists");
  assert.equal(pr().reserved, 1);
  await O.cancelOrder({ ...admin, data: { orderId: o3, reason: "dup" } });
  assert.deepEqual([pr().stock, pr().reserved], [8, 0]); assert.equal(store.get("leads/L3").status, "Interested");
  const o4 = (await O.createOrder({ ...agent, data: { leadId: "L3", address: "x", items: [{ productId: id, qty: 3 }] } })).orderId;
  await O.verifyOrder({ ...admin, data: { orderId: o4 } }); assert.equal(pr().stock, 5);
  await O.cancelOrder({ ...admin, data: { orderId: o4 } }); assert.deepEqual([pr().stock, pr().reserved], [8, 0]);
  await rejects(O.cancelOrder({ ...admin, data: { orderId: o4 } }), "failed-precondition");
  await rejects(O.cancelOrder({ ...agent, data: { orderId: o4 } }), "permission-denied");
  store.set("users/g2", { role: "agent", isActive: true, name: "Bo" });
  const mv = await L.reassignLeads({ ...admin, data: { leadIds: ["L1", "L2", "L3"], agentId: "g2" } });
  assert.equal(mv.moved, 3); assert.equal(store.get("leads/L1").assignedTo, "g2");
  await rejects(L.reassignLeads({ ...admin, data: { leadIds: ["L1"], agentId: "a1" } }), "invalid-argument");
  // attendance
  await rejects(A.clockAction({ ...agent, data: { action: "out" } }), "failed-precondition");
  const c1 = await A.clockAction({ ...agent, data: { action: "in", tzOffsetMin: 0 } });
  assert.equal(c1.state, "in"); assert.equal(store.get("users/g1").presence.state, "in");
  await rejects(A.clockAction({ ...agent, data: { action: "in" } }), "failed-precondition");
  await A.clockAction({ ...agent, data: { action: "break" } });
  await A.clockAction({ ...agent, data: { action: "resume" } });
  const att = store.get(`attendance/g1_${c1.day}`);
  assert.equal(att.sessions.length, 2); assert.equal(att.breaks.length, 1); assert.equal(att.breaks[0].end !== null, true);
  await rejects(A.clockAction({ ...agent, data: { action: "out", userId: "a1" } }), "permission-denied");
  await A.clockAction({ ...admin, data: { action: "out", userId: "g1" } });
  assert.equal(store.get(`attendance/g1_${c1.day}`).state, "out"); assert.equal(store.get("users/g1").presence.state, "out");
  assert.ok(store.get(`attendance/g1_${c1.day}`).sessions.every((x) => x.out !== null));
  // targets
  await WP.setTarget({ ...admin, data: { agentId: "g1", month: "2026-11", orders: "20", delivered: 15, revenue: "1000.5" } });
  assert.deepEqual([store.get("targets/g1_2026-11").orders, store.get("targets/g1_2026-11").revenue], [20, 1000.5]);
  await rejects(WP.setTarget({ ...admin, data: { agentId: "g1", month: "2026-13" } }), "invalid-argument");
  await rejects(WP.setTarget({ ...agent, data: { agentId: "g1", month: "2026-11" } }), "permission-denied");
  // tasks
  const t = await WP.saveTask({ ...admin, data: { title: "Call VIPs", assignedTo: "g1", priority: "high", dueAtMs: 5 } });
  assert.equal(store.get(`tasks/${t.id}`).status, "open");
  await rejects(WP.setTaskStatus({ ...{ auth: { uid: "g2" } }, data: { id: t.id, status: "done" } }), "permission-denied");
  await WP.setTaskStatus({ ...agent, data: { id: t.id, status: "done", note: "ok" } });
  assert.equal(store.get(`tasks/${t.id}`).status, "done");
  await rejects(WP.saveTask({ ...admin, data: { title: "", assignedTo: "g1" } }), "invalid-argument");
  // announcements
  await WP.postAnnouncement({ ...admin, data: { title: "Hi team", body: "x", audience: "agent" } });
  await rejects(WP.postAnnouncement({ ...agent, data: { title: "x" } }), "permission-denied");
  await WP.markAnnouncementsRead({ ...agent, data: {} }); assert.equal(store.get("users/g1").announcementsSeenAt, "TS");
  // activity log
  const acts = [...store].filter(([k]) => k.startsWith("activity/")).map(([, v]) => v.action);
  for (const a of ["product.create", "stock.in", "order.verify", "order.cancel", "commission.pay", "leads.reassign", "task.create", "task.done", "announcement.post", "attendance.clockOut"]) assert.ok(acts.includes(a), a);
  // couriers: status mapping
  for (const [t, want] of [["Out for Delivery", "OutForDelivery"], ["Delivered", "Delivered"], ["Delivery failed", null], ["Return to client", "Returned"],
    ["Dispatch to Destination", "Dispatched"], ["Picked up", "Dispatched"], ["Processing", null], ["Undelivered", null]]) assert.equal(mapCourierStatus(t), want, t);
  // courier settings: secrets kept out of the readable doc, blank secret keeps the old one
  await rejects(SH.saveCourierConfig({ ...agent, data: { courierId: "transexpress" } }), "permission-denied");
  await SH.saveCourierConfig({ ...admin, data: { courierId: "transexpress", enabled: true, values: { apiKey: "KEY1", baseUrl: "https://te.test/api/" } } });
  assert.equal(store.get("courierSecrets/transexpress").apiKey, "KEY1"); assert.equal(store.get("courierConfigs/transexpress").values.apiKey, undefined);
  assert.equal(store.get("courierConfigs/transexpress").values.baseUrl, "https://te.test/api");
  await SH.saveCourierConfig({ ...admin, data: { courierId: "transexpress", enabled: true, values: { apiKey: "" } } });
  assert.equal(store.get("courierSecrets/transexpress").apiKey, "KEY1");
  const lc = await SH.listCouriers({ ...admin, data: {} });
  const te = lc.couriers.find((c) => c.id === "transexpress");
  assert.equal(te.enabled, true); assert.deepEqual(te.missing, []); assert.equal(te.fields.find((f) => f.key === "apiKey").value, "");
  assert.ok(lc.couriers.find((c) => c.id === "koombiyo").missing.length > 0);
  await rejects(SH.saveShippingSettings({ ...admin, data: { autoBook: true, defaultCourier: "manual" } }), "invalid-argument");
  await SH.saveShippingSettings({ ...admin, data: { autoBook: true, defaultCourier: "transexpress", sender: { name: "Shop", phone: "0771234567" } } });
  // auto-book on verify with Trans Express
  store.set("leads/L5", { name: "Nimal", phone: "94771234567", assignedTo: "g1", status: "Interested" });
  const o5 = (await O.createOrder({ ...agent, data: { leadId: "L5", address: "12 Main St", district: "Colombo", city: "Kohuwala", items: [{ productId: id, qty: 1 }] } })).orderId;
  assert.equal(store.get(`orders/${o5}`).customer.city, "Kohuwala");
  const v5 = await O.verifyOrder({ ...admin, data: { orderId: o5 } });
  assert.equal(v5.booking.ok, true, JSON.stringify(v5.booking)); assert.equal(v5.booking.waybill, "TE000001");
  const sent = JSON.parse(calls.find((c) => c.url.endsWith("single-auto-without-city")).init.body);
  assert.equal(sent.phone_no, "0771234567"); assert.equal(sent.cod, 12); assert.equal(sent.city, "Kohuwala");
  assert.equal(calls[0].init.headers.Authorization, "Bearer KEY1");
  let sh5 = store.get(`orders/${o5}`).shipment;
  assert.deepEqual([sh5.state, sh5.waybill, sh5.courierName], ["booked", "TE000001", "Trans Express"]);
  await rejects(SH.bookShipments({ ...admin, data: { orderIds: [o5], courierId: "transexpress" } }).then((r) => { if (!r.results[0].ok) { const e = new Error(r.results[0].error); e.code = "dup"; throw e; } }), "dup");
  await rejects(O.cancelOrder({ ...admin, data: { orderId: o5 } }), "failed-precondition");
  // tracking sync moves forward only and stores the courier text
  trackStatus = "Processing"; await SH.syncShipments({ ...admin, data: {} });
  assert.equal(store.get(`orders/${o5}`).status, "Verified"); assert.equal(store.get(`orders/${o5}`).shipment.courierStatus, "Processing");
  trackStatus = "Out for Delivery"; const sy = await SH.syncShipments({ ...admin, data: {} });
  assert.equal(sy.moved, 1); assert.equal(store.get(`orders/${o5}`).status, "OutForDelivery");
  trackStatus = "Picked up"; await SH.syncShipments({ ...admin, data: {} }); assert.equal(store.get(`orders/${o5}`).status, "OutForDelivery");
  trackStatus = "Delivered"; await SH.scheduledShipmentSync();
  assert.equal(store.get(`orders/${o5}`).status, "Delivered"); assert.equal(store.get(`orders/${o5}`).payment.status, "collected");
  // webhook by waybill on a closed order is refused
  await W.threePLWebhook({ method: "POST", get: () => "s", body: { waybill: "TE000001", status: "returned" } }, res); assert.equal(res.code, 409);
  // courier error is saved on the order, admin fixes the city and retries
  await SH.saveShippingSettings({ ...admin, data: { autoBook: false, defaultCourier: "transexpress" } });
  store.set("leads/L6", { name: "Kamal", phone: "0712345678", assignedTo: "g1", status: "Interested" });
  const o6 = (await O.createOrder({ ...agent, data: { leadId: "L6", address: "x", city: "Nowhere", district: "Colombo", items: [{ productId: id, qty: 1 }] } })).orderId;
  assert.equal((await O.verifyOrder({ ...admin, data: { orderId: o6 } })).booking, null);
  const b6 = await SH.bookShipments({ ...admin, data: { orderIds: [o6], courierId: "transexpress" } });
  assert.equal(b6.booked, 0); assert.match(store.get(`orders/${o6}`).shipment.error, /Invalid city/);
  await SH.updateShipTo({ ...admin, data: { orderId: o6, city: "Kohuwala", phone2: "0779999999" } });
  assert.equal((await SH.bookShipments({ ...admin, data: { orderIds: [o6], courierId: "transexpress" } })).booked, 1);
  await rejects(SH.updateShipTo({ ...admin, data: { orderId: o6, city: "X" } }), "failed-precondition");
  await SH.clearShipment({ ...admin, data: { orderId: o6 } }); assert.equal(store.get(`orders/${o6}`).shipment, null);
  // Koombiyo: needs settings, allocates a waybill, maps district and city to ids
  await rejects(SH.bookShipments({ ...admin, data: { orderIds: [o6], courierId: "koombiyo" } }), "failed-precondition");
  await SH.saveCourierConfig({ ...admin, data: { courierId: "koombiyo", enabled: true, values: { apiKey: "KB", baseUrl: "https://kb.test/api" } } });
  const kb = await SH.bookShipments({ ...admin, data: { orderIds: [o6], courierId: "koombiyo" } });
  assert.equal(kb.results[0].waybill, "459654070", JSON.stringify(kb));
  const add = new URLSearchParams(calls.filter((c) => c.url.endsWith("/Addorders/users")).pop().init.body);
  assert.deepEqual([add.get("receiverDistrict"), add.get("receiverCity"), add.get("apikey"), add.get("receiverPhone")], ["5", "77", "KB", "0712345678"]);
  assert.match(store.get(`orders/${o6}`).trackingUrl, /id=459654070&phone=0712345678/);
  await SH.clearShipment({ ...admin, data: { orderId: o6 } });
  // manual courier: typed waybill, status set by the admin, printed marker
  await SH.saveCourierConfig({ ...admin, data: { courierId: "manual", enabled: true, values: {} } });
  const mb = await SH.bookShipments({ ...admin, data: { orderIds: [o6], courierId: "manual", courierName: "Domex", waybills: { [o6]: "DX123" } } });
  assert.equal(mb.booked, 1); assert.deepEqual([store.get(`orders/${o6}`).shipment.courierName, store.get(`orders/${o6}`).shipment.waybill], ["Domex", "DX123"]);
  await SH.markWaybillsPrinted({ ...admin, data: { orderIds: [o6] } }); assert.ok(store.get(`orders/${o6}`).shipment.printedAt);
  await SH.setShipmentStatus({ ...admin, data: { orderId: o6, status: "Dispatched" } }); assert.equal(store.get(`orders/${o6}`).status, "Dispatched");
  await rejects(SH.setShipmentStatus({ ...admin, data: { orderId: o6, status: "Pending" } }), "invalid-argument");
  await SH.setShipmentStatus({ ...admin, data: { orderId: o6, status: "Returned" } });
  assert.equal(store.get(`orders/${o6}`).stockDeducted, false);
  console.log(moves().map((m) => `${m.reason}:${m.delta}->${m.balance}`).join(" "));
  console.log("ALL PASS");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });

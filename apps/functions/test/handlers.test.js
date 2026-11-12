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
function qry(c, filters) { return { isQuery: true, where: (f, op, v) => qry(c, [...filters, [f, v]]),
  docs: () => [...store].filter(([k, d]) => k.startsWith(c + "/") && k.split("/").length === c.split("/").length + 1 && filters.every(([f, v]) => d[f] === v)).map(([k]) => snap(k)) }; }
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
  [path.join(FN, "src/lib/firebase.js")]: { db, FieldValue, Timestamp: { fromMillis: (m) => ({ ms: m }), now: () => ({ ms: Date.now() }) }, admin: {} },
  [path.join(FN, "src/services/notify.js")]: { notify: async () => {} },
};
const orig = Module._load;
Module._load = function (req, parent, isMain) { const r = mocks[req] ? req : (() => { try { return Module._resolveFilename(req, parent); } catch { return req; } })(); return mocks[r] || orig.apply(this, arguments); };
const P = require(FN + "/src/handlers/products.js"), O = require(FN + "/src/handlers/orders.js"), W = require(FN + "/src/handlers/webhook.js"), F = require(FN + "/src/handlers/finance.js"), S = require(FN + "/src/handlers/staff.js"), L = require(FN + "/src/handlers/leads.js"), A = require(FN + "/src/handlers/attendance.js"), WP = require(FN + "/src/handlers/workplace.js");
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
  console.log(moves().map((m) => `${m.reason}:${m.delta}->${m.balance}`).join(" "));
  console.log("ALL PASS");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });

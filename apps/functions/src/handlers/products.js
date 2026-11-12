const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { syncLowStockAlert } = require("../services/alerts");
const { ADJUST_REASONS, stockMove } = require("../lib/stock");

// Cost price lives in admin-only `productCosts/{productId}` because agents can read `products`.
const costRef = (id) => db.doc(`productCosts/${id}`);

// Create or edit a product. Stock is only set here as opening stock on create;
// afterwards it changes through adjustStock, order verification and returns.
exports.saveProduct = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { id, name, sku, price, stock, minStockLevel, costPrice } = req.data;
  const data = { name, sku, price: Number(price), minStockLevel: Number(minStockLevel) || 0 };
  if (Number.isNaN(data.price) || data.price < 0) throw new HttpsError("invalid-argument", "Bad price.");
  const cost = costPrice === undefined || costPrice === "" ? null : Number(costPrice);
  if (cost !== null && (Number.isNaN(cost) || cost < 0)) throw new HttpsError("invalid-argument", "Bad cost price.");

  const ref = id ? db.doc(`products/${id}`) : db.collection("products").doc();
  let current;
  await db.runTransaction(async (tx) => {
    if (id) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Product not found.");
      tx.update(ref, data);
      current = { ...snap.data(), ...data };
    } else {
      const opening = parseInt(stock, 10) || 0;
      if (opening < 0) throw new HttpsError("invalid-argument", "Bad stock.");
      current = { ...data, stock: opening, reserved: 0, isActive: true };
      tx.set(ref, { ...current, createdAt: FieldValue.serverTimestamp() });
      if (opening) stockMove(tx, { productId: ref.id, name, delta: opening, balance: opening, reason: "opening", by: u.uid, unitCost: cost });
    }
    if (cost !== null) tx.set(costRef(ref.id), { costPrice: cost, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  await syncLowStockAlert(ref.id, current.name, current.stock, current.minStockLevel);
  await logActivity(u, id ? "product.edit" : "product.create", `${name} (price ${data.price})`, { type: "product", id: ref.id });
  return { id: ref.id };
});

// Admin stock change.
//  type "in":     goods received. qty > 0, optional unitCost (updates weighted average cost) and supplier.
//  type "adjust": correction. qty may be negative; reason is one of ADJUST_REASONS.
exports.adjustStock = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { productId, type, supplier, note } = req.data;
  const qty = parseInt(req.data.qty, 10);
  const unitCost = req.data.unitCost === undefined || req.data.unitCost === "" ? null : Number(req.data.unitCost);
  if (!["in", "adjust"].includes(type)) throw new HttpsError("invalid-argument", "Bad type.");
  if (!Number.isInteger(qty) || qty === 0 || (type === "in" && qty < 0)) throw new HttpsError("invalid-argument", "Bad quantity.");
  if (unitCost !== null && (Number.isNaN(unitCost) || unitCost < 0)) throw new HttpsError("invalid-argument", "Bad unit cost.");
  const reason = type === "in" ? "purchase" : "adjustment";
  const why = type === "adjust" ? (ADJUST_REASONS.includes(req.data.reason) ? req.data.reason : "other") : null;

  const ref = db.doc(`products/${productId}`);
  const p = await db.runTransaction(async (tx) => {
    const [snap, costSnap] = await Promise.all([tx.get(ref), tx.get(costRef(productId))]);
    if (!snap.exists) throw new HttpsError("not-found", "Product not found.");
    const prod = snap.data();
    const balance = (prod.stock || 0) + qty;
    if (balance < (prod.reserved || 0)) {
      throw new HttpsError("failed-precondition", `Stock can't go below the ${prod.reserved || 0} reserved by pending orders.`);
    }
    tx.update(ref, { stock: balance });
    if (type === "in" && unitCost !== null) {
      const old = costSnap.exists ? costSnap.data().costPrice : null;
      const onHand = Math.max(prod.stock || 0, 0);
      const avg = old === null || onHand === 0 ? unitCost : (onHand * old + qty * unitCost) / (onHand + qty);
      tx.set(costRef(productId), { costPrice: Math.round(avg * 100) / 100, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    stockMove(tx, {
      productId, name: prod.name, delta: qty, balance, reason, by: u.uid, unitCost,
      supplier: type === "in" ? supplier || null : null,
      note: [why, note].filter(Boolean).join(": "),
    });
    return { ...prod, stock: balance };
  });
  await syncLowStockAlert(productId, p.name, p.stock, p.minStockLevel || 0);
  await logActivity(u, type === "in" ? "stock.in" : "stock.adjust", `${p.name}: ${qty > 0 ? "+" : ""}${qty} → ${p.stock}${why ? ` (${why})` : ""}`, { type: "product", id: productId });
  return { stock: p.stock };
});

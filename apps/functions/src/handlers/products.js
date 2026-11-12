const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { requireAdmin } = require("../lib/auth");
const { syncLowStockAlert } = require("../services/alerts");

exports.saveProduct = onCall(async (req) => {
  await requireAdmin(req.auth);
  const { id, name, sku, price, stock, minStockLevel } = req.data;
  const data = { name, sku, price: Number(price), stock: Number(stock), minStockLevel: Number(minStockLevel) || 0 };
  if ([data.price, data.stock].some(Number.isNaN)) throw new HttpsError("invalid-argument", "Bad numbers.");
  const ref = id ? db.doc(`products/${id}`) : db.collection("products").doc();
  if (id) await ref.update(data); else await ref.set({ ...data, isActive: true, createdAt: FieldValue.serverTimestamp() });
  await syncLowStockAlert(ref.id, data.name, data.stock, data.minStockLevel);
  return { id: ref.id };
});

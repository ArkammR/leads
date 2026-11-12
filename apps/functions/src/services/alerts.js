const { db, FieldValue } = require("../lib/firebase");

async function syncLowStockAlert(productId, name, stock, min) {
  const ref = db.doc(`alerts/low_${productId}`);
  if (stock <= min) await ref.set({ type: "low_stock", productId, name, stock, minStockLevel: min, resolved: false, createdAt: FieldValue.serverTimestamp() });
  else await ref.set({ resolved: true, stock }, { merge: true });
}

module.exports = { syncLowStockAlert };

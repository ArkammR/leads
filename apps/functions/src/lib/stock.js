const { db, FieldValue } = require("./firebase");

// Every change to `products.stock` writes one append-only `stockMoves` entry.
// reason: opening | purchase | adjustment | sale | return
const STOCK_REASONS = ["opening", "purchase", "adjustment", "sale", "return"];
const ADJUST_REASONS = ["damaged", "lost", "recount", "other"];

function stockMove(tx, { productId, name, delta, balance, reason, by, orderId = null, unitCost = null, supplier = null, note = "" }) {
  tx.set(db.collection("stockMoves").doc(), {
    productId, name, delta, balance, reason, by, orderId, unitCost, supplier, note,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// Sum quantities per productId (an order may list the same product twice).
function qtyByProduct(items) {
  const need = {};
  for (const i of items) need[i.productId] = (need[i.productId] || 0) + i.qty;
  return need;
}

module.exports = { STOCK_REASONS, ADJUST_REASONS, stockMove, qtyByProduct };

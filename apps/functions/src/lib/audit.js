const { FieldValue } = require("./firebase");

// Append-only audit entry. Clients can never write `history` (see firestore.rules).
function auditRef(parentRef) { return parentRef.collection("history").doc(); }
function auditData(userId, previousStatus, newStatus, note = "") {
  return { userId, previousStatus: previousStatus ?? null, newStatus, note, timestamp: FieldValue.serverTimestamp() };
}

module.exports = { auditRef, auditData };

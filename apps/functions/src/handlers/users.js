const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db, FieldValue } = require("../lib/firebase");
const { requireAdmin } = require("../lib/auth");

exports.createUser = onCall(async (req) => {
  await requireAdmin(req.auth);
  const { email, password, name, role } = req.data;
  if (!["admin", "agent"].includes(role)) throw new HttpsError("invalid-argument", "Bad role.");
  const u = await admin.auth().createUser({ email, password, displayName: name });
  await db.doc(`users/${u.uid}`).set({ email, name, role, isActive: true, createdAt: FieldValue.serverTimestamp() });
  return { uid: u.uid };
});

// Soft delete: nothing is ever physically removed.
exports.setActive = onCall(async (req) => {
  await requireAdmin(req.auth);
  const { collection, id, isActive } = req.data;
  if (!["users", "products", "leads", "expenses"].includes(collection)) throw new HttpsError("invalid-argument", "Bad collection.");
  await db.doc(`${collection}/${id}`).update({ isActive: !!isActive });
  if (collection === "users") await admin.auth().updateUser(id, { disabled: !isActive });
  return { ok: true };
});

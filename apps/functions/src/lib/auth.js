const { HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./firebase");

async function getUser(auth) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const snap = await db.doc(`users/${auth.uid}`).get();
  if (!snap.exists || !snap.data().isActive) throw new HttpsError("permission-denied", "Inactive or unknown user.");
  return { uid: auth.uid, ...snap.data() };
}
async function requireAdmin(auth) {
  const u = await getUser(auth);
  if (u.role !== "admin") throw new HttpsError("permission-denied", "Admin only.");
  return u;
}

module.exports = { getUser, requireAdmin };

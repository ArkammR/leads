const { onCall } = require("firebase-functions/v2/https");
const { db } = require("../lib/firebase");
const { requireAdmin } = require("../lib/auth");

exports.resolveAlert = onCall(async (req) => {
  await requireAdmin(req.auth);
  await db.doc(`alerts/${req.data.id}`).update({ resolved: true });
  return { ok: true };
});

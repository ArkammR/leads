const { db, FieldValue } = require("./firebase");

// Company-wide activity log ("who did what"), shown to admins on the Activity page.
// Written after the action succeeds; a logging failure never fails the action itself.
async function logActivity(user, action, summary, target = null) {
  try {
    await db.collection("activity").add({
      userId: user.uid, userName: user.name || "", role: user.role || "",
      action, summary: String(summary || "").slice(0, 300), target,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("activity log failed", action, e);
  }
}

module.exports = { logActivity };

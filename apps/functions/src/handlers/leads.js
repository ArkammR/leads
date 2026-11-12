const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue, Timestamp } = require("../lib/firebase");
const { getUser, requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { auditRef, auditData } = require("../lib/audit");
const { chunks } = require("../lib/util");
const { ingestLeads } = require("../lib/ingest");
const { LEAD_STATUSES, CALLBACK_STATUSES } = require("../constants");

// Manual CSV/Excel upload. rows: [{name, phone, email}], mode: "roundRobin" | "manual" (+agentId)
exports.importLeads = onCall(async (req) => {
  const admin_ = await requireAdmin(req.auth);
  const { rows, mode, agentId } = req.data;
  if (!Array.isArray(rows) || !rows.length) throw new HttpsError("invalid-argument", "No rows.");
  if (rows.length > 20000) throw new HttpsError("invalid-argument", "Upload at most 20,000 rows at a time.");
  const { created, duplicates } = await ingestLeads(rows, { mode, agentId, source: "csv", by: admin_.uid, note: `imported (${mode})` });
  await logActivity(admin_, "leads.import", `${created.length} leads imported (${mode}), ${duplicates.length} skipped`);
  return { created: created.length, duplicates };
});

exports.updateLeadStatus = onCall(async (req) => {
  const u = await getUser(req.auth);
  const { leadId, status, callbackAtMs, note } = req.data;
  if (!LEAD_STATUSES.includes(status)) throw new HttpsError("invalid-argument", "Bad status.");
  let callbackAt = null;
  if (CALLBACK_STATUSES.includes(status)) {
    if (!callbackAtMs || callbackAtMs < Date.now() - 60000) throw new HttpsError("invalid-argument", "A future callback time is required for this status.");
    callbackAt = Timestamp.fromMillis(callbackAtMs);
  }
  const ref = db.doc(`leads/${leadId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Lead not found.");
    const lead = snap.data();
    if (u.role !== "admin" && lead.assignedTo !== u.uid) throw new HttpsError("permission-denied", "Not your lead.");
    tx.update(ref, { status, callbackAt, lastContactedAt: FieldValue.serverTimestamp() });
    tx.set(auditRef(ref), auditData(u.uid, lead.status, status, note || (callbackAt ? `callback ${callbackAt.toDate().toISOString()}` : "")));
  });
  return { ok: true };
});

// Admin moves leads to another active agent (e.g. someone left or is overloaded). Existing orders keep their agent.
exports.reassignLeads = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { leadIds, agentId } = req.data;
  if (!Array.isArray(leadIds) || !leadIds.length || leadIds.length > 2000) throw new HttpsError("invalid-argument", "Pick 1 to 2000 leads.");
  const a = await db.doc(`users/${agentId}`).get();
  if (!a.exists || a.data().role !== "agent" || !a.data().isActive) throw new HttpsError("invalid-argument", "Pick an active agent.");
  let moved = 0;
  for (const chunk of chunks([...new Set(leadIds)], 200)) {
    const snaps = await db.getAll(...chunk.map((id) => db.doc(`leads/${id}`)));
    const batch = db.batch();
    for (const s of snaps) {
      if (!s.exists || s.data().assignedTo === agentId) continue;
      batch.update(s.ref, { assignedTo: agentId });
      batch.set(auditRef(s.ref), auditData(u.uid, s.data().status, s.data().status, `reassigned to ${a.data().name}`));
      moved++;
    }
    await batch.commit();
  }
  await logActivity(u, "leads.reassign", `${moved} leads → ${a.data().name}`, { type: "user", id: agentId });
  return { moved };
});

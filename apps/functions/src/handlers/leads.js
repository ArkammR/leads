const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue, Timestamp } = require("../lib/firebase");
const { getUser, requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { auditRef, auditData } = require("../lib/audit");
const { normPhone, normEmail, chunks } = require("../lib/util");
const { LEAD_STATUSES, CALLBACK_STATUSES } = require("../constants");

// rows: [{name, phone, email}], mode: "roundRobin" | "manual" (+agentId)
exports.importLeads = onCall(async (req) => {
  const admin_ = await requireAdmin(req.auth);
  const { rows, mode, agentId } = req.data;
  if (!Array.isArray(rows) || !rows.length) throw new HttpsError("invalid-argument", "No rows.");

  // Duplicate detection: within the file and against existing active leads (phone or email)
  const seenPhones = new Set(), seenEmails = new Set();
  const candidates = [], duplicates = [];
  for (const r of rows) {
    const phone = normPhone(r.phone), email = normEmail(r.email);
    if (!phone) { duplicates.push({ ...r, reason: "missing phone" }); continue; }
    if (seenPhones.has(phone) || (email && seenEmails.has(email))) { duplicates.push({ ...r, reason: "duplicate in file" }); continue; }
    seenPhones.add(phone); if (email) seenEmails.add(email);
    candidates.push({ name: String(r.name || "").trim(), phone, email });
  }
  const existingPhones = new Set(), existingEmails = new Set();
  for (const c of chunks([...seenPhones], 30)) {
    (await db.collection("leads").where("phone", "in", c).get()).forEach((d) => existingPhones.add(d.data().phone));
  }
  for (const c of chunks([...seenEmails], 30)) {
    (await db.collection("leads").where("email", "in", c).get()).forEach((d) => existingEmails.add(d.data().email));
  }
  const fresh = [];
  for (const c of candidates) {
    if (existingPhones.has(c.phone) || (c.email && existingEmails.has(c.email))) duplicates.push({ ...c, reason: "already exists" });
    else fresh.push(c);
  }

  // Assignment
  let agents = [];
  if (mode === "roundRobin") {
    const s = await db.collection("users").where("role", "==", "agent").where("isActive", "==", true).get();
    agents = s.docs.map((d) => d.id).sort();
    if (!agents.length) throw new HttpsError("failed-precondition", "No active agents.");
  } else if (mode === "manual") {
    const a = await db.doc(`users/${agentId}`).get();
    if (!a.exists || a.data().role !== "agent" || !a.data().isActive) throw new HttpsError("invalid-argument", "Bad agent.");
  } else throw new HttpsError("invalid-argument", "Bad mode.");

  const rrRef = db.doc("config/roundRobin");
  let cursor = mode === "roundRobin" ? ((await rrRef.get()).data()?.next || 0) : 0;

  for (const chunk of chunks(fresh, 200)) {
    const batch = db.batch();
    for (const c of chunk) {
      const assignedTo = mode === "roundRobin" ? agents[cursor++ % agents.length] : agentId;
      const ref = db.collection("leads").doc();
      batch.set(ref, { ...c, status: "New", assignedTo, callbackAt: null, isActive: true, createdAt: FieldValue.serverTimestamp() });
      batch.set(auditRef(ref), auditData(admin_.uid, null, "New", `imported (${mode})`));
    }
    await batch.commit();
  }
  if (mode === "roundRobin") await rrRef.set({ next: cursor % agents.length });
  await logActivity(admin_, "leads.import", `${fresh.length} leads imported (${mode}), ${duplicates.length} skipped`);
  return { created: fresh.length, duplicates };
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

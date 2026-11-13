const { HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("./firebase");
const { auditRef, auditData } = require("./audit");
const { normPhone, phoneVariants, normEmail, chunks } = require("./util");

// Every lead, whether from a CSV upload or a connected platform, goes through here:
// clean up → skip duplicates (in the batch and against existing leads) → assign → write with source tag.
//
// rows: [{ name, phone, email, externalId?, channel?, extra? }]
// opts: { mode: "roundRobin" | "manual", agentId, source: "csv" | "facebook" | ..., sourceId, by, note,
//         auto: true for platform webhooks (never throws on "no agents"; leaves the lead unassigned) }
async function ingestLeads(rows, opts) {
  const { mode = "roundRobin", agentId = null, source = "csv", sourceId = null, by, note = "", auto = false } = opts;

  const seenPhones = new Set(), seenEmails = new Set();
  const candidates = [], duplicates = [];
  for (const r of rows) {
    const phone = normPhone(r.phone), email = normEmail(r.email);
    const name = String(r.name || "").trim().slice(0, 120);
    if (!phone || phone.length < 7) { duplicates.push({ name, phone: r.phone || "", email, reason: "missing phone" }); continue; }
    if (seenPhones.has(phone) || (email && seenEmails.has(email))) { duplicates.push({ name, phone, email, reason: "duplicate in file" }); continue; }
    seenPhones.add(phone); if (email) seenEmails.add(email);
    const c = { name, phone, email };
    if (r.externalId) c.externalId = String(r.externalId).slice(0, 120);
    if (r.channel) c.channel = String(r.channel).slice(0, 40);
    if (r.extra && Object.keys(r.extra).length) c.extra = r.extra;
    candidates.push(c);
  }

  // Existing leads, by phone (both stored formats) or email. Keep the doc so platform repeats can be noted on it.
  const byPhone = new Map(), byEmail = new Map();
  const legacy = new Map(); // stored variant -> canonical
  for (const p of seenPhones) for (const v of phoneVariants(p)) legacy.set(v, p);
  for (const c of chunks([...legacy.keys()], 30)) {
    (await db.collection("leads").where("phone", "in", c).get()).forEach((d) => byPhone.set(legacy.get(d.data().phone), d));
  }
  for (const c of chunks([...seenEmails], 30)) {
    (await db.collection("leads").where("email", "in", c).get()).forEach((d) => byEmail.set(d.data().email, d));
  }
  const fresh = [], repeats = [];
  for (const c of candidates) {
    const hit = byPhone.get(c.phone) || (c.email && byEmail.get(c.email));
    if (hit) { duplicates.push({ ...c, reason: "already exists", leadId: hit.id }); repeats.push(hit); }
    else fresh.push(c);
  }

  // Assignment
  let agents = [];
  if (mode === "roundRobin") {
    const s = await db.collection("users").where("role", "==", "agent").where("isActive", "==", true).get();
    agents = s.docs.map((d) => d.id).sort();
    if (!agents.length && !auto) throw new HttpsError("failed-precondition", "No active agents.");
  } else if (mode === "manual") {
    const a = agentId ? await db.doc(`users/${agentId}`).get() : null;
    const ok = a && a.exists && a.data().role === "agent" && a.data().isActive;
    if (!ok && !auto) throw new HttpsError("invalid-argument", "Bad agent.");
    if (ok) agents = [agentId];
  } else throw new HttpsError("invalid-argument", "Bad mode.");

  // Reserve round-robin slots atomically: webhooks can arrive at the same moment.
  let cursor = 0;
  if (mode === "roundRobin" && agents.length && fresh.length) {
    const rrRef = db.doc("config/roundRobin");
    cursor = await db.runTransaction(async (tx) => {
      const start = (await tx.get(rrRef)).data()?.next || 0;
      tx.set(rrRef, { next: (start + fresh.length) % agents.length });
      return start;
    });
  }

  const created = [];
  for (const chunk of chunks(fresh, 200)) {
    const batch = db.batch();
    for (const c of chunk) {
      const assignedTo = agents.length ? agents[cursor++ % agents.length] : null;
      const ref = db.collection("leads").doc();
      batch.set(ref, {
        ...c, source, sourceId, status: "New", assignedTo, callbackAt: null, isActive: true, createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(auditRef(ref), auditData(by, null, "New", note || `imported (${source}, ${mode})${assignedTo ? "" : ", unassigned: no active agent"}`));
      created.push({ id: ref.id, assignedTo });
    }
    await batch.commit();
  }

  // A known customer filled in another form: leave a note in that lead's history so the agent sees it.
  if (auto && repeats.length) {
    const batch = db.batch();
    for (const d of repeats) {
      batch.set(auditRef(d.ref), auditData(by, d.data().status, d.data().status, `enquired again via ${source}`));
      batch.update(d.ref, { lastEnquiryAt: FieldValue.serverTimestamp(), enquiries: FieldValue.increment(1) });
    }
    await batch.commit();
  }

  return { created, duplicates };
}

module.exports = { ingestLeads };

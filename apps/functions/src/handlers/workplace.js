const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue, Timestamp } = require("../lib/firebase");
const { getUser, requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { isMonth } = require("../lib/time");

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
const str = (v, max) => String(v ?? "").trim().slice(0, max);

/* ---------- monthly targets: targets/{agentId}_{YYYY-MM} ---------- */
exports.setTarget = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { agentId, month } = req.data || {};
  if (!isMonth(month)) throw new HttpsError("invalid-argument", "Month must be YYYY-MM.");
  const agent = await db.doc(`users/${agentId}`).get();
  if (!agent.exists || agent.data().role !== "agent") throw new HttpsError("invalid-argument", "Pick an agent.");
  const t = { orders: Math.floor(num(req.data.orders)), delivered: Math.floor(num(req.data.delivered)), revenue: num(req.data.revenue) };
  await db.doc(`targets/${agentId}_${month}`).set({ agentId, month, ...t, by: u.uid, updatedAt: FieldValue.serverTimestamp() });
  await logActivity(u, "target.set", `${agent.data().name} ${month}: ${t.orders} orders, ${t.delivered} delivered, ${t.revenue} revenue`, { type: "user", id: agentId });
  return { ok: true };
});

/* ---------- tasks ---------- */
const PRIORITIES = ["low", "normal", "high"];

// Admin creates or edits a task for a staff member.
exports.saveTask = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { id, assignedTo, priority } = req.data || {};
  const title = str(req.data?.title, 140);
  if (!title) throw new HttpsError("invalid-argument", "Title is required.");
  const who = await db.doc(`users/${assignedTo}`).get();
  if (!who.exists || !who.data().isActive) throw new HttpsError("invalid-argument", "Pick an active team member.");
  const dueMs = req.data.dueAtMs ? Number(req.data.dueAtMs) : null;
  if (dueMs !== null && !Number.isFinite(dueMs)) throw new HttpsError("invalid-argument", "Bad due date.");
  const data = {
    title, details: str(req.data.details, 2000), assignedTo, assignedName: who.data().name || "",
    priority: PRIORITIES.includes(priority) ? priority : "normal", dueAt: dueMs === null ? null : Timestamp.fromMillis(dueMs),
  };
  let ref;
  if (id) {
    ref = db.doc(`tasks/${id}`);
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "Task not found.");
    await ref.update({ ...data, updatedAt: FieldValue.serverTimestamp() });
  } else {
    ref = db.collection("tasks").doc();
    await ref.set({ ...data, status: "open", isActive: true, createdBy: u.uid, createdByName: u.name || "", createdAt: FieldValue.serverTimestamp(), doneAt: null, doneNote: "" });
  }
  await logActivity(u, id ? "task.edit" : "task.create", `${title} → ${data.assignedName}`, { type: "task", id: ref.id });
  return { id: ref.id };
});

// The assignee (or an admin) marks a task done or reopens it.
exports.setTaskStatus = onCall(async (req) => {
  const u = await getUser(req.auth);
  const { id, status } = req.data || {};
  if (!["open", "done"].includes(status)) throw new HttpsError("invalid-argument", "Bad status.");
  const ref = db.doc(`tasks/${id}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data().isActive === false) throw new HttpsError("not-found", "Task not found.");
  if (u.role !== "admin" && snap.data().assignedTo !== u.uid) throw new HttpsError("permission-denied", "Not your task.");
  await ref.update(status === "done"
    ? { status, doneAt: FieldValue.serverTimestamp(), doneBy: u.uid, doneNote: str(req.data.note, 500) }
    : { status, doneAt: null, doneBy: null });
  await logActivity(u, status === "done" ? "task.done" : "task.reopen", snap.data().title, { type: "task", id });
  return { ok: true };
});

/* ---------- announcements ---------- */
const AUDIENCES = ["all", "agent", "admin"];

exports.postAnnouncement = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const title = str(req.data?.title, 140), body = str(req.data?.body, 4000);
  if (!title) throw new HttpsError("invalid-argument", "Title is required.");
  const audience = AUDIENCES.includes(req.data.audience) ? req.data.audience : "all";
  const ref = await db.collection("announcements").add({
    title, body, audience, pinned: !!req.data.pinned, isActive: true, by: u.uid, byName: u.name || "", createdAt: FieldValue.serverTimestamp(),
  });
  await logActivity(u, "announcement.post", title, { type: "announcement", id: ref.id });
  return { id: ref.id };
});

// Marks everything up to now as read for the caller (unread = createdAt after announcementsSeenAt).
exports.markAnnouncementsRead = onCall(async (req) => {
  const u = await getUser(req.auth);
  await db.doc(`users/${u.uid}`).update({ announcementsSeenAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

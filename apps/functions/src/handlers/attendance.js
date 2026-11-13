const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { getUser } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { localDay } = require("../lib/time");

// Attendance: one doc per person per day, `attendance/{uid}_{YYYY-MM-DD}`.
//   sessions: [{ in, out }]   work periods (ms; out null while running)
//   breaks:   [{ start, end }]
//   state: "in" | "break" | "out", workedMin, breakMin
// `users/{uid}.presence = { state, day, since }` drives the live "who's working" view.
// A shift that runs past midnight stays on the day it started (presence.day).
const ACTIONS = { in: ["out"], break: ["in"], resume: ["break"], out: ["in", "break"] };
const mins = (list, a, b, now) => Math.round(list.reduce((s, x) => s + ((x[b] ?? now) - x[a]), 0) / 60000);

function applyAction(doc, action, now) {
  const sessions = (doc.sessions || []).map((s) => ({ ...s }));
  const breaks = (doc.breaks || []).map((b) => ({ ...b }));
  const openSession = sessions.find((s) => s.out === null);
  const openBreak = breaks.find((b) => b.end === null);
  if (openSession && action !== "in") openSession.out = now;
  if (openBreak && (action === "resume" || action === "out")) openBreak.end = now;
  if (action === "in" || action === "resume") sessions.push({ in: now, out: null });
  if (action === "break") breaks.push({ start: now, end: null });
  const state = action === "out" ? "out" : action === "break" ? "break" : "in";
  return { sessions, breaks, state, workedMin: mins(sessions, "in", "out", now), breakMin: mins(breaks, "start", "end", now) };
}

// action: in | break | resume | out. An admin may pass userId with action "out" to close someone's forgotten shift.
exports.clockAction = onCall(async (req) => {
  const me = await getUser(req.auth);
  const { action, tzOffsetMin, userId } = req.data || {};
  if (!ACTIONS[action]) throw new HttpsError("invalid-argument", "Bad action.");
  const forOther = userId && userId !== me.uid;
  if (forOther && (me.role !== "admin" || action !== "out")) throw new HttpsError("permission-denied", "Admins can only clock other people out.");
  const uid = forOther ? userId : me.uid;
  const userRef = db.doc(`users/${uid}`);
  const now = Date.now();

  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
    const u = userSnap.data();
    const presence = u.presence || { state: "out" };
    if (!ACTIONS[action].includes(presence.state)) {
      throw new HttpsError("failed-precondition", presence.state === "out" ? "Clock in first." : `You are already ${presence.state === "in" ? "clocked in" : "on a break"}.`);
    }
    const day = presence.state === "out" ? localDay(now, tzOffsetMin) : presence.day;
    const ref = db.doc(`attendance/${uid}_${day}`);
    const snap = await tx.get(ref);
    const next = applyAction(snap.exists ? snap.data() : {}, action, now);
    const base = snap.exists ? {} : { userId: uid, userName: u.name || "", role: u.role || "", date: day, firstIn: now };
    tx.set(ref, { ...base, ...next, lastAction: action, updatedAt: FieldValue.serverTimestamp(), ...(forOther ? { closedBy: me.uid } : {}) }, { merge: true });
    tx.update(userRef, { presence: { state: next.state, day, since: now } });
    return { state: next.state, day, workedMin: next.workedMin, name: u.name || uid };
  });
  if (forOther) await logActivity(me, "attendance.clockOut", `clocked out ${result.name} (${result.day})`, { type: "user", id: uid });
  return result;
});


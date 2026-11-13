const crypto = require("crypto");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/firebase");
const { requireAdmin } = require("../lib/auth");
const { logActivity } = require("../lib/activity");
const { env } = require("../lib/util");
const { ingestLeads } = require("../lib/ingest");
const P = require("../lib/leadParse");

// Connected lead sources. Admins add one per platform/form; each gets its own webhook URL + key.
//   leadSources/{id}        type, name, mode, agentId, isActive, key, pages[], waPhoneNumberId, stats, lastLeadAt
//   leadSourceSecrets/{id}  Facebook Page access tokens (no client access; see firestore.rules)
//   leadEvents/{id}         every incoming lead and what happened to it (created / duplicate / rejected / test / error)
const TYPES = ["facebook", "google", "tiktok", "website", "whatsapp"];
const LABEL = { facebook: "Facebook/Instagram", google: "Google Ads", tiktok: "TikTok", website: "Website", whatsapp: "WhatsApp" };
const GRAPH = () => `https://graph.facebook.com/${env("META_GRAPH_VERSION") || "v21.0"}`;
const META_SCOPES = "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_manage_ads,leads_retrieval,business_management";
const newKey = () => crypto.randomBytes(18).toString("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };

exports.saveLeadSource = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const { id, type, name, mode = "roundRobin", agentId = null, isActive = true, waPhoneNumberId = "" } = req.data || {};
  if (!["roundRobin", "manual"].includes(mode)) throw new HttpsError("invalid-argument", "Bad assignment mode.");
  if (mode === "manual") {
    const a = agentId ? await db.doc(`users/${agentId}`).get() : null;
    if (!a || !a.exists || a.data().role !== "agent" || !a.data().isActive) throw new HttpsError("invalid-argument", "Pick an active agent.");
  }
  const data = { name: String(name || "").trim().slice(0, 80), mode, agentId: mode === "manual" ? agentId : null, isActive: !!isActive,
    waPhoneNumberId: String(waPhoneNumberId || "").replace(/\D/g, ""), updatedAt: FieldValue.serverTimestamp() };
  if (id) {
    const ref = db.doc(`leadSources/${id}`);
    const s = await ref.get();
    if (!s.exists) throw new HttpsError("not-found", "Source not found.");
    if (!data.name) data.name = s.data().name;
    await ref.update(data);
    await logActivity(u, "leadSource.update", `${data.name}: ${data.isActive ? "on" : "paused"}, ${mode}`, { type: "leadSource", id });
    return { id };
  }
  if (!TYPES.includes(type)) throw new HttpsError("invalid-argument", "Bad source type.");
  const ref = db.collection("leadSources").doc();
  await ref.set({ ...data, name: data.name || LABEL[type], type, key: newKey(), pages: [], pageIds: [],
    stats: { received: 0, created: 0, duplicates: 0, rejected: 0 }, lastLeadAt: null, createdAt: FieldValue.serverTimestamp() });
  await logActivity(u, "leadSource.create", `${LABEL[type]} source "${data.name || LABEL[type]}" added`, { type: "leadSource", id: ref.id });
  return { id: ref.id };
});

exports.rotateLeadSourceKey = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  const ref = db.doc(`leadSources/${req.data?.id}`);
  const s = await ref.get();
  if (!s.exists) throw new HttpsError("not-found", "Source not found.");
  await ref.update({ key: newKey() });
  await logActivity(u, "leadSource.rotateKey", `New webhook key for ${s.data().name}`, { type: "leadSource", id: ref.id });
  return { ok: true };
});

// ---------- shared: run parsed leads through the pipeline and log what happened ----------
async function receive(src, leads, { test = false } = {}) {
  const ref = db.doc(`leadSources/${src.id}`);
  const events = db.collection("leadEvents");
  const base = { sourceId: src.id, source: src.type, createdAt: FieldValue.serverTimestamp() };
  if (test) {
    for (const l of leads) await events.add({ ...base, status: "test", name: l.name || "", phone: l.phone || "", reason: "test lead from platform (not saved)" });
    await ref.update({ lastTestAt: FieldValue.serverTimestamp() });
    return { created: 0, duplicates: 0 };
  }
  let res;
  try {
    res = await ingestLeads(leads, { mode: src.mode, agentId: src.agentId, source: src.type, sourceId: src.id, by: `source:${src.type}`, auto: true });
  } catch (e) {
    console.error("ingest failed", src.id, e);
    await events.add({ ...base, status: "error", reason: String(e.message || e).slice(0, 300) });
    throw e;
  }
  const batch = db.batch();
  for (const c of res.created) batch.set(events.doc(), { ...base, status: "created", leadId: c.id, assignedTo: c.assignedTo });
  for (const d of res.duplicates) {
    batch.set(events.doc(), { ...base, status: d.reason === "missing phone" ? "rejected" : "duplicate", name: d.name || "", phone: d.phone || "", reason: d.reason, leadId: d.leadId || null });
  }
  const rejected = res.duplicates.filter((d) => d.reason === "missing phone").length;
  batch.update(ref, {
    "stats.received": FieldValue.increment(leads.length), "stats.created": FieldValue.increment(res.created.length),
    "stats.duplicates": FieldValue.increment(res.duplicates.length - rejected), "stats.rejected": FieldValue.increment(rejected),
    lastLeadAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { created: res.created.length, duplicates: res.duplicates.length };
}

const loadSource = async (id) => {
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const s = await db.doc(`leadSources/${id}`).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
};

// ---------- 1. Webhook per source: website forms, Zapier/Make, Google Ads, TikTok, Twilio WhatsApp ----------
// URL: https://<your-site>/webhook/leads/<sourceId>?key=<key>   (key may also be sent as x-api-key header,
// or as google_key in the Google Ads lead form settings)
exports.leadsWebhook = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "content-type, x-api-key");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).send("POST only");
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const id = String(req.path || "").split("/").filter(Boolean).pop() || req.query.source;
  const src = await loadSource(id);
  const given = req.query.key || req.get("x-api-key") || body.google_key || body.key;
  if (!src || !safeEq(given, src.key)) return res.status(401).send("unauthorized");
  if (!src.isActive) return res.status(200).send("source paused");

  const twilio = src.type === "whatsapp" && body.From;
  const lead = src.type === "google" ? P.parseGoogle(body) : twilio ? P.parseTwilio(body) : P.parseGeneric(body);
  if (src.type === "tiktok") lead.channel = "tiktok";
  try {
    const r = await receive(src, [lead], { test: body.is_test === true || body.is_test === "true" || body.test === true });
    if (twilio) return res.status(200).type("text/xml").send("<Response/>");
    // Plain HTML <form> posts can send the visitor to a thank-you page.
    const to = String(body._redirect || "");
    if (/^https:\/\//.test(to)) return res.redirect(303, to);
    return res.status(200).json({ ok: true, ...r });
  } catch {
    return res.status(500).send("error");
  }
});

// ---------- 2. Facebook / Instagram Lead Ads (and WhatsApp Cloud API) via one Meta app webhook ----------
// Meta: App Dashboard > Webhooks. Callback URL https://<your-site>/webhook/meta, verify token = META_VERIFY_TOKEN.
// Subscribe "Page > leadgen" (and "WhatsApp Business Account > messages" if you use the Cloud API).
exports.metaWebhook = onRequest(async (req, res) => {
  if (req.method === "GET") {
    const ok = req.query["hub.mode"] === "subscribe" && env("META_VERIFY_TOKEN") && req.query["hub.verify_token"] === env("META_VERIFY_TOKEN");
    return ok ? res.status(200).send(String(req.query["hub.challenge"] || "")) : res.status(403).send("forbidden");
  }
  if (req.method !== "POST") return res.status(405).send("POST only");
  const secret = env("META_APP_SECRET");
  const sig = String(req.get("x-hub-signature-256") || "");
  const expect = "sha256=" + crypto.createHmac("sha256", secret || "x").update(req.rawBody || Buffer.from("")).digest("hex");
  if (!secret || !safeEq(sig, expect)) return res.status(401).send("bad signature");

  const body = req.body || {};
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      try {
        if (body.object === "page" && ch.field === "leadgen") await metaLead(ch.value || {});
        else if (body.object === "whatsapp_business_account" && ch.field === "messages") await waCloud(ch.value || {});
      } catch (e) {
        console.error("meta webhook item failed", e); // keep going; failures are in leadEvents
      }
    }
  }
  res.status(200).send("ok"); // Meta retries non-200s for hours; per-lead errors are logged instead
});

async function metaLead({ leadgen_id, page_id, form_id }) {
  if (!leadgen_id || !page_id) return;
  const snap = await db.collection("leadSources").where("pageIds", "array-contains", String(page_id)).get();
  const src = snap.docs.map((d) => ({ id: d.id, ...d.data() })).find((s) => s.type === "facebook" && s.isActive);
  if (!src) return console.warn("no active Facebook source for page", page_id);
  if (src.formIds?.length && form_id && !src.formIds.includes(String(form_id))) return; // limited to some forms
  const token = (await db.doc(`leadSourceSecrets/${src.id}`).get()).data()?.pageTokens?.[page_id];
  if (!token) {
    await db.collection("leadEvents").add({ sourceId: src.id, source: "facebook", status: "error", reason: `No access for page ${page_id}. Reconnect Facebook.`, createdAt: FieldValue.serverTimestamp() });
    return;
  }
  const r = await fetch(`${GRAPH()}/${encodeURIComponent(leadgen_id)}?fields=id,created_time,field_data,form_id,ad_id,campaign_id,platform,is_organic&access_token=${encodeURIComponent(token)}`);
  const lead = await r.json();
  if (!r.ok) {
    await db.collection("leadEvents").add({ sourceId: src.id, source: "facebook", status: "error", reason: `Meta: ${lead?.error?.message || r.status}`.slice(0, 300), createdAt: FieldValue.serverTimestamp() });
    return;
  }
  await receive(src, [P.parseMetaLead(lead)]);
}

async function waCloud(value) {
  const pid = String(value?.metadata?.phone_number_id || "");
  const leads = P.parseWhatsAppCloud(value);
  if (!pid || !leads.length) return; // status updates (delivered/read) have no messages
  const snap = await db.collection("leadSources").where("waPhoneNumberId", "==", pid).get();
  const src = snap.docs.map((d) => ({ id: d.id, ...d.data() })).find((s) => s.type === "whatsapp" && s.isActive);
  if (src) await receive(src, leads);
}

// ---------- 3. "Connect Facebook": official Facebook Login, no passwords stored ----------
const redirectUri = () => `${env("PUBLIC_BASE_URL").replace(/\/$/, "")}/oauth/meta`;

exports.startMetaConnect = onCall(async (req) => {
  const u = await requireAdmin(req.auth);
  if (!env("META_APP_ID") || !env("META_APP_SECRET") || !env("PUBLIC_BASE_URL")) {
    throw new HttpsError("failed-precondition", "Facebook is not set up yet: add META_APP_ID, META_APP_SECRET and PUBLIC_BASE_URL to functions/.env.");
  }
  const src = await loadSource(req.data?.id);
  if (!src || src.type !== "facebook") throw new HttpsError("invalid-argument", "Pick a Facebook source.");
  const state = crypto.randomBytes(16).toString("hex");
  await db.doc(`oauthStates/${state}`).set({ uid: u.uid, sourceId: src.id, expiresAt: Date.now() + 10 * 60000 });
  const q = new URLSearchParams({ client_id: env("META_APP_ID"), redirect_uri: redirectUri(), state, scope: META_SCOPES, response_type: "code" });
  return { url: `https://www.facebook.com/${env("META_GRAPH_VERSION") || "v21.0"}/dialog/oauth?${q}` };
});

exports.metaOAuth = onRequest(async (req, res) => {
  const back = (qs) => res.redirect(302, `${env("PUBLIC_BASE_URL").replace(/\/$/, "")}/lead-sources?${qs}`);
  const { code, state, error_description } = req.query;
  if (!state || !/^[a-f0-9]{32}$/.test(String(state))) return res.status(400).send("bad state");
  const stRef = db.doc(`oauthStates/${state}`);
  const st = (await stRef.get()).data();
  await stRef.delete?.();
  if (!st || st.expiresAt < Date.now()) return back("error=" + encodeURIComponent("Sign-in expired, please try again."));
  if (!code) return back("error=" + encodeURIComponent(String(error_description || "Facebook sign-in was cancelled.")));
  try {
    const q = (o) => new URLSearchParams(o).toString();
    const t1 = await (await fetch(`${GRAPH()}/oauth/access_token?${q({ client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), redirect_uri: redirectUri(), code })}`)).json();
    if (!t1.access_token) throw new Error(t1.error?.message || "token exchange failed");
    // Long-lived user token → Page tokens that don't expire.
    const t2 = await (await fetch(`${GRAPH()}/oauth/access_token?${q({ grant_type: "fb_exchange_token", client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), fb_exchange_token: t1.access_token })}`)).json();
    const userToken = t2.access_token || t1.access_token;
    const acc = await (await fetch(`${GRAPH()}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`)).json();
    const pages = (acc.data || []).filter((p) => p.access_token);
    if (!pages.length) throw new Error("No Facebook Pages were shared. Make sure you pick your Pages during sign-in.");
    const subscribed = [];
    for (const p of pages) {
      const r = await fetch(`${GRAPH()}/${p.id}/subscribed_apps`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: q({ subscribed_fields: "leadgen", access_token: p.access_token }) });
      subscribed.push({ id: p.id, name: p.name, subscribed: r.ok });
    }
    await db.doc(`leadSourceSecrets/${st.sourceId}`).set({ pageTokens: Object.fromEntries(pages.map((p) => [p.id, p.access_token])), updatedAt: FieldValue.serverTimestamp() });
    await db.doc(`leadSources/${st.sourceId}`).update({ pages: subscribed, pageIds: subscribed.map((p) => p.id), connectedAt: FieldValue.serverTimestamp(), connectedBy: st.uid });
    await logActivity({ uid: st.uid, role: "admin" }, "leadSource.connect", `Facebook connected: ${subscribed.map((p) => p.name).join(", ")}`, { type: "leadSource", id: st.sourceId });
    return back("connected=facebook");
  } catch (e) {
    console.error("meta oauth", e);
    return back("error=" + encodeURIComponent(String(e.message || e).slice(0, 200)));
  }
});


// Turns each platform's payload into { name, phone, email, externalId, channel, extra }.
// Platforms label their fields differently (and per form), so matching is by common field names.

const key = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const NAME = ["full_name", "fullname", "name", "your_name", "customer_name", "contact_name"];
const FIRST = ["first_name", "firstname", "given_name"];
const LAST = ["last_name", "lastname", "surname", "family_name"];
const PHONE = ["phone_number", "phone", "mobile", "mobile_number", "mobile_phone", "whatsapp", "whatsapp_number", "tel", "telephone", "contact_number", "phonenumber", "cell"];
const EMAIL = ["email", "email_address", "e_mail", "work_email"];
const ID = ["lead_id", "leadgen_id", "leadid", "id"];
const SKIP = new Set(["key", "api_key", "google_key", "_redirect", "redirect", "form_id", "campaign_id", "adgroup_id", "creative_id", "gcl_id", "api_version", "is_test"]);

const str = (v) => (v == null ? "" : String(Array.isArray(v) ? v[0] ?? "" : v).trim());

// Flattens a payload into key -> value. Understands lists of {name|field_name|column_id, value|values|string_value}.
function flatten(obj, out = {}, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return out;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      if (it && typeof it === "object" && !Array.isArray(it)) {
        const k = it.name ?? it.field_name ?? it.column_id ?? it.column_name ?? it.key ?? it.label ?? it.question;
        const v = it.values ?? it.value ?? it.string_value ?? it.answer;
        if (k != null && v != null && typeof v !== "object") { out[key(k)] ??= str(v); continue; }
        if (k != null && Array.isArray(v)) { out[key(k)] ??= str(v); continue; }
      }
      flatten(it, out, depth + 1);
    }
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") flatten(v, out, depth + 1);
    else if (v != null && v !== "") out[key(k)] ??= str(v);
  }
  return out;
}

const first = (flat, keys) => { for (const k of keys) if (flat[k]) return flat[k]; return ""; };

function fromFlat(flat, extraKeysUsed = []) {
  const name = first(flat, NAME) || [first(flat, FIRST), first(flat, LAST)].filter(Boolean).join(" ");
  const used = new Set([...NAME, ...FIRST, ...LAST, ...PHONE, ...EMAIL, ...ID, ...SKIP, ...extraKeysUsed]);
  const extra = {};
  for (const [k, v] of Object.entries(flat)) {
    if (used.has(k) || Object.keys(extra).length >= 20) continue;
    extra[k.slice(0, 60)] = String(v).slice(0, 500);
  }
  return { name, phone: first(flat, PHONE), email: first(flat, EMAIL), externalId: first(flat, ID), extra };
}

// Website forms, Zapier/Make, TikTok and anything else that posts JSON or form fields.
const parseGeneric = (body) => fromFlat(flatten(body || {}));

// Google Ads lead form webhook: { lead_id, google_key, is_test, user_column_data: [{ column_id: "FULL_NAME", string_value }] }
function parseGoogle(body) {
  const flat = flatten(body?.user_column_data || []);
  const lead = fromFlat(flat);
  lead.externalId = str(body?.lead_id);
  if (body?.campaign_id) lead.extra.campaign_id = str(body.campaign_id);
  return lead;
}

// Meta Graph API lead: { id, field_data: [{ name, values: [] }], platform: "fb" | "ig", form_id, ad_id }
function parseMetaLead(lead) {
  const out = fromFlat(flatten(lead?.field_data || []));
  out.externalId = str(lead?.id);
  out.channel = lead?.platform === "ig" ? "instagram" : "facebook";
  for (const k of ["form_id", "ad_id", "campaign_id"]) if (lead?.[k]) out.extra[k] = str(lead[k]);
  return out;
}

// Twilio inbound WhatsApp/SMS: form fields From=whatsapp:+9477..., ProfileName, Body
function parseTwilio(body) {
  return {
    name: str(body?.ProfileName), phone: str(body?.WaId || body?.From).replace(/^whatsapp:/, ""), email: "",
    externalId: str(body?.MessageSid), channel: "whatsapp", extra: body?.Body ? { first_message: str(body.Body).slice(0, 500) } : {},
  };
}

// WhatsApp Cloud API webhook value: { metadata: { phone_number_id }, contacts: [{ wa_id, profile: { name } }], messages: [{ from, text: { body } }] }
function parseWhatsAppCloud(value) {
  const names = Object.fromEntries((value?.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
  return (value?.messages || []).map((m) => ({
    name: names[m.from] || "", phone: str(m.from), email: "", externalId: str(m.id), channel: "whatsapp",
    extra: m.text?.body ? { first_message: str(m.text.body).slice(0, 500) } : {},
  }));
}

module.exports = { flatten, parseGeneric, parseGoogle, parseMetaLead, parseTwilio, parseWhatsAppCloud };

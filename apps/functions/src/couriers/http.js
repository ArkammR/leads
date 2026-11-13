// Small HTTP helpers for courier APIs (Node 20 global fetch). Errors carry the courier's message.
class CourierError extends Error {}

async function request(url, { method = "POST", headers = {}, json, form, timeoutMs = 20000 } = {}) {
  const init = { method, headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (json !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(json); }
  if (form !== undefined) { init.headers["Content-Type"] = "application/x-www-form-urlencoded"; init.body = new URLSearchParams(form).toString(); }
  let res;
  try { res = await fetch(url, init); } catch (e) { throw new CourierError(`Courier unreachable: ${e.message || e}`); }
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new CourierError(`Courier said ${res.status}: ${errText(body)}`);
  return body;
}

// Best-effort human message out of a courier error body.
function errText(b) {
  if (!b || typeof b !== "object") return String(b || "");
  if (typeof b.message === "string") return b.message;
  if (typeof b.error === "string") return b.error;
  if (b.errors) return JSON.stringify(b.errors).slice(0, 300);
  return (b.raw || JSON.stringify(b)).slice(0, 300);
}

// "{waybill}", "{phone}", "{tenant}" placeholders in a tracking link template.
const fillTemplate = (tpl, vals) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vals[k] ?? ""));

// Sri Lankan mobile/landline as 10 digits starting with 0 (what local couriers expect).
function localPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("94") && d.length === 11) d = "0" + d.slice(2);
  if (d.length === 9 && !d.startsWith("0")) d = "0" + d;
  return d;
}

module.exports = { request, errText, fillTemplate, localPhone, CourierError };

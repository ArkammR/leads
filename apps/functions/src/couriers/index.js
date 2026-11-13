// Courier registry. Each adapter: { id, name, api, fields[], book(shipment, cfg), track?(waybill, cfg) }.
// Adding a courier = one file here + one line below.
const { db } = require("../lib/firebase");

const ADAPTERS = [require("./transexpress"), require("./koombiyo"), require("./curfox"), require("./manual")];
const BY_ID = Object.fromEntries(ADAPTERS.map((a) => [a.id, a]));

// Settings live in two docs per courier: courierConfigs/{id} (admins can read) and
// courierSecrets/{id} (no client access; only functions read keys).
async function loadConfig(id) {
  const a = BY_ID[id];
  if (!a) return null;
  const [pub, sec] = await Promise.all([db.doc(`courierConfigs/${id}`).get(), db.doc(`courierSecrets/${id}`).get()]);
  const cfg = {};
  for (const f of a.fields) if (f.default !== undefined) cfg[f.key] = f.default;
  Object.assign(cfg, pub.exists ? pub.data().values || {} : {}, sec.exists ? sec.data() : {});
  return { adapter: a, enabled: pub.exists && pub.data().enabled === true, cfg };
}

// Which required fields are still empty (secrets and fields without a default).
function missing(a, cfg) {
  return a.fields.filter((f) => (f.secret || f.default === undefined) && !String(cfg[f.key] || "").trim()).map((f) => f.label);
}

module.exports = { ADAPTERS, BY_ID, loadConfig, missing };

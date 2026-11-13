// Koombiyo Delivery (koombiyodelivery.lk). Ask Koombiyo for an API key.
// Form-encoded POSTs with `apikey`; waybill numbers are allocated by Koombiyo first (Waybils/users).
// District/city ids: live from the API, falling back to the list bundled from the MIT koombiyo-sdk package.
const { request, fillTemplate, localPhone, CourierError } = require("./http");
const LOC = require("./data/koombiyo-locations.json");

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const DISTRICTS = Object.fromEntries(Object.entries(LOC.districts).map(([k, v]) => [norm(k), v]));
const CITIES = Object.fromEntries(Object.entries(LOC.cities).map(([k, v]) => [norm(k), v]));
// Koombiyo numeric delivery status codes → text our status mapper understands.
const CODES = { 1: "Processing", 2: "Collected", 14: "Received at warehouse", 3: "Dispatch to destination", 4: "Received at destination", 5: "Out for delivery", 6: "Delivered" };

// Pull a list of {id, name} out of whatever shape the Cities endpoint returns.
function pickCities(body) {
  const arr = Array.isArray(body) ? body : Object.values(body || {}).find(Array.isArray) || [];
  return arr.map((c) => ({
    id: c.city_id ?? c.id ?? c.cityId,
    name: c.city_name ?? c.name_en ?? c.name ?? c.cityName,
  })).filter((c) => c.id != null && c.name);
}

module.exports = {
  id: "koombiyo",
  name: "Koombiyo Delivery",
  api: true,
  fields: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "baseUrl", label: "API base URL", default: "https://application.koombiyodelivery.lk/api" },
    { key: "trackingUrl", label: "Customer tracking link", default: "https://koombiyodelivery.lk/Track/track_id?id={waybill}&phone={phone}", help: "{waybill} and {phone} are filled in." },
  ],
  call(cfg, endpoint, form = {}) {
    return request(`${cfg.baseUrl}/${endpoint}`, { form: { ...form, apikey: cfg.apiKey } });
  },
  async cityId(cfg, districtId, city) {
    const want = norm(city);
    try {
      const live = pickCities(await this.call(cfg, "Cities/users", { district_id: districtId }));
      const hit = live.find((c) => norm(c.name) === want);
      if (hit) return hit.id;
    } catch { /* fall back to the bundled list */ }
    return CITIES[want] ?? null;
  },
  async book(s, cfg) {
    const districtId = DISTRICTS[norm(s.district)];
    if (!districtId) throw new CourierError(`Koombiyo needs a district (got "${s.district || ""}").`);
    const cityId = await this.cityId(cfg, districtId, s.city);
    if (!cityId) throw new CourierError(`Koombiyo doesn't know the city "${s.city || ""}". Fix the city name on the order.`);
    const wb = await this.call(cfg, "Waybils/users", { limit: 1 });
    const waybill = wb.waybills && wb.waybills[0] && wb.waybills[0].waybill_id;
    if (!waybill) throw new CourierError(`Koombiyo gave no waybill number: ${JSON.stringify(wb).slice(0, 200)}`);
    const r = await this.call(cfg, "Addorders/users", {
      orderWaybillid: waybill, orderNo: s.orderNo, receiverName: s.name, receiverStreet: s.address,
      receiverDistrict: districtId, receiverCity: cityId, receiverPhone: localPhone(s.phone),
      description: s.description.slice(0, 250), spclNote: s.note || "-", getCod: s.cod,
    });
    if (r.status && r.status !== "success") throw new CourierError(`Koombiyo: ${r.message || JSON.stringify(r).slice(0, 200)}`);
    return { waybill: String(waybill), trackingUrl: fillTemplate(cfg.trackingUrl, { waybill, phone: localPhone(s.phone) }) };
  },
  async track(waybill, cfg) {
    const r = await this.call(cfg, "Allorders/users", { waybillid: waybill, offset: 0, limit: 1 });
    const o = (r.cust_orders && r.cust_orders[0]) || {};
    const text = o.status_name || o.delivery_status_name || o.order_status || (typeof o.status === "string" && isNaN(o.status) ? o.status : "");
    const code = o.delivery_status ?? o.status_id ?? o.status;
    return { courierStatus: text || CODES[Number(code)] || "" };
  },
};

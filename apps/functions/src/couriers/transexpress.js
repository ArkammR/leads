// Trans Express (transexpress.lk). API key: Client Portal → My Profile → Update Account → API Key.
// Staging: https://dev-transexpress.parallaxtec.com/api · Production: https://portal.transexpress.lk/api
const { request, fillTemplate, localPhone, CourierError } = require("./http");

module.exports = {
  id: "transexpress",
  name: "Trans Express",
  api: true,
  fields: [
    { key: "apiKey", label: "API key (Bearer token)", secret: true },
    { key: "baseUrl", label: "API base URL", default: "https://portal.transexpress.lk/api", help: "Use https://dev-transexpress.parallaxtec.com/api to test on their staging server." },
    { key: "trackingUrl", label: "Customer tracking link", default: "https://tracking.transexpress.lk/tracking", help: "{waybill} and {phone} are filled in." },
  ],
  async book(s, cfg) {
    const body = {
      order_no: s.orderNo, customer_name: s.name, address: s.address, description: s.description.slice(0, 500),
      phone_no: localPhone(s.phone), cod: s.cod, city: s.city, note: s.note || "",
    };
    if (s.phone2) body.phone_no2 = localPhone(s.phone2);
    const r = await request(`${cfg.baseUrl}/orders/upload/single-auto-without-city`, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, json: body });
    const waybill = r.order && r.order.waybill_id;
    if (!waybill) throw new CourierError(`Trans Express didn't return a waybill: ${JSON.stringify(r).slice(0, 300)}`);
    return { waybill: String(waybill), trackingUrl: fillTemplate(cfg.trackingUrl, { waybill, phone: localPhone(s.phone) }) };
  },
  async track(waybill, cfg) {
    const r = await request(`${cfg.baseUrl}/tracking`, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, json: { waybill_id: waybill } });
    const d = r.data || {};
    return { courierStatus: d.current_status || (d.status_history && d.status_history[0] && d.status_history[0].name) || "" };
  },
};

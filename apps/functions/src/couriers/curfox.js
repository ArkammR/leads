// Couriers running on the Curfox platform (e.g. Royal Express). One API, chosen by the tenant name.
// Ask the courier for a merchant API token, your tenant name and merchant business id.
const { request, fillTemplate, localPhone, CourierError } = require("./http");

module.exports = {
  id: "curfox",
  name: "Curfox courier (Royal Express etc.)",
  api: true,
  fields: [
    { key: "displayName", label: "Courier name on waybills", default: "Royal Express" },
    { key: "token", label: "API token (Bearer)", secret: true },
    { key: "tenant", label: "Tenant (X-tenant header)", default: "royalexpress" },
    { key: "businessId", label: "Merchant business id" },
    { key: "originCity", label: "Pickup city name (as in the courier's list)" },
    { key: "originState", label: "Pickup state / district name" },
    { key: "baseUrl", label: "API base URL", default: "https://v1.api.curfox.com" },
    { key: "trackingUrl", label: "Customer tracking link", default: "https://{tenant}.tracking.curfox.com", help: "{waybill}, {phone} and {tenant} are filled in." },
  ],
  headers: (cfg) => ({ Authorization: `Bearer ${cfg.token}`, "X-tenant": cfg.tenant }),
  async book(s, cfg) {
    const r = await request(`${cfg.baseUrl}/api/public/merchant/order/single`, {
      headers: this.headers(cfg),
      json: {
        general_data: { merchant_business_id: cfg.businessId, origin_city_name: cfg.originCity, origin_state_name: cfg.originState },
        order_data: [{
          order_no: s.orderNo, customer_name: s.name, customer_address: s.address, customer_phone: localPhone(s.phone),
          customer_secondary_phone: s.phone2 ? localPhone(s.phone2) : undefined,
          destination_city_name: s.city, destination_state_name: s.district, cod: s.cod, weight: s.weight || 1,
          description: s.description.slice(0, 250), remark: s.note || undefined,
        }],
      },
    });
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    const waybill = row && (row.waybill_number || row.waybill);
    if (!waybill) throw new CourierError(`Courier didn't return a waybill: ${JSON.stringify(r).slice(0, 300)}`);
    return { waybill: String(waybill), trackingUrl: fillTemplate(cfg.trackingUrl, { waybill, phone: localPhone(s.phone), tenant: cfg.tenant }) };
  },
  async track(waybill, cfg) {
    const r = await request(`${cfg.baseUrl}/api/public/order/tracking-info`, { headers: this.headers(cfg), json: { waybill_number: waybill } });
    const t = (r.data && r.data.timeline) || [];
    return { courierStatus: (t[0] && t[0].status && t[0].status.name) || "" };
  },
};

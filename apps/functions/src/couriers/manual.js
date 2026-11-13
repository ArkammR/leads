// Any courier without an API (Domex, Fardar, Prompt Xpress, Pronto, ...): pick the courier name,
// type their waybill number if you have one, print the label, and update the status by hand or webhook.
const { fillTemplate, localPhone } = require("./http");

module.exports = {
  id: "manual",
  name: "Other courier (no API)",
  api: false,
  fields: [
    { key: "couriers", label: "Courier names (comma separated)", default: "Domex, Fardar Express, Prompt Xpress, Pronto, Certis Lanka" },
    { key: "trackingUrl", label: "Customer tracking link (optional)", default: "", help: "{waybill} and {phone} are filled in." },
  ],
  async book(s, cfg) {
    const waybill = s.waybill ? String(s.waybill).trim() : null;
    return { waybill, courierName: s.courierName || null, trackingUrl: waybill && cfg.trackingUrl ? fillTemplate(cfg.trackingUrl, { waybill, phone: localPhone(s.phone) }) : null };
  },
};

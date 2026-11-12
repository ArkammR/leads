const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../lib/firebase");
const { env } = require("../lib/util");
const { applyOrderStatus } = require("../lib/orderStatus");

const STATUS_MAP = {
  dispatched: "Dispatched", shipped: "Dispatched",
  out_for_delivery: "OutForDelivery", delivered: "Delivered",
  failed: "Failed", returned: "Returned",
};

// Push updates from a delivery partner. Body: { orderId | waybill, status, trackingUrl? }
exports.threePLWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  if (!env("WEBHOOK_SECRET") || req.get("x-webhook-secret") !== env("WEBHOOK_SECRET")) return res.status(401).send("unauthorized");
  const { status, trackingUrl, waybill } = req.body || {};
  let { orderId } = req.body || {};
  const newStatus = STATUS_MAP[String(status || "").toLowerCase().replace(/[\s-]/g, "_")];
  if (!orderId && waybill) {
    const found = await db.collection("orders").where("shipment.waybill", "==", String(waybill)).get();
    if (found.docs.length !== 1) return res.status(404).send("waybill not found");
    orderId = found.docs[0].id;
  }
  if (!orderId || !newStatus) return res.status(400).send("orderId (or waybill) and valid status required");

  try {
    const { changed } = await applyOrderStatus(orderId, newStatus, { by: "3pl-webhook", trackingUrl });
    res.status(200).send(changed ? "ok" : "no-op");
  } catch (e) {
    if (e instanceof HttpsError) return res.status(e.code === "not-found" ? 404 : 409).send(e.message);
    console.error(e); return res.status(500).send("error");
  }
});

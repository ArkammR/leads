const { db, FieldValue } = require("../lib/firebase");
const { env, normPhone } = require("../lib/util");

async function notify(orderId, phone, body) {
  const log = { orderId, phone, body, createdAt: FieldValue.serverTimestamp() };
  try {
    const sid = env("TWILIO_SID"), token = env("TWILIO_TOKEN"), from = env("TWILIO_FROM");
    const isWa = from.startsWith("whatsapp:");
    const to = (isWa ? "whatsapp:" : "") + "+" + normPhone(phone);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    log.ok = res.ok;
    if (!res.ok) log.error = (await res.text()).slice(0, 500);
  } catch (e) {
    log.ok = false; log.error = String(e.message || e);
  }
  await db.collection("notifications").add(log); // never throws to caller's flow
}

module.exports = { notify };

// Map a courier's free-text status to an order status (or null = no change).
// Kept deliberately conservative: a failed delivery *attempt* doesn't change the order, because
// couriers usually re-attempt; only a return to the merchant restocks.
function mapCourierStatus(text) {
  const s = String(text || "").toLowerCase().trim();
  if (!s) return null;
  if (/\breturn|\brto\b|send back|sent back/.test(s)) return "Returned";
  if (/fail|undeliver|not delivered|reject|cancel|resched|attempt/.test(s)) return null;
  if (/out for delivery|on delivery|with (the )?rider|rider assigned|delivery in progress/.test(s)) return "OutForDelivery";
  if (/\bdelivered\b|delivery (completed|success)/.test(s)) return "Delivered";
  if (/pick(ed)? ?up|collected|received at|warehouse|dispatch|transit|sorting|\bhub\b|branch|on the way|shipped/.test(s)) return "Dispatched";
  return null;
}

module.exports = { mapCourierStatus };

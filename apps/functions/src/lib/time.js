// Local calendar day (YYYY-MM-DD) for a timestamp, given the browser's getTimezoneOffset() in minutes.
function localDay(ms, tzOffsetMin) {
  const off = Number.isFinite(Number(tzOffsetMin)) ? Math.max(-840, Math.min(840, Number(tzOffsetMin))) : 0;
  return new Date(ms - off * 60000).toISOString().slice(0, 10);
}
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ""));

module.exports = { localDay, isMonth };

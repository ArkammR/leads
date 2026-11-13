// Secrets come from functions/.env (loaded automatically by Firebase; gitignored)
const env = (k) => process.env[k] || "";

// Phones are stored as international digits without "+" (e.g. 94771234567), so the same customer
// coming from a CSV ("077 123 4567") and from Facebook ("+94 77 123 4567") is caught as a duplicate.
// DEFAULT_COUNTRY_CODE (default 94, Sri Lanka) fills in numbers typed in local format.
const countryCode = () => (env("DEFAULT_COUNTRY_CODE") || "94").replace(/\D/g, "");
const normPhone = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  const cc = countryCode();
  if (cc && d.length === 10 && d.startsWith("0")) d = cc + d.slice(1); // 0771234567
  else if (cc === "94" && d.length === 9 && d.startsWith("7")) d = cc + d; // 771234567 (leading 0 dropped by Excel)
  return d;
};
// Older leads were saved as typed (local format). Dedupe checks both forms.
const phoneVariants = (canon) => {
  const cc = countryCode(), out = [canon];
  if (cc && canon.startsWith(cc) && canon.length === cc.length + 9) out.push("0" + canon.slice(cc.length));
  return out;
};
const normEmail = (e) => String(e || "").trim().toLowerCase();
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

module.exports = { env, normPhone, phoneVariants, normEmail, chunks };

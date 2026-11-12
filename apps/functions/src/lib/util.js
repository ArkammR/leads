// Secrets come from functions/.env (loaded automatically by Firebase; gitignored)
const env = (k) => process.env[k] || "";
const normPhone = (p) => String(p || "").replace(/\D/g, "");
const normEmail = (e) => String(e || "").trim().toLowerCase();
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

module.exports = { env, normPhone, normEmail, chunks };

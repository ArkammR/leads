// CSV export. columns: [[header, row => value], ...]. Excel-friendly (BOM, CRLF, quoted).
const cell = (v) => {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheets running text as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows, columns) {
  const head = columns.map(([h]) => cell(h)).join(",");
  return [head, ...rows.map((r) => columns.map(([, f]) => cell(f(r))).join(","))].join("\r\n");
}
export function downloadCsv(name, rows, columns) {
  const blob = new Blob(["﻿" + toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

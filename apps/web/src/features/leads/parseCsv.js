// Minimal RFC-4180-ish CSV parser (handles quoted fields with commas/newlines).
// Accepts a header row containing "phone"; otherwise assumes columns: name, phone, email.
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);

  const head = rows[0]?.map((h) => h.toLowerCase()) || [];
  const hasHead = head.includes("phone");
  const ix = (k, d) => (hasHead ? head.indexOf(k) : d);
  return rows.slice(hasHead ? 1 : 0).map((r) => ({
    name: r[ix("name", 0)] || "",
    phone: r[ix("phone", 1)] || "",
    email: r[ix("email", 2)] || "",
  }));
}

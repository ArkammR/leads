// Manual upload: CSV or Excel (.xlsx) with a header row, or plain columns name, phone, email.
// Headers are matched loosely ("Full Name", "Mobile", "E-mail", ...), so most exports work as they are.

// Minimal RFC-4180-ish CSV parser (handles quoted fields with commas/newlines).
export function csvRows(text) {
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
  return rows;
}

const norm = (h) => String(h || "").toLowerCase().replace(/[^a-z]/g, "");
const COLS = {
  name: ["name", "fullname", "customername", "customer", "contactname", "yourname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "contactnumber", "telephone", "tel", "whatsapp", "number", "contact"],
  email: ["email", "emailaddress"],
};

export function rowsToLeads(rows) {
  const head = (rows[0] || []).map(norm);
  const find = (k) => head.findIndex((h) => COLS[k].includes(h));
  const hasHead = find("phone") >= 0;
  const ix = { name: hasHead ? find("name") : 0, phone: hasHead ? find("phone") : 1, email: hasHead ? find("email") : 2 };
  const first = hasHead ? head.indexOf("firstname") : -1, last = hasHead ? head.indexOf("lastname") : -1;
  const at = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  return rows.slice(hasHead ? 1 : 0)
    .map((r) => ({
      name: at(r, ix.name) || [at(r, first), at(r, last)].filter(Boolean).join(" "),
      phone: at(r, ix.phone),
      email: at(r, ix.email),
    }))
    .filter((l) => l.name || l.phone || l.email);
}

export const parseCsv = (text) => rowsToLeads(csvRows(text));

// ---- .xlsx: a zip of XML files. Read the first worksheet with the browser's own unzip. ----
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), files = {};
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a valid .xlsx file");
  let p = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true), dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml|workbook\.xml|_rels\/workbook\.xml\.rels)$/.test(name)) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = u8.subarray(start, start + size);
    files[name] = method === 0 ? dec.decode(data)
      : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  }
  return files;
}

const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export async function parseXlsx(buf) {
  const files = await unzip(buf);
  const xml = (s) => new DOMParser().parseFromString(s || "<x/>", "application/xml");
  const strings = [...xml(files["xl/sharedStrings.xml"]).getElementsByTagName("si")]
    .map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
  // First sheet in workbook order
  let sheet = Object.keys(files).filter((f) => f.includes("worksheets/")).sort()[0];
  const firstRid = xml(files["xl/workbook.xml"]).getElementsByTagName("sheet")[0]?.getAttribute("r:id");
  const rel = [...xml(files["xl/_rels/workbook.xml.rels"]).getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === firstRid);
  if (rel && files["xl/" + rel.getAttribute("Target").replace(/^\/?xl\//, "")]) sheet = "xl/" + rel.getAttribute("Target").replace(/^\/?xl\//, "");
  if (!sheet) throw new Error("No worksheet found");
  const rows = [];
  for (const r of xml(files[sheet]).getElementsByTagName("row")) {
    const row = [];
    for (const c of r.getElementsByTagName("c")) {
      const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let val = t === "s" ? strings[+v] ?? "" : t === "inlineStr" ? [...c.getElementsByTagName("t")].map((x) => x.textContent).join("") : v;
      if (!t && /^\d+(\.0+)?$/.test(val)) val = String(BigInt(val.split(".")[0])); // phone numbers saved as numbers
      row[colIndex(c.getAttribute("r") || "A")] = val;
    }
    if (row.some(Boolean)) rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rowsToLeads(rows);
}

export async function parseLeadFile(file) {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer());
  if (/\.xls$/i.test(file.name)) throw new Error("Old .xls files aren't supported. In Excel choose Save As > .xlsx or .csv.");
  return parseCsv(await file.text());
}

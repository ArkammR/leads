import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { barcodeSvg } from "../../lib/code128";

export const PRINT_FORMATS = { a4: "A4 paper, 4 per page", label: "Label printer, 4 × 6 in" };

const amount = (n, cur) => `${cur || "LKR"} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const codDue = (o) => ((o.payment?.method || "COD") === "COD" && !["collected", "remitted"].includes(o.payment?.status) ? o.total || 0 : 0);

function Label({ o, settings }) {
  const sh = o.shipment || {};
  const code = sh.waybill || o.id.slice(0, 10).toUpperCase();
  const c = o.customer || {};
  const s = settings?.sender || {};
  const cod = codDue(o);
  return (
    <div className="waybill">
      <div className="wb-top">
        <div><b>{sh.courierName || "Courier"}</b><div className="wb-small">Order #{o.id.slice(0, 6)} · {new Date().toLocaleDateString()}</div></div>
        <div className="wb-cod">{cod ? <>COD<br /><b>{amount(cod, settings?.currency)}</b></> : <b>PAID</b>}</div>
      </div>
      <div className="wb-bar" dangerouslySetInnerHTML={{ __html: barcodeSvg(code, { width: 300, height: 56 }) }} />
      <div className="wb-code">{sh.waybill ? code : `Ref ${code} (no courier waybill yet)`}</div>
      <div className="wb-to">
        <div className="wb-small">DELIVER TO</div>
        <div className="wb-name">{c.name}</div>
        <div>{c.address}</div>
        <div><b>{[c.city, c.district].filter(Boolean).join(", ")}</b></div>
        <div>Tel: {c.phone}{c.phone2 ? ` / ${c.phone2}` : ""}</div>
      </div>
      <div className="wb-items"><span className="wb-small">CONTENTS</span> {(o.items || []).map((i) => `${i.name} × ${i.qty}`).join(", ")}</div>
      {(o.shipNote || s.note) && <div className="wb-items"><span className="wb-small">NOTE</span> {[o.shipNote, s.note].filter(Boolean).join(" · ")}</div>}
      <div className="wb-from">
        <span className="wb-small">FROM</span> <b>{s.name || "—"}</b>{s.phone ? ` · ${s.phone}` : ""}{s.address ? <div>{s.address}</div> : null}
      </div>
    </div>
  );
}

// Full-screen preview of the waybills; the toolbar is hidden when printing.
// onPrinted runs after the print dialog closes (used to mark them printed).
export default function WaybillSheet({ orders, settings, format, setFormat, onClose, onPrinted }) {
  const print = () => {
    const after = () => { window.removeEventListener("afterprint", after); onPrinted?.(); };
    window.addEventListener("afterprint", after);
    window.print();
  };
  const page = format === "label" ? "@page{size:4in 6in;margin:0}" : "@page{size:A4;margin:8mm}";
  return createPortal(
    <div className={"printarea fmt-" + format}>
      <style>{page}</style>
      <div className="print-bar">
        <b className="grow">{orders.length} waybill{orders.length === 1 ? "" : "s"}</b>
        <select className="select" style={{ width: "auto" }} value={format} onChange={(e) => setFormat(e.target.value)}>
          {Object.entries(PRINT_FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn primary" onClick={print}><Printer size={15} />Print</button>
        <button className="btn" onClick={onClose} aria-label="Close"><X size={15} />Close</button>
      </div>
      <div className="sheet">{orders.map((o) => <Label key={o.id} o={o} settings={settings} />)}</div>
    </div>,
    document.body
  );
}

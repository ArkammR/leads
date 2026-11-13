import { useState } from "react";
import { collection, doc } from "firebase/firestore";
import { Ban, CheckCircle2, History, MapPin, Printer, RefreshCw, Truck, Unlink } from "lucide-react";
import { api, db } from "../../lib/firebase";
import { useLive, useLiveDoc } from "../../hooks/useLive";
import { Badge, Empty, ExportButton, Field, Modal, PageHead, useAction, useToast } from "../../components/ui";
import HistoryModal from "../../components/HistoryModal";
import { fmtDate, money, payStatus, ts } from "../../lib/constants";
import { DISTRICTS } from "../../lib/districts";
import WaybillSheet from "./WaybillSheet";

const OPEN_SHIPPED = ["Verified", "Dispatched", "OutForDelivery"];
const MANUAL_STATUSES = ["Dispatched", "OutForDelivery", "Delivered", "Failed", "Returned"];

function ShipmentCell({ o }) {
  const sh = o.shipment;
  if (!sh) return <span className="muted">{o.status === "Verified" ? "Not booked" : "—"}</span>;
  if (sh.state === "error") return <div className="ship"><b>{sh.courierName}</b><div className="err">Booking failed: {sh.error}</div></div>;
  if (sh.state === "booking") return <span className="muted">Booking…</span>;
  return (
    <div className="ship">
      <b>{sh.courierName}</b>{" "}
      {sh.waybill ? (o.trackingUrl ? <a href={o.trackingUrl} target="_blank" rel="noreferrer">{sh.waybill}</a> : sh.waybill) : <span className="muted">no waybill</span>}
      {sh.courierStatus && <div className="muted">Courier: {sh.courierStatus}</div>}
      {sh.syncError && <div className="err">Tracking: {sh.syncError}</div>}
      {!sh.printedAt && <div className="muted">Waybill not printed</div>}
    </div>
  );
}

export default function Orders() {
  const run = useAction();
  const toast = useToast();
  const { data, loading } = useLive(() => collection(db, "orders"), []);
  const users = useLive(() => collection(db, "users"), []).data;
  const shipSettings = useLiveDoc(() => doc(db, "settings", "shipping"), []);
  const [hist, setHist] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [cancel, setCancel] = useState(null); // {order, reason}
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState(() => new Set());
  const [book, setBook] = useState(null); // {orders, couriers, courierId, courierName, waybills}
  const [shipTo, setShipTo] = useState(null); // {order, address, district, city, phone2, note, weight}
  const [print, setPrint] = useState(null); // orders to print
  const [format, setFormat] = useState(() => { try { return localStorage.getItem("waybillFormat") || "a4"; } catch { return "a4"; } });

  const doCancel = async () => {
    setBusyId(cancel.order.id);
    const ok = await run(() => api.cancelOrder({ orderId: cancel.order.id, reason: cancel.reason }), "Order cancelled, stock returned");
    setBusyId(null);
    if (ok) setCancel(null);
  };
  const statuses = [...new Set(data.map((o) => o.status))];
  const rows = [...data].filter((o) => !status || o.status === status).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const selected = rows.filter((o) => sel.has(o.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every((o) => sel.has(o.id));

  const verify = async (o) => {
    setBusyId(o.id);
    let res;
    const ok = await run(async () => { res = await api.verifyOrder({ orderId: o.id }); }, "Order verified — stock deducted, customer notified");
    if (ok && res?.lowStock) toast(`${res.lowStock} product(s) now below minimum stock`, "err");
    if (ok && res?.booking) toast(res.booking.ok ? `Booked with ${res.booking.courierName}: ${res.booking.waybill}` : `Courier booking failed: ${res.booking.error}`, res.booking.ok ? "ok" : "err");
    setBusyId(null);
  };

  const openBook = async (orders) => {
    const bookable = orders.filter((o) => o.status === "Verified" && o.shipment?.state !== "booked");
    if (!bookable.length) return toast("Pick Verified orders that aren't booked yet", "err");
    await run(async () => {
      const r = await api.listCouriers({});
      const couriers = r.couriers.filter((c) => c.enabled);
      if (!couriers.length) throw new Error("Switch on a courier on the Couriers page first.");
      const def = couriers.find((c) => c.id === r.settings.defaultCourier) || couriers[0];
      const manual = couriers.find((c) => c.id === "manual");
      const names = (manual?.fields.find((f) => f.key === "couriers")?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
      setBook({ orders: bookable, couriers, courierId: def.id, courierName: names[0] || "", names, waybills: {} });
    });
  };
  const doBook = async () => {
    setBusyId("book");
    let res;
    const ok = await run(async () => {
      res = await api.bookShipments({ orderIds: book.orders.map((o) => o.id), courierId: book.courierId, courierName: book.courierName, waybills: book.waybills });
    });
    setBusyId(null);
    if (!ok) return;
    const failed = res.results.filter((r) => !r.ok);
    toast(`${res.booked} booked${failed.length ? `, ${failed.length} failed: ${failed[0].error}` : ""}`, failed.length ? "err" : "ok");
    setBook(null); setSel(new Set());
  };

  const saveShipTo = async () => {
    setBusyId("shipTo");
    const { order, ...vals } = shipTo;
    const ok = await run(() => api.updateShipTo({ orderId: order.id, ...vals }), "Delivery details saved");
    setBusyId(null);
    if (ok) setShipTo(null);
  };
  const sync = async (ids) => {
    setBusyId("sync");
    let r;
    const ok = await run(async () => { r = await api.syncShipments(ids ? { orderIds: ids } : {}); });
    setBusyId(null);
    if (ok) toast(`Checked ${r.checked} shipment(s), ${r.moved} status change(s)`);
  };
  const setShipStatus = (o, s) => run(() => api.setShipmentStatus({ orderId: o.id, status: s }), `#${o.id.slice(0, 6)} marked ${s}`);
  const clearShip = (o) => run(() => api.clearShipment({ orderId: o.id }), "Waybill removed from the order");
  const openPrint = (orders) => {
    const printable = orders.filter((o) => o.status !== "Pending" && o.status !== "Cancelled");
    if (!printable.length) return toast("Pick verified orders to print", "err");
    setPrint(printable);
  };
  const changeFormat = (f) => { setFormat(f); try { localStorage.setItem("waybillFormat", f); } catch { /* private mode */ } };
  const printed = () => { const ids = print.filter((o) => o.shipment).map((o) => o.id); if (ids.length) api.markWaybillsPrinted({ orderIds: ids }).catch(() => {}); };

  const bookCourier = book && book.couriers.find((c) => c.id === book.courierId);

  return (
    <>
      <PageHead title="Orders" sub="Verify orders, book them with a courier and print waybills. Courier tracking updates the status.">
        <select className="select" style={{ width: "auto" }} value={status} onChange={(e) => { setStatus(e.target.value); setSel(new Set()); }}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn" disabled={busyId === "sync"} onClick={() => sync(null)} title="Ask couriers for the latest status"><RefreshCw size={15} />Sync tracking</button>
        <ExportButton name="orders" rows={rows} columns={[
          ["Order", (o) => o.id], ["Created", (o) => ts(o.createdAt)], ["Status", (o) => o.status], ["Agent", (o) => users.find((u) => u.id === o.agentId)?.name || ""],
          ["Customer", (o) => o.customer.name], ["Phone", (o) => o.customer.phone], ["Address", (o) => o.customer.address],
          ["City", (o) => o.customer.city || ""], ["District", (o) => o.customer.district || ""],
          ["Items", (o) => o.items.map((i) => `${i.name} x ${i.qty}`).join("; ")], ["Total", (o) => o.total], ["Cost", (o) => o.costTotal ?? ""],
          ["Payment", (o) => payStatus(o)], ["Courier", (o) => o.shipment?.courierName || ""], ["Waybill", (o) => o.shipment?.waybill || ""],
          ["Delivered", (o) => ts(o.deliveredAt)], ["Commission", (o) => o.commission ?? ""],
        ]} />
      </PageHead>
      {selected.length > 0 && (
        <div className="card pad row" style={{ marginBottom: 12 }}>
          <b className="grow">{selected.length} selected</b>
          <button className="btn primary" onClick={() => openBook(selected)}><Truck size={15} />Book with courier</button>
          <button className="btn" onClick={() => openPrint(selected)}><Printer size={15} />Print waybills</button>
          <button className="btn" disabled={busyId === "sync"} onClick={() => sync(selected.map((o) => o.id))}><RefreshCw size={15} />Sync</button>
          <button className="btn" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className="card tablewrap">
        {!loading && rows.length === 0 ? <Empty>No orders yet.</Empty> : (
          <table>
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((o) => o.id)))} /></th>
              <th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Courier</th><th>Created</th><th />
            </tr></thead>
            <tbody>
              {rows.map((o) => {
                const booked = o.shipment?.state === "booked";
                return (
                  <tr key={o.id}>
                    <td><input type="checkbox" aria-label={`Select #${o.id.slice(0, 6)}`} checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></td>
                    <td>#{o.id.slice(0, 6)}</td>
                    <td><b>{o.customer.name}</b><div className="muted">{o.customer.phone}</div>
                      <div className="muted">{[o.customer.city, o.customer.district].filter(Boolean).join(", ") || "No city"}</div></td>
                    <td>{o.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}</td>
                    <td>{money(o.total)}</td>
                    <td><Badge>{o.status}</Badge></td>
                    <td><ShipmentCell o={o} /></td>
                    <td>{fmtDate(o.createdAt)}</td>
                    <td className="actions">
                      {o.status === "Pending" && (
                        <button className="btn sm primary" disabled={busyId === o.id} onClick={() => verify(o)}><CheckCircle2 size={14} />Verify</button>
                      )}{" "}
                      {["Pending", "Verified"].includes(o.status) && !booked && (
                        <><button className="btn sm" title="Edit delivery details" onClick={() => setShipTo({ order: o, address: o.customer.address || "", district: o.customer.district || "", city: o.customer.city || "", phone2: o.customer.phone2 || "", note: o.shipNote || "", weight: o.weight || 1 })}><MapPin size={14} />Address</button>{" "}</>
                      )}
                      {o.status === "Verified" && !booked && (
                        <><button className="btn sm primary" onClick={() => openBook([o])}><Truck size={14} />{o.shipment?.state === "error" ? "Retry" : "Book"}</button>{" "}</>
                      )}
                      {o.status !== "Pending" && o.status !== "Cancelled" && (
                        <><button className="btn sm" onClick={() => openPrint([o])}><Printer size={14} />Waybill</button>{" "}</>
                      )}
                      {o.status === "Verified" && booked && (
                        <><button className="btn sm" title="Remove the waybill (cancel it with the courier yourself)" onClick={() => clearShip(o)}><Unlink size={14} />Unbook</button>{" "}</>
                      )}
                      {OPEN_SHIPPED.includes(o.status) && booked && (
                        <><select className="select sm" style={{ width: "auto" }} value="" aria-label="Set status" onChange={(e) => e.target.value && setShipStatus(o, e.target.value)}>
                          <option value="">Set status…</option>
                          {MANUAL_STATUSES.filter((s) => s !== o.status).map((s) => <option key={s}>{s}</option>)}
                        </select>{" "}</>
                      )}
                      {["Pending", "Verified"].includes(o.status) && (
                        <><button className="btn sm" disabled={busyId === o.id} onClick={() => setCancel({ order: o, reason: "" })}><Ban size={14} />Cancel</button>{" "}</>
                      )}
                      <button className="btn sm" onClick={() => setHist(o)}><History size={14} />History</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {cancel && (
        <Modal title={`Cancel order #${cancel.order.id.slice(0, 6)}`} onClose={() => setCancel(null)}
          footer={<><button className="btn" onClick={() => setCancel(null)}>Keep order</button>
            <button className="btn primary" disabled={busyId === cancel.order.id} onClick={doCancel}>Cancel order</button></>}>
          <p className="muted">{cancel.order.status === "Verified" ? "Deducted stock goes back on hand." : "Reserved stock is released."} The lead goes back to the agent's queue as Interested.</p>
          <Field label="Reason"><input className="input" value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} placeholder="Customer changed their mind, duplicate, fake order…" /></Field>
        </Modal>
      )}
      {book && (
        <Modal title={`Book ${book.orders.length} order${book.orders.length === 1 ? "" : "s"} with a courier`} onClose={() => setBook(null)}
          footer={<><button className="btn" onClick={() => setBook(null)}>Cancel</button>
            <button className="btn primary" disabled={busyId === "book" || (!bookCourier?.api && !book.courierName)} onClick={doBook}><Truck size={15} />Book</button></>}>
          <Field label="Courier">
            <select className="select" value={book.courierId} onChange={(e) => setBook({ ...book, courierId: e.target.value })}>
              {book.couriers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.api && c.missing.length ? " (settings incomplete)" : ""}</option>)}
            </select>
          </Field>
          {bookCourier?.api ? (
            <p className="muted">Each order is sent to {bookCourier.name}, which returns a waybill number. Orders the courier rejects (for example an unknown city) stay unbooked with the reason shown.</p>
          ) : (
            <>
              <Field label="Which courier">
                <input className="input" list="courier-names" value={book.courierName} onChange={(e) => setBook({ ...book, courierName: e.target.value })} />
                <datalist id="courier-names">{book.names.map((n) => <option key={n} value={n} />)}</datalist>
              </Field>
              <p className="muted">Type the courier's waybill number for each order if you have one. Leave it blank to print a label with our order reference.</p>
              {book.orders.map((o) => (
                <Field key={o.id} label={`#${o.id.slice(0, 6)} · ${o.customer.name}`}>
                  <input className="input" value={book.waybills[o.id] || ""} placeholder="Waybill number"
                    onChange={(e) => setBook({ ...book, waybills: { ...book.waybills, [o.id]: e.target.value } })} />
                </Field>
              ))}
            </>
          )}
        </Modal>
      )}
      {shipTo && (
        <Modal title={`Delivery details · #${shipTo.order.id.slice(0, 6)}`} onClose={() => setShipTo(null)}
          footer={<><button className="btn" onClick={() => setShipTo(null)}>Cancel</button>
            <button className="btn primary" disabled={busyId === "shipTo"} onClick={saveShipTo}>Save</button></>}>
          <Field label="Address"><textarea className="input" rows="3" value={shipTo.address} onChange={(e) => setShipTo({ ...shipTo, address: e.target.value })} /></Field>
          <div className="row2">
            <Field label="District">
              <select className="select" value={shipTo.district} onChange={(e) => setShipTo({ ...shipTo, district: e.target.value })}>
                <option value="">Choose…</option>
                {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="City / town"><input className="input" value={shipTo.city} onChange={(e) => setShipTo({ ...shipTo, city: e.target.value })} /></Field>
          </div>
          <div className="row2">
            <Field label="Second phone"><input className="input" value={shipTo.phone2} onChange={(e) => setShipTo({ ...shipTo, phone2: e.target.value })} /></Field>
            <Field label="Weight (kg)"><input className="input" type="number" min="0.1" step="0.1" value={shipTo.weight} onChange={(e) => setShipTo({ ...shipTo, weight: e.target.value })} /></Field>
          </div>
          <Field label="Note for the courier"><input className="input" value={shipTo.note} onChange={(e) => setShipTo({ ...shipTo, note: e.target.value })} placeholder="Call before delivery" /></Field>
        </Modal>
      )}
      {print && <WaybillSheet orders={print} settings={shipSettings} format={format} setFormat={changeFormat} onClose={() => setPrint(null)} onPrinted={printed} />}
      {hist && <HistoryModal coll="orders" id={hist.id} title={`#${hist.id.slice(0, 6)}`} users={users} onClose={() => setHist(null)} />}
    </>
  );
}

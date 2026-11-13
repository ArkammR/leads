import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Save } from "lucide-react";
import { api } from "../../lib/firebase";
import { Badge, Field, PageHead, useAction } from "../../components/ui";

// Admin: courier API keys, default courier, auto-booking and the sender details printed on waybills.
export default function CouriersPage() {
  const run = useAction();
  const [data, setData] = useState(null);
  const [forms, setForms] = useState({}); // courierId -> {enabled, values}
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState("");

  const load = async () => {
    const r = await api.listCouriers({});
    setData(r);
    setSettings({ ...r.settings, sender: { ...(r.settings.sender || {}) } });
    setForms(Object.fromEntries(r.couriers.map((c) => [c.id, { enabled: c.enabled, values: Object.fromEntries(c.fields.map((f) => [f.key, f.value])) }])));
  };
  useEffect(() => { run(load); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !settings) return <PageHead title="Couriers" sub="Loading…" />;

  const saveCourier = async (c) => {
    setBusy(c.id);
    await run(async () => { await api.saveCourierConfig({ courierId: c.id, ...forms[c.id] }); await load(); }, `${c.name} saved`);
    setBusy("");
  };
  const saveSettings = async () => {
    setBusy("settings");
    await run(async () => { await api.saveShippingSettings(settings); await load(); }, "Shipping settings saved");
    setBusy("");
  };
  const setVal = (id, key, v) => setForms((f) => ({ ...f, [id]: { ...f[id], values: { ...f[id].values, [key]: v } } }));
  const sender = settings.sender;
  const apiCouriers = data.couriers.filter((c) => c.api);

  return (
    <>
      <PageHead title="Couriers" sub="Connect delivery partners. Verified orders are booked with them and tracking updates the order status every 30 minutes." />

      <div className="card pad" style={{ marginBottom: 16 }}>
        <h2>Shipping defaults</h2>
        <div className="row2">
          <Field label="Default courier">
            <select className="select" value={settings.defaultCourier} onChange={(e) => setSettings({ ...settings, defaultCourier: e.target.value })}>
              <option value="">None</option>
              {data.couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Currency on waybills"><input className="input" value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} /></Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={!!settings.autoBook} disabled={!apiCouriers.some((c) => c.id === settings.defaultCourier)}
            onChange={(e) => setSettings({ ...settings, autoBook: e.target.checked })} />
          Book with the default courier as soon as an order is verified (couriers with an API only)
        </label>
        <h3 style={{ marginTop: 14 }}>Sender on waybills</h3>
        <div className="row2">
          <Field label="Business name"><input className="input" value={sender.name || ""} onChange={(e) => setSettings({ ...settings, sender: { ...sender, name: e.target.value } })} /></Field>
          <Field label="Phone"><input className="input" value={sender.phone || ""} onChange={(e) => setSettings({ ...settings, sender: { ...sender, phone: e.target.value } })} /></Field>
        </div>
        <Field label="Return address"><input className="input" value={sender.address || ""} onChange={(e) => setSettings({ ...settings, sender: { ...sender, address: e.target.value } })} /></Field>
        <Field label="Note printed on every waybill (optional)"><input className="input" value={sender.note || ""} placeholder="Handle with care" onChange={(e) => setSettings({ ...settings, sender: { ...sender, note: e.target.value } })} /></Field>
        <button className="btn primary" disabled={busy === "settings"} onClick={saveSettings}><Save size={15} />Save defaults</button>
      </div>

      <div className="cards2">
        {data.couriers.map((c) => {
          const f = forms[c.id];
          return (
            <div key={c.id} className="card pad">
              <div className="row" style={{ marginBottom: 8 }}>
                <h2 className="grow">{c.name}</h2>
                {c.api ? <Badge color="blue">API</Badge> : <Badge color="gray">Manual</Badge>}
                {c.enabled ? <Badge color="green">On</Badge> : <Badge color="gray">Off</Badge>}
              </div>
              {c.api && (c.missing.length
                ? <p className="muted"><CircleAlert size={14} /> Still needed: {c.missing.join(", ")}</p>
                : <p className="muted"><CheckCircle2 size={14} /> Ready{c.canTrack ? ", tracking syncs automatically" : ""}</p>)}
              {!c.api && <p className="muted">For couriers without an API. Pick the courier when booking, type their waybill number if you have one, print the label and update the status from the Orders page.</p>}
              {c.fields.map((fd) => (
                <Field key={fd.key} label={fd.label + (fd.secret && fd.isSet ? " (saved, leave blank to keep)" : "")}>
                  <input className="input" type={fd.secret ? "password" : "text"} autoComplete="off" value={f.values[fd.key] ?? ""}
                    placeholder={fd.secret ? (fd.isSet ? "••••••••" : "Paste from the courier") : fd.default || ""}
                    onChange={(e) => setVal(c.id, fd.key, e.target.value)} />
                  {fd.help && <small className="muted">{fd.help}</small>}
                </Field>
              ))}
              <div className="row">
                <label className="check grow"><input type="checkbox" checked={f.enabled} onChange={(e) => setForms({ ...forms, [c.id]: { ...f, enabled: e.target.checked } })} />Enabled</label>
                <button className="btn primary" disabled={busy === c.id} onClick={() => saveCourier(c)}><Save size={15} />Save</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

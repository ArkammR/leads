import { RANGE_PRESETS, ymd } from "../lib/constants";

// Date range as ["YYYY-MM-DD", "YYYY-MM-DD"], with quick presets.
export default function RangePicker({ range, onChange }) {
  return (
    <>
      <select className="select" style={{ width: "auto" }} value="" onChange={(e) => e.target.value && onChange(RANGE_PRESETS[e.target.value]().map(ymd))}>
        <option value="">Quick range…</option>
        {Object.keys(RANGE_PRESETS).map((k) => <option key={k}>{k}</option>)}
      </select>
      <input className="input" style={{ width: "auto" }} type="date" value={range[0]} onChange={(e) => onChange([e.target.value, range[1]])} />
      <input className="input" style={{ width: "auto" }} type="date" value={range[1]} onChange={(e) => onChange([range[0], e.target.value])} />
    </>
  );
}

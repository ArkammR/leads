import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";

// Live collection. `makeQuery` returns a Firestore query (or null to skip).
export function useLive(makeQuery, deps = []) {
  const [state, setState] = useState({ data: [], loading: true, error: null });
  useEffect(() => {
    const q = makeQuery();
    if (!q) { setState({ data: [], loading: false, error: null }); return; }
    return onSnapshot(
      q,
      (s) => setState({ data: s.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null }),
      (error) => setState({ data: [], loading: false, error })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

// Live single document (null while loading or missing). `makeRef` returns a doc ref (or null to skip).
export function useLiveDoc(makeRef, deps = []) {
  const [data, setData] = useState(null);
  useEffect(() => {
    const r = makeRef();
    if (!r) { setData(null); return; }
    return onSnapshot(r, (s) => setData(s.exists() ? { id: s.id, ...s.data() } : null), () => setData(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return data;
}

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

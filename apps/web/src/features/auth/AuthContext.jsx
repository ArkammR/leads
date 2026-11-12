import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, configured } from "../../lib/firebase";

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!configured) return;
    let unsubProfile = () => {};
    const unsub = onAuthStateChanged(auth, (u) => {
      unsubProfile();
      setUser(u);
      if (!u) { setProfile(null); setLoading(false); return; }
      unsubProfile = onSnapshot(
        doc(db, "users", u.uid),
        (s) => { setProfile(s.exists() ? { id: s.id, ...s.data() } : null); setLoading(false); },
        () => { setProfile(null); setLoading(false); }
      );
    });
    return () => { unsub(); unsubProfile(); };
  }, []);

  const value = {
    user, profile, loading,
    login: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    logout: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

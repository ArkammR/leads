import { createContext, useCallback, useContext, useState } from "react";
import { X } from "lucide-react";
import { tone } from "../lib/constants";

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = "ok") => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((i) => (
          <div key={i.id} className={"toast " + (i.kind === "err" ? "err" : "")}>{i.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// Runs an async action, toasting success/failure. Returns true on success.
export function useAction() {
  const toast = useToast();
  return useCallback(async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      toast(e.message || "Something went wrong", "err");
      return false;
    }
  }, [toast]);
}

/* ---------- primitives ---------- */
export const Badge = ({ children, color }) => <span className={"badge " + (color || tone(children))}>{children}</span>;

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export const Field = ({ label, children }) => (
  <div className="field"><label>{label}</label>{children}</div>
);

export const PageHead = ({ title, sub, children }) => (
  <div className="pagehead">
    <div className="grow"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    {children}
  </div>
);

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Stat = ({ icon: Icon, value, label, color = "" }) => (
  <div className="card stat">
    <div className={"ico " + color}><Icon size={20} /></div>
    <div><b>{value}</b><span>{label}</span></div>
  </div>
);

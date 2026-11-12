import { NavLink } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { LayoutDashboard, Users, Package, ShoppingCart, PhoneCall, UserCog, LogOut, Zap } from "lucide-react";
import { useAuth } from "../features/auth/AuthContext";
import { db } from "../lib/firebase";
import { useLive } from "../hooks/useLive";

const ADMIN_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, alerts: true },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/orders", label: "Orders", icon: ShoppingCart },
  { to: "/products", label: "Products", icon: Package },
  { to: "/users", label: "Team", icon: UserCog },
];
const AGENT_NAV = [
  { to: "/", label: "My queue", icon: PhoneCall, end: true },
  { to: "/orders", label: "My orders", icon: ShoppingCart },
];

export default function Layout({ children }) {
  const { profile, logout } = useAuth();
  const admin = profile.role === "admin";
  const { data: alerts } = useLive(
    () => (admin ? query(collection(db, "alerts"), where("resolved", "==", false)) : null),
    [admin]
  );
  const nav = admin ? ADMIN_NAV : AGENT_NAV;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="logo"><Zap size={18} /></span>Leads CRM</div>
        <nav className="nav">
          {nav.map(({ to, label, icon: Icon, end, alerts: showAlerts }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={18} />{label}
              {showAlerts && alerts.length > 0 && <span className="badge red">{alerts.length}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <div className="avatar">{(profile.name || "?")[0].toUpperCase()}</div>
          <div className="who"><div>{profile.name}</div><small>{profile.role}</small></div>
          <button className="btn sm" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

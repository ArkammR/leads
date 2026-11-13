import { Link, NavLink, useLocation } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import {
  LayoutDashboard, Users, Package, ShoppingCart, PhoneCall, UserCog, LogOut, Zap, Boxes, Wallet, TrendingUp,
  Clock, ListChecks, Megaphone, ScrollText, Plug, Truck,
} from "lucide-react";
import { useAuth } from "../features/auth/AuthContext";
import ClockWidget from "../features/attendance/ClockWidget";
import { db } from "../lib/firebase";
import { useLive } from "../hooks/useLive";
import { useUnreadAnnouncements } from "../features/announcements/useUnread";

// badge: which live count to show next to the link
const ADMIN_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, badge: "alerts" },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/lead-sources", label: "Lead sources", icon: Plug },
  { to: "/orders", label: "Orders", icon: ShoppingCart },
  { to: "/couriers", label: "Couriers", icon: Truck },
  { to: "/products", label: "Products", icon: Package },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/finance", label: "Finance", icon: Wallet },
  { to: "/users", label: "Team", icon: UserCog },
  { to: "/attendance", label: "Attendance", icon: Clock },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/announcements", label: "Announcements", icon: Megaphone, badge: "unread" },
  { to: "/activity", label: "Activity log", icon: ScrollText },
];
const AGENT_NAV = [
  { to: "/", label: "My queue", icon: PhoneCall, end: true },
  { to: "/orders", label: "My orders", icon: ShoppingCart },
  { to: "/tasks", label: "My tasks", icon: ListChecks, badge: "tasks" },
  { to: "/performance", label: "My performance", icon: TrendingUp },
  { to: "/attendance", label: "My attendance", icon: Clock },
  { to: "/announcements", label: "Announcements", icon: Megaphone, badge: "unread" },
];

export default function Layout({ children }) {
  const { profile, logout } = useAuth();
  const { pathname } = useLocation();
  const admin = profile.role === "admin";
  const { data: alerts } = useLive(
    () => (admin ? query(collection(db, "alerts"), where("resolved", "==", false)) : null),
    [admin]
  );
  const { data: tasks } = useLive(
    () => (admin ? null : query(collection(db, "tasks"), where("assignedTo", "==", profile.id))),
    [admin, profile.id]
  );
  const unread = useUnreadAnnouncements(profile);
  const counts = {
    alerts: alerts.length,
    unread: unread.length,
    tasks: tasks.filter((t) => t.isActive !== false && t.status === "open").length,
  };
  const nav = admin ? ADMIN_NAV : AGENT_NAV;
  const latest = unread[0];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="logo"><Zap size={18} /></span>Leads CRM</div>
        <nav className="nav">
          {nav.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={18} />{label}
              {badge && counts[badge] > 0 && <span className={"badge " + (badge === "alerts" ? "red" : "blue")}>{counts[badge]}</span>}
            </NavLink>
          ))}
        </nav>
        <ClockWidget />
        <div className="me">
          <div className="avatar">{(profile.name || "?")[0].toUpperCase()}</div>
          <div className="who"><div>{profile.name}</div><small>{profile.role}</small></div>
          <button className="btn sm" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </aside>
      <main className="main">
        {latest && pathname !== "/announcements" && (
          <div className="banner"><Megaphone size={16} />
            <span className="grow"><b>{latest.title}</b>{unread.length > 1 && ` and ${unread.length - 1} more`}</span>
            <Link to="/announcements">Read</Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

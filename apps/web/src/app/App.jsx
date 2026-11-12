import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { configured } from "../lib/firebase";
import Layout from "../components/Layout";
import LoginPage from "../features/auth/LoginPage";
import { adminRoutes, agentRoutes } from "./routes";

export default function App() {
  const { user, profile, loading } = useAuth();

  if (!configured) return <LoginPage setupNeeded />;
  if (loading) return <div className="authwrap muted">Loading…</div>;
  if (!user) return <LoginPage />;
  if (!profile || !profile.isActive) return <LoginPage blocked />;

  const routes = profile.role === "admin" ? adminRoutes : agentRoutes;
  return (
    <Layout>
      <Routes>
        {routes.map(({ path, element }) => <Route key={path} path={path} element={element} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

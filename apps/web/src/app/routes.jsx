import DashboardPage from "../features/dashboard/DashboardPage";
import LeadsPage from "../features/leads/LeadsPage";
import OrdersPage from "../features/orders/OrdersPage";
import MyOrdersPage from "../features/orders/MyOrdersPage";
import FinancePage from "../features/finance/FinancePage";
import InventoryPage from "../features/inventory/InventoryPage";
import PerformancePage from "../features/performance/PerformancePage";
import ProductsPage from "../features/products/ProductsPage";
import TeamPage from "../features/team/TeamPage";
import QueuePage from "../features/queue/QueuePage";

// Role-scoped route tables. (Firestore rules and Cloud Functions enforce access; this only shapes the UI.)
export const adminRoutes = [
  { path: "/", element: <DashboardPage /> },
  { path: "/leads", element: <LeadsPage /> },
  { path: "/orders", element: <OrdersPage /> },
  { path: "/products", element: <ProductsPage /> },
  { path: "/inventory", element: <InventoryPage /> },
  { path: "/finance", element: <FinancePage /> },
  { path: "/users", element: <TeamPage /> },
];

export const agentRoutes = [
  { path: "/", element: <QueuePage /> },
  { path: "/orders", element: <MyOrdersPage /> },
  { path: "/performance", element: <PerformancePage /> },
];

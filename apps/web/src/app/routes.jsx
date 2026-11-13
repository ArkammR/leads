import DashboardPage from "../features/dashboard/DashboardPage";
import LeadsPage from "../features/leads/LeadsPage";
import LeadSourcesPage from "../features/leadSources/LeadSourcesPage";
import OrdersPage from "../features/orders/OrdersPage";
import MyOrdersPage from "../features/orders/MyOrdersPage";
import FinancePage from "../features/finance/FinancePage";
import InventoryPage from "../features/inventory/InventoryPage";
import PerformancePage from "../features/performance/PerformancePage";
import ProductsPage from "../features/products/ProductsPage";
import TeamPage from "../features/team/TeamPage";
import QueuePage from "../features/queue/QueuePage";
import AttendancePage from "../features/attendance/AttendancePage";
import TasksPage from "../features/tasks/TasksPage";
import AnnouncementsPage from "../features/announcements/AnnouncementsPage";
import ActivityPage from "../features/activity/ActivityPage";
import CouriersPage from "../features/couriers/CouriersPage";

// Role-scoped route tables. (Firestore rules and Cloud Functions enforce access; this only shapes the UI.)
export const adminRoutes = [
  { path: "/", element: <DashboardPage /> },
  { path: "/leads", element: <LeadsPage /> },
  { path: "/lead-sources", element: <LeadSourcesPage /> },
  { path: "/orders", element: <OrdersPage /> },
  { path: "/couriers", element: <CouriersPage /> },
  { path: "/products", element: <ProductsPage /> },
  { path: "/inventory", element: <InventoryPage /> },
  { path: "/finance", element: <FinancePage /> },
  { path: "/users", element: <TeamPage /> },
  { path: "/attendance", element: <AttendancePage /> },
  { path: "/tasks", element: <TasksPage /> },
  { path: "/announcements", element: <AnnouncementsPage /> },
  { path: "/activity", element: <ActivityPage /> },
];

export const agentRoutes = [
  { path: "/", element: <QueuePage /> },
  { path: "/orders", element: <MyOrdersPage /> },
  { path: "/tasks", element: <TasksPage /> },
  { path: "/performance", element: <PerformancePage /> },
  { path: "/attendance", element: <AttendancePage /> },
  { path: "/announcements", element: <AnnouncementsPage /> },
];

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOrders } from "@/hooks/use-orders";
import { useWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import { CreateOrderModal } from "@/components/CreateOrderModal";
import { OrdersTable } from "@/components/OrdersTable";
import { CreateUserModal } from "@/components/CreateUserModal";
import { UsersList } from "@/components/UsersList";
import { BoxRejectionReport } from "@/components/BoxRejectionReport";
import { PhoneLinesReport } from "@/components/PhoneLinesReport";
import { BoxLinesSummaryReport } from "@/components/BoxLinesSummaryReport";
import { BoxFullRejectionsReport } from "@/components/BoxFullRejectionsReport";
import { BoxBrokenRejectionsReport } from "@/components/BoxBrokenRejectionsReport";
import { WorkOrdersReport } from "@/components/WorkOrdersReport";
import { NotificationBell } from "@/components/NotificationBell";
import { ROLES, ORDER_STATUS } from "@shared/schema";
import { useLocation } from "wouter";
import { LogOut, LayoutDashboard, FileSpreadsheet, Loader2, BarChart3, ClipboardList } from "lucide-react";
import * as XLSX from 'xlsx';
import { format } from "date-fns";

type AdminTab = "orders" | "reports";
type ReportTab = "box-rejections" | "phone-lines" | "box-summary" | "box-full" | "box-broken" | "work-orders";

export default function Dashboard() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const { orders, isLoading: ordersLoading } = useOrders();
  const [, setLocation] = useLocation();
  const [adminTab, setAdminTab] = useState<AdminTab>("orders");
  const [reportTab, setReportTab] = useState<ReportTab>("box-rejections");

  useWebSocket();

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation("/login");
    } else if (!authLoading && user?.role === ROLES.DATA_MANAGER) {
      setLocation("/phone-lines");
    }
  }, [authLoading, user, setLocation]);

  if (authLoading || ordersLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const handleExport = () => {
    if (!orders) return;
    const statusLabel = (status: string) => {
      switch (status) {
        case "feasible": return "يمكن التنفيذ";
        case "not_feasible": return "لا يمكن";
        case "needs_external": return "يحتاج رد الشئون الخارجية";
        case "external_feasible": return "يمكن التنفيذ (شئون خارجية)";
        case "external_not_feasible": return "لا يمكن (شئون خارجية)";
        default: return "قيد الانتظار";
      }
    };
    const data = orders.map(order => ({
      "رقم الطلب": order.id,
      "التاريخ": format(new Date(order.createdAt), "yyyy-MM-dd HH:mm"),
      "العميل": order.customerName,
      "الهاتف": order.customerPhone,
      "العنوان": order.customerAddress,
      "الرقم القومي": order.nationalId || "",
      "رقم المسلسل": order.serialNumber || "",
      "المندوب": order.salesName,
      "الحالة": statusLabel(order.status),
      "حالة التعاقد": order.contractStatus || "لم يتم التعاقد",
      "سبب الرفض": order.rejectionReason || "",
      "السنترال": order.centralName || "",
      "الكابينة": order.cabinNumber || "",
      "البوكس": order.boxNumber || "",
      "بعد أقرب بوكس": order.nearestBoxDistance || "",
      "ملاحظات": order.additionalNotes || "",
      "الفني": order.techName || "",
      "وقت الرد": order.techResponseAt ? format(new Date(order.techResponseAt), "yyyy-MM-dd HH:mm") : "",
      "موظف الشئون الخارجية": order.externalName || "",
      "رد الشئون الخارجية": order.isFeasibleExternal === true ? "يمكن التنفيذ" : order.isFeasibleExternal === false ? "لا يمكن التنفيذ" : "",
      "سبب رفض الشئون الخارجية": order.externalRejectionReason || "",
      "وقت رد الشئون الخارجية": order.externalResponseAt ? format(new Date(order.externalResponseAt), "yyyy-MM-dd HH:mm") : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
    XLSX.writeFile(wb, `orders_export_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-gray-50/50" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="container mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <LayoutDashboard className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-sm sm:text-lg font-display leading-tight truncate">لوحة التحكم</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">مرحباً، {user.username}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {(user.role === ROLES.SALES || user.role === ROLES.ADMIN) && <NotificationBell />}
            {(user.role === ROLES.TECH || user.role === ROLES.DATA_MANAGER || user.role === ROLES.ADMIN) && (
              <Button variant="outline" size="sm" onClick={() => setLocation("/phone-lines")} className="text-xs sm:text-sm h-8 sm:h-9 px-2 sm:px-3">
                <span className="hidden sm:inline">إدارة البيانات الفنية</span>
                <span className="sm:hidden">البيانات</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => logout()} className="text-muted-foreground hover:text-destructive h-8 sm:h-9 px-2 sm:px-3">
              <LogOut className="w-4 h-4 sm:ml-2" />
              <span className="hidden sm:inline">تسجيل خروج</span>
            </Button>
          </div>
        </div>

        {/* Admin Tab Navigation */}
        {user.role === ROLES.ADMIN && (
          <div className="border-t bg-white">
            <div className="container mx-auto px-4">
              <div className="flex" dir="rtl">
                <button
                  onClick={() => setAdminTab("orders")}
                  data-testid="tab-admin-orders"
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    adminTab === "orders"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ClipboardList className="w-4 h-4" />
                  الطلبات
                </button>
                <button
                  onClick={() => setAdminTab("reports")}
                  data-testid="tab-admin-reports"
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    adminTab === "reports"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  التقارير
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">

        {/* ── REPORTS TAB (Admin only) ── */}
        {user.role === ROLES.ADMIN && adminTab === "reports" && (
          <div className="space-y-4">
            {/* Report sub-tabs */}
            <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit" dir="rtl">
              <button
                onClick={() => setReportTab("box-rejections")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${reportTab === "box-rejections" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                البوكسات المتعذرة
              </button>
              <button
                onClick={() => setReportTab("phone-lines")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${reportTab === "phone-lines" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                بيان التليفونات
              </button>
              <button
                onClick={() => setReportTab("box-summary")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${reportTab === "box-summary" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                ملخص البكسيات
              </button>
              <button
                onClick={() => setReportTab("box-full")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${reportTab === "box-full" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                متعذرات بوكس مليان
              </button>
              <button
                onClick={() => setReportTab("box-broken")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${reportTab === "box-broken" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                متعذرات بوكس معطل
              </button>
              <button
                onClick={() => setReportTab("work-orders")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${reportTab === "work-orders" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                أوامر الشغل
              </button>
            </div>

            {reportTab === "box-rejections" && <BoxRejectionReport orders={orders || []} />}
            {reportTab === "phone-lines" && <PhoneLinesReport />}
            {reportTab === "box-summary" && <BoxLinesSummaryReport />}
            {reportTab === "box-full" && <BoxFullRejectionsReport orders={orders || []} />}
            {reportTab === "box-broken" && <BoxBrokenRejectionsReport orders={orders || []} />}
            {reportTab === "work-orders" && <WorkOrdersReport />}
          </div>
        )}

        {/* ── ORDERS TAB (all roles) ── */}
        {(user.role !== ROLES.ADMIN || adminTab === "orders") && (
          <>
            {/* Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <div className="flex items-center gap-2">
                {user.role === ROLES.SALES && <CreateOrderModal />}
                {user.role === ROLES.ADMIN && (
                  <>
                    <CreateUserModal />
                    <UsersList />
                  </>
                )}
              </div>

              {user.role !== ROLES.EXTERNAL && (
                <Button variant="outline" onClick={handleExport} className="bg-white">
                  <FileSpreadsheet className="w-4 h-4 ml-2 text-green-600" />
                  تصدير Excel
                </Button>
              )}
            </div>

            {/* Stats Cards */}
            {user.role === ROLES.EXTERNAL ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-white p-6 rounded-xl border shadow-sm">
                  <div className="text-sm text-muted-foreground mb-1">الطلبات المحولة إليك</div>
                  <div className="text-2xl font-bold font-display text-yellow-600">{orders?.length || 0}</div>
                </div>
                <div className="bg-white p-6 rounded-xl border shadow-sm">
                  <div className="text-sm text-muted-foreground mb-1">بانتظار ردك</div>
                  <div className="text-2xl font-bold font-display text-orange-600">
                    {orders?.filter(o => o.status === ORDER_STATUS.NEEDS_EXTERNAL).length || 0}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-white p-6 rounded-xl border shadow-sm">
                  <div className="text-sm text-muted-foreground mb-1">إجمالي الطلبات</div>
                  <div className="text-2xl font-bold font-display">{orders?.length || 0}</div>
                </div>
                <div className="bg-white p-6 rounded-xl border shadow-sm">
                  <div className="text-sm text-muted-foreground mb-1">يمكن التنفيذ</div>
                  <div className="text-2xl font-bold font-display text-green-600">
                    {orders?.filter(o => o.status === ORDER_STATUS.FEASIBLE).length || 0}
                  </div>
                </div>
                <div className="bg-white p-6 rounded-xl border shadow-sm">
                  <div className="text-sm text-muted-foreground mb-1">قيد الانتظار</div>
                  <div className="text-2xl font-bold font-display text-yellow-600">
                    {orders?.filter(o => o.status === ORDER_STATUS.PENDING).length || 0}
                  </div>
                </div>
              </div>
            )}

            {/* Data Table */}
            <OrdersTable orders={orders || []} />
          </>
        )}
      </main>
    </div>
  );
}

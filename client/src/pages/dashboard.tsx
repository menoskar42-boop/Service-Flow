import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOrders } from "@/hooks/use-orders";
import { useWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import { CreateOrderModal } from "@/components/CreateOrderModal";
import { OrdersTable } from "@/components/OrdersTable";
import { CreateUserModal } from "@/components/CreateUserModal";
import { UsersList } from "@/components/UsersList";
import { ROLES } from "@shared/schema";
import { useLocation } from "wouter";
import { LogOut, LayoutDashboard, FileSpreadsheet, Loader2, Users } from "lucide-react";
import * as XLSX from 'xlsx';
import { format } from "date-fns";

export default function Dashboard() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const { orders, isLoading: ordersLoading } = useOrders();
  const [, setLocation] = useLocation();

  // Initialize WebSocket for real-time updates
  useWebSocket();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      setLocation("/login");
    }
  }, [authLoading, user, setLocation]);

  if (authLoading || ordersLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleExport = () => {
    if (!orders) return;
    
    // Transform data for Excel
    const data = orders.map(order => ({
      "رقم الطلب": order.id,
      "التاريخ": format(new Date(order.createdAt), "yyyy-MM-dd HH:mm"),
      "العميل": order.customerName,
      "الهاتف": order.customerPhone,
      "العنوان": order.customerAddress,
      "الرقم القومي": order.nationalId || "",
      "المندوب": order.salesName,
      "الحالة": order.status === "feasible" ? "يمكن التنفيذ" : order.status === "not_feasible" ? "لا يمكن" : "قيد الانتظار",
      "سبب الرفض": order.rejectionReason || "",
      "السنترال": order.centralName || "",
      "الكابينة": order.cabinNumber || "",
      "البوكس": order.boxNumber || "",
      "بعد أقرب بوكس": order.nearestBoxDistance || "",
      "ملاحظات": order.additionalNotes || "",
      "الفني": order.techName || "",
      "وقت الرد": order.techResponseAt ? format(new Date(order.techResponseAt), "yyyy-MM-dd HH:mm") : "",
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
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <LayoutDashboard className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg font-display leading-tight">لوحة التحكم</h1>
              <p className="text-xs text-muted-foreground">مرحباً بك، {user.username}</p>
            </div>
          </div>
          
          <Button variant="ghost" size="sm" onClick={() => logout()} className="text-muted-foreground hover:text-destructive">
            <LogOut className="w-4 h-4 ml-2" />
            تسجيل خروج
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
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
          
          <Button variant="outline" onClick={handleExport} className="bg-white">
            <FileSpreadsheet className="w-4 h-4 ml-2 text-green-600" />
            تصدير Excel
          </Button>
        </div>

        {/* Stats Cards (Optional Polish) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <div className="text-sm text-muted-foreground mb-1">إجمالي الطلبات</div>
            <div className="text-2xl font-bold font-display">{orders?.length || 0}</div>
          </div>
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <div className="text-sm text-muted-foreground mb-1">يمكن التنفيذ</div>
            <div className="text-2xl font-bold font-display text-green-600">
              {orders?.filter(o => o.status === "feasible").length || 0}
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <div className="text-sm text-muted-foreground mb-1">قيد الانتظار</div>
            <div className="text-2xl font-bold font-display text-yellow-600">
              {orders?.filter(o => o.status === "pending").length || 0}
            </div>
          </div>
        </div>

        {/* Data Table */}
        <OrdersTable orders={orders || []} />
      </main>
    </div>
  );
}

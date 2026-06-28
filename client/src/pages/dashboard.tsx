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
import { CurrentFaultsReport } from "@/components/CurrentFaultsReport";
import { WithAccountReport } from "@/components/WithAccountReport";
import { WithoutAccountReport } from "@/components/WithoutAccountReport";
import { RegularizedNoAccountReport } from "@/components/RegularizedNoAccountReport";
import { NeedsSpeedReport } from "@/components/NeedsSpeedReport";
import { ComplaintNoMeasureReport } from "@/components/ComplaintNoMeasureReport";
import { CabinetScoreReport } from "@/components/CabinetScoreReport";
import { BoxScoreReport } from "@/components/BoxScoreReport";
import { AccountEditsReport } from "@/components/AccountEditsReport";
import { RegularizedFaultsReport } from "@/components/RegularizedFaultsReport";
import { RegularizedFaultsRangeReport } from "@/components/RegularizedFaultsRangeReport";
import { InstallationsReport } from "@/components/InstallationsReport";
import { RemovalStatsReport } from "@/components/RemovalStatsReport";
import { RepetitionStatsReport } from "@/components/RepetitionStatsReport";
import { CabinetAdslFaultsReport } from "@/components/CabinetAdslFaultsReport";
import { TechPerformanceReport } from "@/components/TechPerformanceReport";
import { OmRejectionsReport } from "@/components/OmRejectionsReport";
import { OmStatsReport } from "@/components/OmStatsReport";
import { FileUploadSection } from "@/components/FileUploadSection";
import { DataCompletionSection } from "@/components/DataCompletionSection";
import { CfmTicketsReport } from "@/components/CfmTicketsReport";
import { GroundNetworkFaultsTab } from "@/components/GroundNetworkFaultsTab";
import { NotificationBell } from "@/components/NotificationBell";
import { ROLES, ORDER_STATUS } from "@shared/schema";
import { useLocation } from "wouter";
import { LogOut, LayoutDashboard, FileSpreadsheet, Loader2, BarChart3, ClipboardList, Upload, Zap, Phone, Box, AlertTriangle, FileText, Wrench, ChevronDown, Menu, Cable } from "lucide-react";
import * as XLSX from 'xlsx';
import { format } from "date-fns";

type AdminTab = "orders" | "reports" | "data-completion" | "file-upload";
type ReportTab = "box-rejections" | "phone-lines" | "box-summary" | "box-full" | "box-broken" | "work-orders" | "current-faults" | "regularized-faults" | "regularized-faults-range" | "current-installations" | "regularized-installations" | "regularized-installations-range" | "current-surveys" | "regularized-surveys" | "regularized-surveys-range" | "removal-stats" | "repetition-stats" | "cabinet-adsl-faults" | "tech-performance" | "om-current" | "om-soy" | "om-resolved" | "om-stats" | "with-account" | "without-account" | "cabinet-score-avg" | "account-edits" | "regularized-no-account" | "needs-speed-complaint" | "high-score" | "needs-speed-all" | "complaint-no-measure" | "cfm-tickets" | "ground-network";

// ── Sidebar navigation definition ──────────────────────────────────────────
const REPORT_GROUPS: { label: string; icon: React.ElementType; items: { id: ReportTab; label: string }[] }[] = [
  {
    label: "الأعطال",
    icon: Zap,
    items: [
      { id: "current-faults",      label: "الأعطال الحالية" },
      { id: "regularized-faults",  label: "الأعطال المنتظمة اليوم" },
      { id: "regularized-faults-range", label: "الأعطال المنتظمة (فترة من/إلى)" },
      { id: "cabinet-adsl-faults", label: "عدد الأعطال فى الألف" },
      { id: "removal-stats",       label: "إحصائيات الإزالة" },
      { id: "repetition-stats",    label: "إحصائيات التكرار" },
      { id: "tech-performance",    label: "تقرير أداء الفنيين" },
    ],
  },
  {
    label: "القياسات",
    icon: Cable,
    items: [
      { id: "with-account",        label: "خطوط لها رقم أكونت" },
      { id: "account-never-measured", label: "خطوط لها أكونت ولم تُقَس" },
      { id: "without-account",     label: "خطوط بدون رقم أكونت" },
      { id: "regularized-no-account", label: "أعطال منتظمة بدون أكونت" },
      { id: "ground-network",      label: "أعطال الشبكة الأرضية" },
      { id: "needs-speed-complaint",  label: "محتاجة رفع سرعة (لها شكوى)" },
      { id: "high-score",          label: "خطوط أسكورها أعلى من 100" },
      { id: "needs-speed-all",     label: "محتاجة رفع سرعة (الكل)" },
      { id: "complaint-no-measure",   label: "شكوى بدون قياس بعدها" },
      { id: "box-score-avg",       label: "متوسط القياسات" },
      { id: "account-edits",       label: "تعديلات الأكونت" },
    ],
  },
  {
    label: "متعذرات OM",
    icon: FileText,
    items: [
      { id: "om-current",  label: "المتعذرات الحالية" },
      { id: "om-soy",      label: "متعذرات بداية السنة" },
      { id: "om-resolved", label: "متعذرات تم فكها" },
      { id: "om-stats",    label: "إحصائية متعذرات OM" },
    ],
  },
  {
    label: "التركيبات والنقل",
    icon: Wrench,
    items: [
      { id: "current-installations",     label: "التركيبات والنقل الحالى" },
      { id: "regularized-installations", label: "التركيبات المنتظمة اليوم" },
      { id: "regularized-installations-range", label: "التركيبات المنتظمة (فترة من/إلى)" },
    ],
  },
  {
    label: "المعاينات",
    icon: ClipboardList,
    items: [
      { id: "current-surveys",     label: "المعاينات الحالية" },
      { id: "regularized-surveys", label: "المعاينات المنتظمة اليوم" },
      { id: "regularized-surveys-range", label: "المعاينات المنتظمة (فترة من/إلى)" },
    ],
  },
  {
    label: "الخطوط والبكسيات",
    icon: Phone,
    items: [
      { id: "phone-lines",  label: "بيان التليفونات" },
      { id: "box-summary",  label: "ملخص البكسيات" },
    ],
  },
  {
    label: "المتعذرات",
    icon: AlertTriangle,
    items: [
      { id: "box-rejections", label: "البوكسات المتعذرة" },
      { id: "box-full",       label: "متعذرات بوكس مليان" },
      { id: "box-broken",     label: "متعذرات بوكس معطل" },
    ],
  },
  {
    label: "أوامر الشغل",
    icon: FileText,
    items: [
      { id: "work-orders", label: "أوامر الشغل" },
    ],
  },
  {
    label: "تقارير أعطال الشبكات الأرضية",
    icon: AlertTriangle,
    items: [
      { id: "cfm-tickets", label: "تذاكر الأعطال" },
    ],
  },
];

export default function Dashboard() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const { orders, isLoading: ordersLoading } = useOrders();
  const [, setLocation] = useLocation();
  const [adminTab, setAdminTab] = useState<AdminTab>("orders");
  const [reportTab, setReportTab] = useState<ReportTab>("current-faults");
  // مجموعات التقارير القابلة للطى — المجموعة التى تحوى التقرير النشط مفتوحة افتراضياً
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    const g = REPORT_GROUPS.find((grp) => grp.items.some((it) => it.id === "current-faults"));
    return g ? [g.label] : [];
  });
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]);

  // مجموعات التقارير المعروضة حسب الدور
  // مسئول البيانات: يرى تقريرين من القياسات + أوامر الشغل (للعرض فقط)
  const DM_ALLOWED: ReportTab[] = ["without-account", "regularized-no-account", "ground-network", "work-orders"];
  const DM_ALLOWED_GROUPS = ["القياسات", "أوامر الشغل"];
  const visibleGroups = REPORT_GROUPS
    .filter((g) => user?.role !== ROLES.DATA_MANAGER || DM_ALLOWED_GROUPS.includes(g.label))
    .map((g) =>
      user?.role === ROLES.DATA_MANAGER
        ? { ...g, items: g.items.filter((it) => DM_ALLOWED.includes(it.id)) }
        : g,
    );
  // قائمة التقارير على الموبايل: مطوية افتراضياً، تُفتح بزر
  const [navOpen, setNavOpen] = useState(false);
  const currentReportLabel =
    REPORT_GROUPS.flatMap((g) => g.items).find((it) => it.id === reportTab)?.label ?? "اختر التقرير";

  useWebSocket();

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation("/login");
    } else if (!authLoading && user?.role === ROLES.DATA_MANAGER) {
      setAdminTab("reports");
      setOpenGroups(["القياسات"]);
      setReportTab("without-account");
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
      "الكابينه": order.cabinNumber || "",
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

        {/* Tab Navigation — Admin, Tech & Data Manager */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.TECH || user.role === ROLES.DATA_MANAGER) && (
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
                {(user.role === ROLES.ADMIN || user.role === ROLES.DATA_MANAGER) && (
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
                )}
                {(user.role === ROLES.ADMIN || user.role === ROLES.TECH) && (
                  <button
                    onClick={() => setAdminTab("data-completion")}
                    data-testid="tab-admin-data-completion"
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      adminTab === "data-completion"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Cable className="w-4 h-4" />
                    استكمال بيانات
                  </button>
                )}
                {(user.role === ROLES.ADMIN || user.role === ROLES.DATA_MANAGER) && (
                  <button
                    onClick={() => setAdminTab("file-upload")}
                    data-testid="tab-admin-file-upload"
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      adminTab === "file-upload"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    رفع الملفات
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">

        {/* ── REPORTS TAB (Admin & Data Manager) ── */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.DATA_MANAGER) && adminTab === "reports" && (
          <div className="flex flex-col lg:flex-row gap-3 lg:gap-5" dir="rtl">
            {/* ── زر فتح/قفل القائمة على الموبايل ── */}
            <button
              onClick={() => setNavOpen((v) => !v)}
              className="lg:hidden w-full flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-600 text-white shadow-sm"
            >
              <Menu className="w-5 h-5 shrink-0" />
              <span className="text-sm font-bold flex-1 text-right truncate">{currentReportLabel}</span>
              <ChevronDown className={`w-5 h-5 shrink-0 transition-transform ${navOpen ? "" : "-rotate-90"}`} />
            </button>

            {/* ── Sidebar ── */}
            <aside className={`${navOpen ? "block" : "hidden"} lg:block w-full lg:w-52 shrink-0`}>
              <nav className="lg:sticky lg:top-4 bg-white rounded-xl border shadow-sm overflow-hidden lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto sidebar-scroll">
                {visibleGroups.map((group) => {
                  const isOpen = openGroups.includes(group.label);
                  return (
                    <div key={group.label}>
                      <button
                        onClick={() => toggleGroup(group.label)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 m-1 w-[calc(100%-0.5rem)] rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
                      >
                        <group.icon className="w-4 h-4 text-white shrink-0" />
                        <span className="text-sm font-bold text-white flex-1 text-right">{group.label}</span>
                        <ChevronDown className={`w-4 h-4 text-white shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                      </button>
                      {isOpen && group.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => { setReportTab(item.id); setNavOpen(false); }}
                          className={`w-full text-right px-4 py-2.5 text-sm transition-colors border-b last:border-b-0
                            ${reportTab === item.id
                              ? "bg-blue-50 text-blue-700 font-semibold border-r-2 border-r-blue-600"
                              : "text-foreground hover:bg-muted/40"
                            }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </nav>
            </aside>

            {/* ── Report Content ── */}
            <div className="flex-1 min-w-0">
              {reportTab === "box-rejections"    && <BoxRejectionReport orders={orders || []} />}
              {reportTab === "phone-lines"       && <PhoneLinesReport />}
              {reportTab === "box-summary"       && <BoxLinesSummaryReport />}
              {reportTab === "box-full"          && <BoxFullRejectionsReport orders={orders || []} />}
              {reportTab === "box-broken"        && <BoxBrokenRejectionsReport orders={orders || []} />}
              {reportTab === "work-orders"       && <WorkOrdersReport />}
              {reportTab === "current-faults"    && <CurrentFaultsReport />}
              {reportTab === "regularized-faults" && <RegularizedFaultsReport />}
              {reportTab === "regularized-faults-range" && <RegularizedFaultsRangeReport />}
              {reportTab === "current-installations" && (
                <InstallationsReport
                  endpoint="/api/reports/current-installations"
                  queryKey="/api/reports/current-installations"
                  title="تقرير التركيبات والنقل الحالى"
                  sheetName="التركيبات الحالية"
                  fileName="current-installations"
                />
              )}
              {reportTab === "regularized-installations" && (
                <InstallationsReport
                  endpoint="/api/reports/regularized-installations"
                  queryKey="/api/reports/regularized-installations"
                  title="تقرير التركيبات المنتظمة اليوم"
                  regularized
                  sheetName="التركيبات المنتظمة"
                  fileName="regularized-installations"
                />
              )}
              {reportTab === "current-surveys" && (
                <InstallationsReport
                  endpoint="/api/reports/current-surveys"
                  queryKey="/api/reports/current-surveys"
                  title="تقرير المعاينات الحالية"
                  sheetName="المعاينات الحالية"
                  fileName="current-surveys"
                  phoneLabel="المسلسل"
                />
              )}
              {reportTab === "regularized-surveys" && (
                <InstallationsReport
                  endpoint="/api/reports/regularized-surveys"
                  queryKey="/api/reports/regularized-surveys"
                  title="تقرير المعاينات المنتظمة اليوم"
                  regularized
                  sheetName="المعاينات المنتظمة"
                  fileName="regularized-surveys"
                  phoneLabel="المسلسل"
                />
              )}
              {reportTab === "regularized-installations-range" && (
                <InstallationsReport
                  endpoint="/api/reports/regularized-daily"
                  queryKey="/api/reports/regularized-daily-installations"
                  extraParams={{ category: "installations" }}
                  showDates
                  title="تقرير التركيبات المنتظمة (فترة من/إلى)"
                  regularized
                  sheetName="التركيبات المنتظمة بتاريخ"
                  fileName="regularized-installations-range"
                />
              )}
              {reportTab === "regularized-surveys-range" && (
                <InstallationsReport
                  endpoint="/api/reports/regularized-daily"
                  queryKey="/api/reports/regularized-daily-surveys"
                  extraParams={{ category: "surveys" }}
                  showDates
                  title="تقرير المعاينات المنتظمة (فترة من/إلى)"
                  regularized
                  sheetName="المعاينات المنتظمة بتاريخ"
                  fileName="regularized-surveys-range"
                  phoneLabel="المسلسل"
                />
              )}
              {reportTab === "removal-stats" && <RemovalStatsReport />}
              {reportTab === "repetition-stats" && <RepetitionStatsReport />}
              {reportTab === "tech-performance" && <TechPerformanceReport />}
              {reportTab === "cabinet-adsl-faults" && <CabinetAdslFaultsReport />}
              {reportTab === "om-current"  && <OmRejectionsReport bucket="current"  title="المتعذرات الحالية (OM)" />}
              {reportTab === "om-soy"      && <OmRejectionsReport bucket="soy"      title="متعذرات بداية السنة (OM)" />}
              {reportTab === "om-resolved" && <OmRejectionsReport bucket="resolved" title="متعذرات تم فكها (OM)" />}
              {reportTab === "om-stats"    && <OmStatsReport />}
              {reportTab === "with-account"        && <WithAccountReport />}
              {reportTab === "account-never-measured" && <WithAccountReport neverMeasured title="خطوط لها رقم أكونت ولم يتم قياسها من قبل" />}
              {reportTab === "high-score"          && <WithAccountReport scoreGt={100} title="الخطوط التى أسكورها أعلى من 100" />}
              {reportTab === "without-account"     && <WithoutAccountReport />}
              {reportTab === "regularized-no-account" && <RegularizedNoAccountReport />}
              {reportTab === "ground-network" && <GroundNetworkFaultsTab />}
              {reportTab === "needs-speed-complaint"  && <NeedsSpeedReport requireComplaint title="أرقام لها شكوى ومحتاجة رفع سرعة" />}
              {reportTab === "needs-speed-all"        && <NeedsSpeedReport title="أرقام محتاجة رفع سرعة" />}
              {reportTab === "complaint-no-measure"   && <ComplaintNoMeasureReport />}
              {reportTab === "box-score-avg"       && <BoxScoreReport />}
              {reportTab === "account-edits"       && <AccountEditsReport />}
              {reportTab === "cfm-tickets"         && <CfmTicketsReport />}
            </div>
          </div>
        )}

        {/* ── DATA COMPLETION TAB (Admin & Tech) ── */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.TECH) && adminTab === "data-completion" && (
          <div className="space-y-6">
            <DataCompletionSection />
          </div>
        )}

        {/* ── FILE UPLOAD TAB (Admin only) ── */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.DATA_MANAGER) && adminTab === "file-upload" && (
          <div className="space-y-6">
            <FileUploadSection />
          </div>
        )}

        {/* ── ORDERS TAB (all roles) ── */}
        {((user.role !== ROLES.ADMIN && user.role !== ROLES.TECH) || adminTab === "orders") && (
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

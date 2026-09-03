import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOrders } from "@/hooks/use-orders";
import { useWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import { CreateOrderModal } from "@/components/CreateOrderModal";
import { OrdersTable } from "@/components/OrdersTable";
import { CreateUserModal } from "@/components/CreateUserModal";
import { UsersList } from "@/components/UsersList";
import { UnifiedUsersManager } from "@/components/UnifiedUsersManager";
import { BoxRejectionReport } from "@/components/BoxRejectionReport";
import { PhoneLinesReport } from "@/components/PhoneLinesReport";
import { PhoneLookupReport } from "@/components/PhoneLookupReport";
import { BoxLinesSummaryReport } from "@/components/BoxLinesSummaryReport";
import { BoxFullRejectionsReport } from "@/components/BoxFullRejectionsReport";
import { BoxBrokenRejectionsReport } from "@/components/BoxBrokenRejectionsReport";
import { WorkOrdersReport } from "@/components/WorkOrdersReport";
import { InstallationsByTechReport } from "@/components/InstallationsByTechReport";
import { WorkOrdersNoCableReport } from "@/components/WorkOrdersNoCableReport";
import { CurrentFaultsReport } from "@/components/CurrentFaultsReport";
import { WithAccountReport } from "@/components/WithAccountReport";
import { NoAccountTab } from "@/components/NoAccountTab";
import { NeedsSpeedTab } from "@/components/NeedsSpeedTab";
import { printTablePDF } from "@/lib/print-pdf";
import { OmOrderMatchReport } from "@/components/OmOrderMatchReport";
import { NeedsSpeedReport } from "@/components/NeedsSpeedReport";
import { ComplaintNoMeasureReport } from "@/components/ComplaintNoMeasureReport";
import { CabinetScoreReport } from "@/components/CabinetScoreReport";
import { BoxScoreReport } from "@/components/BoxScoreReport";
import { AccountEditsReport } from "@/components/AccountEditsReport";
import { DuplicateAccountsReport } from "@/components/DuplicateAccountsReport";
import { LinesWithoutPortReport } from "@/components/LinesWithoutPortReport";
import { PortsMissingLineDataReport } from "@/components/PortsMissingLineDataReport";
import { LinesNoMobileReport } from "@/components/LinesNoMobileReport";
import { RegularizedFaultsReport } from "@/components/RegularizedFaultsReport";
import { RegularizedFaultsRangeReport } from "@/components/RegularizedFaultsRangeReport";
import { RepeatedWithinMonthReport } from "@/components/RepeatedWithinMonthReport";
import { InstallationsReport } from "@/components/InstallationsReport";
import { SubscriberInfoReport } from "@/components/SubscriberInfoReport";
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
import { SlotCardsReport } from "@/components/SlotCardsReport";
import { CabinetPortFreeReport } from "@/components/CabinetPortFreeReport";
import { RemovedPortsReport } from "@/components/RemovedPortsReport";
import { BoxFaultTicketsReport } from "@/components/BoxFaultTicketsReport";
import { MaintenanceComprehensiveReport } from "@/components/MaintenanceComprehensiveReport";
import { BoxOverlapReport } from "@/components/BoxOverlapReport";
import { MaintenancePlanH2Report } from "@/components/MaintenancePlanH2Report";
import { CabinetCapacityReport } from "@/components/CabinetCapacityReport";
import { ExecutorButton } from "@/components/ExecutorButton";
import { DailyAutoRefresh } from "@/components/DailyAutoRefresh";
import { ExecQueueWatcher } from "@/components/ExecQueueWatcher";
import { ExecJobsReport } from "@/components/ExecJobsReport";
import { QueueReorderPanel } from "@/components/QueueReorderPanel";
import { ExecBatchesReport } from "@/components/ExecBatchesReport";
import { ManualCurrentFaultsReport } from "@/components/ManualCurrentFaultsReport";
import { EngineeringInspectionReport } from "@/components/EngineeringInspectionReport";
import { MajorFaultsReport } from "@/components/MajorFaultsReport";
import { ClosedPortCabinetsReport } from "@/components/ClosedPortCabinetsReport";
import { InspectionReports } from "@/components/InspectionReports";
import { ShiftScheduleReport } from "@/components/ShiftScheduleReport";
import { PortChangeReport } from "@/components/PortChangeReport";
import { ManualRegularizedFaultsRangeReport } from "@/components/ManualRegularizedFaultsRangeReport";
import { PortsSuspendFreeReport } from "@/components/PortsSuspendFreeReport";
import { NotificationBell } from "@/components/NotificationBell";
import { ChangeMyPasswordButton } from "@/components/ChangeMyPasswordButton";
import { useWakeLock } from "@/lib/use-wake-lock";
import { ROLES, ORDER_STATUS } from "@shared/schema";
import { canAccessCFM, canAccessMaint } from "@shared/roles-access";
import { useLocation } from "wouter";
import { Printer, LogOut, LayoutDashboard, FileSpreadsheet, Loader2, BarChart3, ClipboardList, Upload, Zap, Phone, Box, AlertTriangle, FileText, Wrench, ChevronDown, Menu, Cable, Server, CalendarDays } from "lucide-react";
import * as XLSX from 'xlsx';
import { format } from "date-fns";

type AdminTab = "orders" | "reports" | "phone-lookup" | "data-completion" | "file-upload";
type ReportTab = "box-rejections" | "phone-lines" | "ports-missing-line-data" | "box-summary" | "box-full" | "box-broken" | "work-orders" | "current-faults" | "major-faults" | "regularized-faults" | "regularized-faults-range" | "current-installations" | "regularized-installations" | "regularized-installations-range" | "current-surveys" | "regularized-surveys" | "regularized-surveys-range" | "removal-stats" | "repetition-stats" | "cabinet-adsl-faults" | "tech-performance" | "om-current" | "om-soy" | "om-resolved" | "om-stats" | "om-stats-2026" | "om-stats-prior" | "with-account" | "no-account" | "cabinet-score-avg" | "account-edits" | "needs-speed" | "high-score" | "complaint-no-measure" | "cfm-tickets" | "ground-network" | "maintenance-comprehensive" | "phone-lookup" | "repeated-within-month" | "needs-po-stop" | "subscriber-info" | "box-overlap" | "maintenance-plan-h2" | "ports-suspend-free" | "cabinet-capacity" | "exec-jobs" | "manual-current-faults" | "manual-regularized-range" | "closed-port-cabinets" | "port-change" | "engineering-inspection" | "queue-reorder" | "exec-batches" | "work-orders-over24" | "work-orders-fail" | "installations-by-tech" | "inspection-reports" | "shift-schedule" | "duplicate-accounts" | "lines-without-port" | "work-orders-no-cable" | "removed-ports" | "box-tickets-backfill" | "box-tickets-repaired" | "slot-cards" | "cabinet-port-free" | "account-never-measured" | "box-score-avg" | "lines-no-mobile" | "needs-speed-lowscore" | "lines-mobile-checked" | "om-order-match";

// ── Sidebar navigation definition ──────────────────────────────────────────
const REPORT_GROUPS: { label: string; icon: React.ElementType; items: { id: ReportTab; label: string }[] }[] = [
  {
    label: "الأعطال",
    icon: Zap,
    items: [
      { id: "current-faults",      label: "الأعطال الحالية" },
      { id: "regularized-faults",  label: "الأعطال المنتظمة اليوم" },
      { id: "regularized-faults-range", label: "الأعطال المنتظمة (فترة من/إلى)" },
      { id: "manual-current-faults", label: "الأعطال الحالية خارج الشاشة" },
      { id: "manual-regularized-range", label: "الأعطال المنتظمة خارج الشاشة (فترة)" },
      { id: "repeated-within-month", label: "الأعطال المكررة خلال شهر من تاريخه" },
      { id: "cabinet-adsl-faults", label: "عدد الأعطال فى الألف" },
      { id: "removal-stats",       label: "إحصائيات الإزالة" },
      { id: "repetition-stats",    label: "إحصائيات التكرار" },
      { id: "tech-performance",    label: "تقرير أداء الفنيين" },
    ],
  },
  {
    // مجموعة إنشاء الجداول — مخفية عن الفنيين وأدمن المبيعات وموظفى المبيعات (إدارة فقط)
    label: "إنشاء جداول",
    icon: FileText,
    items: [
      { id: "major-faults",           label: "الأعطال الجسيمة" },
      { id: "engineering-inspection", label: "أعطال التفتيش الهندسى" },
      { id: "closed-port-cabinets",   label: "الكباين المغلقة بورتات" },
    ],
  },
  {
    // جدول الورديات — للكل ما عدا المبيعات وأدمن المبيعات ومسئول البيانات؛ الفنى يشوف بدون تعديل
    label: "جدول الورديات",
    icon: CalendarDays,
    items: [
      { id: "shift-schedule", label: "جدول الورديات" },
    ],
  },
  {
    label: "القياسات",
    icon: Cable,
    items: [
      { id: "with-account",        label: "خطوط لها رقم أكونت" },
      { id: "account-never-measured", label: "خطوط لها أكونت ولم تُقَس" },
      { id: "no-account",          label: "بدون أكونت" },
      { id: "ground-network",      label: "أعطال الشبكة الأرضية" },
      { id: "needs-speed",         label: "محتاجة رفع سرعة" },
      { id: "needs-speed-lowscore", label: "اسكور منخفض وسرعة عالية" },
      { id: "needs-po-stop",       label: "تحتاج إيقاف PO" },
      { id: "high-score",          label: "خطوط أسكورها أعلى من 100" },
      { id: "complaint-no-measure",   label: "شكوى بدون قياس بعدها" },
      { id: "box-score-avg",       label: "متوسط القياسات" },
      { id: "account-edits",       label: "تعديلات الأكونت" },
      { id: "duplicate-accounts",  label: "أكونتات مكررة على خطوط مختلفة" },
    ],
  },
  {
    // بعد «القياسات» مباشرةً — لأن باتشات القياس/رفع السرعة/الإيقاف بتتبعت من تقارير القياسات
    label: "معاملات التنفيذ",
    icon: Server,
    items: [
      { id: "exec-jobs", label: "سجل القياس/رفع السرعة/الإيقاف" },
      { id: "exec-batches", label: "سجل كل الباتشات (المنفَّذة والملغاة)" },
      { id: "queue-reorder", label: "ترتيب الطابور (الباتشات المؤجّلة)" },
    ],
  },
  {
    label: "متعذرات OM",
    icon: FileText,
    items: [
      { id: "om-current",  label: "المتعذرات الحالية" },
      { id: "om-order-match", label: "ربط الطلبات بالمتعذرات الحالية" },
      { id: "om-soy",      label: "متعذرات بداية السنة" },
      { id: "om-resolved", label: "متعذرات تم فكها" },
      { id: "box-tickets-repaired", label: "متعذرات على بكسيات معطلة تم إصلاحها" },
      { id: "box-tickets-backfill", label: "فحص «بوكس معطل» بأثر رجعى" },
      { id: "om-stats",    label: "إحصائية متعذرات OM" },
      { id: "om-stats-2026",  label: "إحصائية متعذرات OM — 2026" },
      { id: "om-stats-prior", label: "إحصائية متعذرات OM — أعوام سابقة" },
    ],
  },
  {
    label: "تركيبات و نقل و اوامر شغل",
    icon: Wrench,
    items: [
      { id: "current-installations",     label: "التركيبات والنقل الحالى" },
      { id: "regularized-installations", label: "التركيبات المنتظمة اليوم" },
      { id: "regularized-installations-range", label: "التركيبات المنتظمة (فترة من/إلى)" },
      { id: "work-orders", label: "أوامر الشغل" },
      { id: "work-orders-fail", label: "أوامر الشغل الفاشلة (Fail)" },
      { id: "work-orders-no-cable", label: "أوامر شغل بدون كمية سلك" },
      { id: "installations-by-tech", label: "نسبة التركيبات لكل فنى" },
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
      { id: "ports-missing-line-data", label: "بورتات بلا بيان فني أو اسم/عنوان" },
      { id: "lines-without-port", label: "بيان فنى بدون بورت" },
      { id: "lines-no-mobile", label: "أرقام بدون رقم موبايل تحت الفحص" },
      { id: "lines-mobile-checked", label: "أرقام تم الفحص وتحتاج أرقام محمول" },
      { id: "box-summary",  label: "ملخص البكسيات" },
      { id: "port-change", label: "متابعة تغيير البورت" },
      { id: "subscriber-info", label: "اسم وعنوان العملاء (البورتات)" },
      { id: "ports-suspend-free", label: "بورتات ALL_SUSPEND / FREE" },
      { id: "removed-ports", label: "الخطوط المرفوعة" },
      { id: "cabinet-capacity", label: "سعة الكباين (ابتدائى/ثانوى)" },
      { id: "slot-cards", label: "الكروت (شيلف/سلوت)" },
      { id: "cabinet-port-free", label: "الفاضى لكل نوع بورت" },
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
    label: "صيانة البوكسات",
    icon: Box,
    items: [
      { id: "maintenance-comprehensive", label: "تقرير الصيانة الشامل" },
      { id: "box-overlap", label: "مسافات التخاطي والتعارض" },
      { id: "maintenance-plan-h2", label: "خطة الصيانة (النصف الثانى)" },
    ],
  },
  {
    label: "تقارير أعطال الشبكات الأرضية",
    icon: AlertTriangle,
    items: [
      { id: "cfm-tickets", label: "تذاكر الأعطال" },
    ],
  },
  {
    // تقارير التفتيش — آخر تاب (تظهر للكل ما عدا الفنيين والمبيعات وأدمن المبيعات ومسئول البيانات)
    label: "تقارير التفتيش",
    icon: ClipboardList,
    items: [
      { id: "inspection-reports", label: "تقارير التفتيش (سنترال + كابينة)" },
    ],
  },
];

export default function Dashboard() {
  const { user: authUser, logout, isLoading: authLoading } = useAuth();
  // الأدمن الأعلى (super_admin) يرى واجهة الأدمن كاملة (وصول كامل) — نطبّعه لـ admin فى كل فحوص العرض،
  // ونحتفظ بـ isSuperAdmin للصلاحيات الإضافية (إدارة الأدمنز).
  const isSuperAdmin = authUser?.role === ROLES.SUPER_ADMIN;
  const user = authUser && isSuperAdmin ? { ...authUser, role: ROLES.ADMIN } : authUser;
  const { orders, isLoading: ordersLoading } = useOrders();
  const [, setLocation] = useLocation();
  const [adminTab, setAdminTab] = useState<AdminTab>("orders");
  const [reportTab, setReportTab] = useState<ReportTab>(authUser?.role === ROLES.SALES_ADMIN ? "om-current" : "current-faults");
  // مجموعات التقارير القابلة للطى — المجموعة التى تحوى التقرير النشط مفتوحة افتراضياً
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    const g = REPORT_GROUPS.find((grp) => grp.items.some((it) => it.id === "current-faults"));
    return g ? [g.label] : [];
  });
  // refs لكل مجموعة فى القائمة الجانبية — عشان لما نفتحها نعمل scroll تلقائى يظهر التقارير اللى جواها
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const willOpen = !prev.includes(label);
      if (willOpen) {
        requestAnimationFrame(() => {
          groupRefs.current[label]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
      return willOpen ? [...prev, label] : prev.filter((l) => l !== label);
    });

  // مجموعات التقارير المعروضة حسب الدور
  // مسئول البيانات: تقريرين من القياسات + أوامر الشغل + «بيان التليفونات» + «أرقام بدون موبايل»
  const DM_ALLOWED: ReportTab[] = ["no-account", "ground-network", "work-orders", "phone-lines", "lines-no-mobile"];
  const DM_ALLOWED_GROUPS = ["القياسات", "تركيبات و نقل و اوامر شغل", "الخطوط والبكسيات"];
  // الفني: 5 تقارير فقط (الأعطال الحالية + أداء الفنيين + إحصائيات الإزالة/التكرار + متوسط القياسات)
  // «التركيبات والنقل الحالى» و«المعاينات الحالية» بيظهروا للفنى كمان — والسيرفر
  // بيفلترهم على كباينه هو (worker_code) فكل واحد يشوف اللى يخصه بس.
  const TECH_ALLOWED: ReportTab[] = ["current-faults", "regularized-faults-range", "manual-current-faults", "tech-performance", "removal-stats", "repetition-stats", "repeated-within-month", "box-score-avg", "om-current", "with-account", "installations-by-tech", "shift-schedule", "current-installations", "current-surveys"];
  const TECH_ALLOWED_GROUPS = ["الأعطال", "القياسات", "متعذرات OM", "تركيبات و نقل و اوامر شغل", "المعاينات", "جدول الورديات"];
  // أدمن المبيعات: تقرير المتعذرات الحالية فقط (عشان يدخّل رقم المحمول)
  const SALES_ADMIN_ALLOWED: ReportTab[] = ["om-current"];
  const SALES_ADMIN_ALLOWED_GROUPS = ["متعذرات OM"];
  // تقارير للسوبر أدمن فقط رغم إنها جوّه مجموعات مشتركة (السيرفر بيرفضها كمان بـ 403)
  const SUPER_ONLY_REPORTS: ReportTab[] = ["lines-mobile-checked", "om-order-match"];
  const visibleGroups = REPORT_GROUPS
    .filter((g) =>
      (user?.role !== ROLES.DATA_MANAGER || DM_ALLOWED_GROUPS.includes(g.label)) &&
      (user?.role !== ROLES.TECH || TECH_ALLOWED_GROUPS.includes(g.label)) &&
      (user?.role !== ROLES.SALES_ADMIN || SALES_ADMIN_ALLOWED_GROUPS.includes(g.label)) &&
      // «معاملات التنفيذ» للسوبر أدمن فقط
      (g.label !== "معاملات التنفيذ" || isSuperAdmin),
    )
    .map((g) => {
      if (user?.role === ROLES.DATA_MANAGER) return { ...g, items: g.items.filter((it) => DM_ALLOWED.includes(it.id)) };
      if (user?.role === ROLES.TECH) return { ...g, items: g.items.filter((it) => TECH_ALLOWED.includes(it.id)) };
      if (user?.role === ROLES.SALES_ADMIN) return { ...g, items: g.items.filter((it) => SALES_ADMIN_ALLOWED.includes(it.id)) };
      return g;
    })
    // تقارير مقصورة على السوبر أدمن جوّه مجموعات عادية (مش مجموعة كاملة).
    // بيتفلتروا هنا بعد كل الأدوار عشان يتشالوا من الأدمن العادى كمان.
    .map((g) => (isSuperAdmin ? g : { ...g, items: g.items.filter((it) => !SUPER_ONLY_REPORTS.includes(it.id)) }));
  // حارس: لو التاب الحالى مش من ضمن المسموح لدور المستخدم، نرجّعه لأول تاب مسموح ونفتح
  // مجموعته. ضرورى لأن القيمة الافتراضية لـ reportTab بتتحسب عند **أول رندر بس**، وساعتها
  // بيانات المستخدم ممكن تكون لسه بتتحمّل — فأدمن المبيعات كان بيقع على «الأعطال الحالية»
  // ويفضل عليها رغم إن المسموح له «المتعذرات الحالية» بس. بيغطّى كل الأدوار مش بس دور واحد.
  useEffect(() => {
    if (authLoading || !user) return;
    const allowed = visibleGroups.flatMap((g) => g.items.map((it) => it.id));
    if (!allowed.length || allowed.includes(reportTab)) return;
    setReportTab(allowed[0]);
    const grp = visibleGroups.find((g) => g.items.some((it) => it.id === allowed[0]));
    if (grp) setOpenGroups([grp.label]);
  }, [authLoading, user, visibleGroups, reportTab]);

  // قائمة التقارير على الموبايل: مطوية افتراضياً، تُفتح بزر
  const [navOpen, setNavOpen] = useState(false);
  const displayReportLabel = (item: { id: ReportTab; label: string }) =>
    item.id === "regularized-faults-range" && user?.role === ROLES.TECH
      ? "الأعطال المنتظمة هذا الشهر"
      : item.label;
  const currentReportLabel =
    (() => {
      const item = REPORT_GROUPS.flatMap((g) => g.items).find((it) => it.id === reportTab);
      return item ? displayReportLabel(item) : "اختر التقرير";
    })();

  useWebSocket();
  // منع الكمبيوتر من النوم طالما الموقع مفتوح (مهم للتحديث التلقائى وجهاز التنفيذ)
  useWakeLock(true);

  // زر «معاينة» فى تقارير الأعطال خارج الشاشة → يفتح تاب «بحث برقم التليفون» (يقرأ الرقم من sessionStorage).
  useEffect(() => {
    const h = () => setAdminTab("phone-lookup");
    window.addEventListener("sf-open-phone-lookup", h);
    return () => window.removeEventListener("sf-open-phone-lookup", h);
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation("/login");
    } else if (!authLoading && user?.role === ROLES.MAINTENANCE_TECH) {
      // فنى الصيانة: مالوش تقارير فى الطلبات — نوجّهه فوراً لموقع الصيانة (SSO بيسجّله تلقائياً).
      window.location.href = "/maintenance";
    } else if (!authLoading && user?.role === ROLES.DATA_MANAGER) {
      setAdminTab("reports");
      setOpenGroups(["القياسات"]);
      setReportTab("no-account");
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

  // تصدير PDF لجدول الطلبات — نفس مصدر وأعمدة تصدير الإكسل (بدون الأعمدة الطويلة
  // اللى مابتتقراش فى صفحة مطبوعة زى الملاحظات وأسباب الرفض التفصيلية).
  const handleExportOrdersPDF = () => {
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
    printTablePDF({
      title: "تقرير الطلبات",
      columns: ["#", "التاريخ", "العميل", "الهاتف", "العنوان", "المندوب", "الحالة",
                "السبب", "حالة التعاقد", "السنترال", "الكابينه", "البوكس", "الفني"],
      rows: orders.map((o) => [
        o.id,
        format(new Date(o.createdAt), "yyyy-MM-dd HH:mm"),
        o.customerName ?? "",
        o.customerPhone ?? "",
        o.customerAddress ?? "",
        o.salesName ?? "",
        statusLabel(o.status),
        // سبب الرفض: رد الفنى، ولو الشئون الخارجية ردّت بسبب تانى بيتكتب جنبه
        [o.rejectionReason || "", o.externalRejectionReason && o.externalRejectionReason !== o.rejectionReason
          ? `(خارجية: ${o.externalRejectionReason})` : ""].filter(Boolean).join(" ") || "",
        o.contractStatus || "لم يتم التعاقد",
        o.centralName || "",
        o.cabinNumber || "",
        o.boxNumber || "",
        o.techName || "",
      ]),
    });
  };

  return (
    <div className="min-h-screen bg-gray-50/50" dir="rtl">
      {/* مؤقّت التحديث كل نص ساعة فى الخلفية (غير مرئى) — يشتغل على أى تاب.
          لازم يكون برّه شريط الهيدر القابل للتمرير (.nav-x-scroll) عشان الـ overflow
          مايقصّهوش على iOS Safari. */}
      <DailyAutoRefresh />
      {/* لوحة عائمة (fixed) تعرض ترتيب طلبات القياس/رفع السرعة/الإيقاف فى الطابور وتحدّثه.
          كانت جوّه .nav-x-scroll فـ iOS Safari بيقصّ الـ position:fixed → مكانتش بتظهر ع الموبايل.
          نقلناها برّه أى حاوية فيها overflow عشان تظهر على الموبايل والديسكتوب. */}
      <ExecQueueWatcher />
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

          <div className="flex items-center gap-1 sm:gap-2 min-w-0 nav-x-scroll [&>*]:shrink-0">
            {/* برنامج الكوابل المدمج (Cable-Fault-Manager) — قسم /cfm.
                يظهر فقط للأدوار اللى ليها وصول للكوابل (أدمن المبيعات/المبيعات/البيانات مالهمش) */}
            {canAccessCFM(authUser?.role ?? "") && (
              <a href="/cfm" className="inline-flex items-center gap-1 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 text-xs sm:text-sm h-8 sm:h-9 px-2 sm:px-3 font-medium">
                <span className="hidden sm:inline">برنامج الكوابل</span>
                <span className="sm:hidden">الكوابل</span>
              </a>
            )}
            {/* موقع الصيانة المدمج (smart-box-maintenance) — تطبيق مستقل تحت /maintenance
                (فتح صفحة كاملة، له تسجيل دخول خاص). نفس جمهور الكوابل. */}
            {canAccessMaint(authUser?.role ?? "") && (
              <a href="/maintenance" className="inline-flex items-center gap-1 rounded-md border border-teal-300 text-teal-700 hover:bg-teal-50 text-xs sm:text-sm h-8 sm:h-9 px-2 sm:px-3 font-medium">
                <span className="hidden sm:inline">موقع الصيانة</span>
                <span className="sm:hidden">الصيانة</span>
              </a>
            )}
            <ExecutorButton />
            {(user.role === ROLES.SALES || user.role === ROLES.ADMIN || user.role === ROLES.SALES_ADMIN) && <NotificationBell />}
            {(user.role === ROLES.TECH || user.role === ROLES.DATA_MANAGER || user.role === ROLES.ADMIN || user.role === ROLES.EXTERNAL) && (
              <Button variant="outline" size="sm" onClick={() => setLocation("/phone-lines")} className="text-xs sm:text-sm h-8 sm:h-9 px-2 sm:px-3">
                <span className="hidden sm:inline">إدارة البيانات الفنية</span>
                <span className="sm:hidden">البيانات</span>
              </Button>
            )}
            <ChangeMyPasswordButton />
            <Button variant="ghost" size="sm" onClick={() => logout()} className="text-muted-foreground hover:text-destructive h-8 sm:h-9 px-2 sm:px-3">
              <LogOut className="w-4 h-4 sm:ml-2" />
              <span className="hidden sm:inline">تسجيل خروج</span>
            </Button>
          </div>
        </div>

        {/* Tab Navigation — Admin, Tech, Data Manager, External & Sales Admin */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.TECH || user.role === ROLES.DATA_MANAGER || user.role === ROLES.EXTERNAL || user.role === ROLES.SALES_ADMIN) && (
          <div className="border-t bg-white">
            <div className="container mx-auto px-2 sm:px-4">
              <div className="flex nav-x-scroll" dir="rtl">
                <button
                  onClick={() => setAdminTab("orders")}
                  data-testid="tab-admin-orders"
                  className={`flex items-center gap-2 shrink-0 whitespace-nowrap px-3 sm:px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    adminTab === "orders"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ClipboardList className="w-4 h-4" />
                  الطلبات
                </button>
                {(user.role === ROLES.ADMIN || user.role === ROLES.DATA_MANAGER || user.role === ROLES.TECH || user.role === ROLES.EXTERNAL || user.role === ROLES.SALES_ADMIN) && (
                  <button
                    onClick={() => setAdminTab("reports")}
                    data-testid="tab-admin-reports"
                    className={`flex items-center gap-2 shrink-0 whitespace-nowrap px-3 sm:px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      adminTab === "reports"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    التقارير
                  </button>
                )}
                {(user.role === ROLES.ADMIN || user.role === ROLES.TECH || user.role === ROLES.EXTERNAL || user.role === ROLES.DATA_MANAGER) && (
                  <button
                    onClick={() => setAdminTab("phone-lookup")}
                    data-testid="tab-admin-phone-lookup"
                    className={`flex items-center gap-2 shrink-0 whitespace-nowrap px-3 sm:px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      adminTab === "phone-lookup"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Phone className="w-4 h-4" />
                    بحث برقم التليفون
                  </button>
                )}
                {(user.role === ROLES.ADMIN || user.role === ROLES.TECH || user.role === ROLES.EXTERNAL) && (
                  <button
                    onClick={() => setAdminTab("data-completion")}
                    data-testid="tab-admin-data-completion"
                    className={`flex items-center gap-2 shrink-0 whitespace-nowrap px-3 sm:px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      adminTab === "data-completion"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Cable className="w-4 h-4" />
                    استكمال بيانات
                  </button>
                )}
                {(user.role === ROLES.ADMIN || user.role === ROLES.DATA_MANAGER || user.role === ROLES.EXTERNAL) && (
                  <button
                    onClick={() => setAdminTab("file-upload")}
                    data-testid="tab-admin-file-upload"
                    className={`flex items-center gap-2 shrink-0 whitespace-nowrap px-3 sm:px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
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

        {/* ── REPORTS TAB (Admin, Data Manager, Tech, External & Sales Admin) ── */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.DATA_MANAGER || user.role === ROLES.TECH || user.role === ROLES.EXTERNAL || user.role === ROLES.SALES_ADMIN) && adminTab === "reports" && (
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
                    <div key={group.label} ref={(el) => { groupRefs.current[group.label] = el; }}>
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
                          {displayReportLabel(item)}
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
              {reportTab === "ports-missing-line-data" && <PortsMissingLineDataReport />}
              {reportTab === "box-summary"       && <BoxLinesSummaryReport />}
              {reportTab === "subscriber-info"   && <SubscriberInfoReport />}
              {reportTab === "slot-cards"          && <SlotCardsReport />}
              {reportTab === "cabinet-port-free"   && <CabinetPortFreeReport />}
              {reportTab === "removed-ports"       && <RemovedPortsReport />}
              {reportTab === "box-tickets-repaired" && <BoxFaultTicketsReport mode="repaired" />}
              {reportTab === "box-tickets-backfill" && isSuperAdmin && <BoxFaultTicketsReport mode="backfill" />}
              {reportTab === "ports-suspend-free" && <PortsSuspendFreeReport />}
              {reportTab === "maintenance-comprehensive" && <MaintenanceComprehensiveReport />}
              {reportTab === "box-full"          && <BoxFullRejectionsReport orders={orders || []} />}
              {reportTab === "box-broken"        && <BoxBrokenRejectionsReport orders={orders || []} />}
              {reportTab === "work-orders"       && <WorkOrdersReport />}
              {reportTab === "work-orders-fail"  && <WorkOrdersReport category="fail" showUpload={false} title="أوامر الشغل الفاشلة (Fail)" />}
              {reportTab === "work-orders-no-cable" && <WorkOrdersNoCableReport />}
              {reportTab === "installations-by-tech" && <InstallationsByTechReport />}
              {reportTab === "box-overlap"       && <BoxOverlapReport />}
              {reportTab === "maintenance-plan-h2" && <MaintenancePlanH2Report />}
              {reportTab === "cabinet-capacity"  && <CabinetCapacityReport />}
              {reportTab === "current-faults"    && <CurrentFaultsReport />}
              {reportTab === "major-faults"      && <MajorFaultsReport />}
              {reportTab === "closed-port-cabinets" && <ClosedPortCabinetsReport />}
              {reportTab === "inspection-reports" && <InspectionReports />}
              {reportTab === "shift-schedule" && <ShiftScheduleReport />}
              {reportTab === "port-change"       && <PortChangeReport />}
              {reportTab === "regularized-faults" && <RegularizedFaultsReport />}
              {reportTab === "regularized-faults-range" && <RegularizedFaultsRangeReport />}
              {reportTab === "repeated-within-month" && <RepeatedWithinMonthReport />}
              {reportTab === "current-installations" && (
                <InstallationsReport
                  endpoint="/api/reports/current-installations"
                  queryKey="/api/reports/current-installations"
                  title="تقرير التركيبات والنقل الحالى"
                  sheetName="التركيبات الحالية"
                  fileName="current-installations"
                  updateBadge={{ endpoint: "/api/maintenance-orders/import", label: "آخر تحديث WFM" }}
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
                  updateBadge={{ endpoint: "/api/maintenance-orders/import", label: "آخر تحديث WFM" }}
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
              {reportTab === "om-order-match" && isSuperAdmin && <OmOrderMatchReport />}
              {reportTab === "om-soy"      && <OmRejectionsReport bucket="soy"      title="متعذرات بداية السنة (OM)" />}
              {reportTab === "om-resolved" && <OmRejectionsReport bucket="resolved" title="متعذرات تم فكها (OM)" />}
              {reportTab === "om-stats"    && <OmStatsReport />}
              {reportTab === "om-stats-2026"  && <OmStatsReport yearFilter="current" title="إحصائية متعذرات OM — 2026" />}
              {reportTab === "om-stats-prior" && <OmStatsReport yearFilter="prior"   title="إحصائية متعذرات OM — أعوام سابقة" />}
              {reportTab === "with-account"        && <WithAccountReport defaultStaleDays="10" />}
              {reportTab === "account-never-measured" && <WithAccountReport neverMeasured title="خطوط لها رقم أكونت ولم يتم قياسها من قبل" />}
              {reportTab === "high-score"          && <WithAccountReport scoreGt={100} title="الخطوط التى أسكورها أعلى من 100" />}
              {reportTab === "no-account"          && <NoAccountTab />}
              {reportTab === "ground-network" && <GroundNetworkFaultsTab />}
              {reportTab === "needs-speed"            && <NeedsSpeedTab />}
              {reportTab === "needs-speed-lowscore" && <NeedsSpeedReport endpoint="/api/phone-lines/needs-speed-lowscore" title="اسكور منخفض وسرعة عالية — محتاجة رفع سرعة ومش ظاهرة فى التقرير الحالى" />}
              {reportTab === "needs-po-stop"          && <NeedsSpeedReport endpoint="/api/phone-lines/needs-po-stop" title="أرقام تحتاج إيقاف PO (لا تحتاج رفع سرعة + قِيست خلال 3 أيام)" />}
              {reportTab === "complaint-no-measure"   && <ComplaintNoMeasureReport />}
              {reportTab === "box-score-avg"       && <BoxScoreReport />}
              {reportTab === "phone-lookup"        && <PhoneLookupReport />}
              {reportTab === "account-edits"       && <AccountEditsReport />}
              {reportTab === "duplicate-accounts"  && <DuplicateAccountsReport />}
              {reportTab === "lines-without-port"  && <LinesWithoutPortReport />}
              {reportTab === "lines-no-mobile"     && <LinesNoMobileReport />}
              {reportTab === "lines-mobile-checked" && isSuperAdmin && <LinesNoMobileReport checked />}
              {reportTab === "cfm-tickets"         && <CfmTicketsReport />}
              {reportTab === "manual-current-faults"   && <ManualCurrentFaultsReport />}
              {reportTab === "engineering-inspection"  && <EngineeringInspectionReport />}
              {reportTab === "manual-regularized-range" && <ManualRegularizedFaultsRangeReport />}
              {reportTab === "exec-jobs"           && isSuperAdmin && <ExecJobsReport />}
              {reportTab === "queue-reorder"       && isSuperAdmin && <QueueReorderPanel />}
              {reportTab === "exec-batches"        && isSuperAdmin && <ExecBatchesReport />}
            </div>
          </div>
        )}

        {/* ── PHONE LOOKUP TAB (Admin, Tech & External) ── */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.TECH || user.role === ROLES.EXTERNAL || user.role === ROLES.DATA_MANAGER) && adminTab === "phone-lookup" && (
          <div className="space-y-6" dir="rtl">
            <PhoneLookupReport />
          </div>
        )}

        {/* ── DATA COMPLETION TAB (Admin, Tech & External) ── */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.TECH || user.role === ROLES.EXTERNAL) && adminTab === "data-completion" && (
          <div className="space-y-6">
            <DataCompletionSection />
          </div>
        )}

        {/* ── FILE UPLOAD TAB (Admin, Data Manager & External — external sees the upload cards only, not the super-admin control toolbar) ── */}
        {(user.role === ROLES.ADMIN || user.role === ROLES.DATA_MANAGER || user.role === ROLES.EXTERNAL) && adminTab === "file-upload" && (
          <div className="space-y-6">
            <FileUploadSection />
          </div>
        )}

        {/* ── ORDERS TAB (all roles) ── */}
        {((user.role !== ROLES.ADMIN && user.role !== ROLES.TECH && user.role !== ROLES.EXTERNAL && user.role !== ROLES.SALES_ADMIN) || adminTab === "orders") && (
          <>
            {/* Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <div className="flex items-center gap-2">
                {(user.role === ROLES.SALES || user.role === ROLES.SALES_ADMIN) && <CreateOrderModal />}
                {isSuperAdmin ? (
                  // السوبر أدمن: بوابة موحّدة تدير مستخدمى الطلبات والكوابل معاً
                  <UnifiedUsersManager />
                ) : (user.role === ROLES.ADMIN || user.role === ROLES.SALES_ADMIN) && (
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
              {user.role !== ROLES.EXTERNAL && (
                <Button variant="outline" onClick={handleExportOrdersPDF} className="bg-white">
                  <Printer className="w-4 h-4 ml-2 text-red-600" />
                  تصدير PDF
                </Button>
              )}
            </div>

            {/* Stats Cards */}
            {user.role === ROLES.EXTERNAL ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-white p-6 rounded-xl border shadow-sm">
                  <div className="text-sm text-muted-foreground mb-1">الطلبات المحولة إليك</div>
                  <div className="text-2xl font-bold font-display text-yellow-600">
                    {orders?.filter(o => o.status === ORDER_STATUS.NEEDS_EXTERNAL || o.status === ORDER_STATUS.EXTERNAL_FEASIBLE || o.status === ORDER_STATUS.EXTERNAL_NOT_FEASIBLE).length || 0}
                  </div>
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

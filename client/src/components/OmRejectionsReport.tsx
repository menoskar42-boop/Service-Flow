import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer, UserPlus, Pencil, X } from "lucide-react";
import { LastUpdatedBadge } from "@/components/LastUpdatedBadge";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ROLES, REJECTION_REASONS } from "@shared/schema";
import { TechActionModal } from "@/components/TechActionModal";

interface Row {
  id: number;
  serviceOrderId: string | null;
  customerOrderId: string | null;
  serialNumber: string | null;
  customerName: string | null;
  orderStatus: string | null;
  orderCreateTime: string | null;
  msanCode: string | null;
  errorName: string | null;
  currentActivity: string | null;
  customerMobile: string | null;
  manualMobile: string | null;
  fccExchange: string | null;
  techName: string | null;
  techManual: boolean | null;
  address: string | null;
  // رد الفنى على المتعذر (om_responses) — نفس دورة الطلبات
  respStatus: string | null;
  respRejectionReason: string | null;
  respCentralName: string | null;
  respCabinNumber: string | null;
  respBoxNumber: string | null;
  respNearestBoxDistance: string | null;
  respAdditionalNotes: string | null;
  respTechName: string | null;
  respRespondedAt: string | null;
  respExternalName: string | null;
  respIsFeasibleExternal: boolean | null;
  respExternalRejectionReason: string | null;
  respExternalResponseAt: string | null;
  /** عدد الخطوط الشغّالة على البكس اللى الفنى كتبه (الشغّال = ليه بورت) */
  boxWorkingCount: number | null;
}

// نص حالة رد الفنى على المتعذر (نفس مسمّيات قسم الطلبات)
const RESP_LABEL: Record<string, string> = {
  pending: "قيد الانتظار",
  feasible: "يمكن التنفيذ",
  not_feasible: "لا يمكن التنفيذ",
  needs_external: "يحتاج رد الشئون الخارجية",
  external_feasible: "يمكن التنفيذ (شئون خارجية)",
  external_not_feasible: "لا يمكن التنفيذ (شئون خارجية)",
};
const RESP_CLASS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  feasible: "bg-green-100 text-green-700",
  not_feasible: "bg-red-100 text-red-700",
  needs_external: "bg-yellow-100 text-yellow-800",
  external_feasible: "bg-teal-100 text-teal-700",
  external_not_feasible: "bg-red-100 text-red-700",
};

// الوقت مخزَّن كـ UTC (توقيت الملف) — يُعرض كما هو دون إزاحة المتصفح.
const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

type YearFilter = "all" | "current" | "previous";

export function OmRejectionsReport({ bucket, title }: { bucket: "current" | "soy" | "resolved"; title: string }) {
  const [q, setQ] = useState("");
  // «المتعذرات الحالية» بتفتح على متعذرات العام الحالى (المعتاد فى المتابعة اليومية)،
  // والمستخدم يقدر يغيّرها لـ«الكل» أو «سنوات سابقة» عادى. باقى التابات (بداية السنة /
  // تم فكها) بتفضل «الكل» لأنها تاريخية بطبيعتها وتقييدها بالسنة هيخفى بيانات.
  const [yearFilter, setYearFilter] = useState<YearFilter>(bucket === "current" ? "current" : "all");
  const [msanFilter, setMsanFilter] = useState("");
  const [fccFilter, setFccFilter] = useState("");
  const [techFilter, setTechFilter] = useState("");
  // فلتر رد الفنى: الكل | قيد الانتظار | يمكن التنفيذ | سبب تعذر محدد
  const [respFilter, setRespFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  // فلتر اسم الفنى + إسناد الفنى: للسوبر أدمن + الأدمن (ومنه مدير السنترال) + الشئون الخارجية (ومنها مهندس الكوابل)
  const isAdmin = user?.role === ROLES.ADMIN || user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.EXTERNAL;
  // إدخال رقم محمول يدوى للمتعذرات الحالية (للأرقام المشفّرة بنجوم): سوبر أدمن + أدمن (ومدير
  // السنترال) + الشئون الخارجية (ومهندس الكوابل) + أدمن المبيعات.
  const canEditMobile = bucket === "current" &&
    ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EXTERNAL, ROLES.SALES_ADMIN] as string[]).includes(user?.role ?? "");
  const [editSerial, setEditSerial] = useState<string | null>(null);
  const [mobileInput, setMobileInput] = useState("");
  const [savingMobile, setSavingMobile] = useState(false);
  const saveMobile = async (serial: string) => {
    setSavingMobile(true);
    try {
      await apiRequest("POST", "/api/om-rejections/mobile", { serialNumber: serial, mobile: mobileInput.trim() });
      setEditSerial(null);
      qc.invalidateQueries({ queryKey: ["/api/ftth-orders"] });
      toast({ title: "تم حفظ رقم المحمول" });
    } catch { toast({ title: "تعذّر حفظ رقم المحمول", variant: "destructive" }); }
    finally { setSavingMobile(false); }
  };
  // ── رد الفنى على المتعذر (نفس دورة الطلبات) ──
  // الفنى (وكذلك الأدمن/السوبر أدمن) يسجّل «يمكن التنفيذ» أو «لا يمكن + سبب» بنفس نافذة الطلبات؛
  // السوبر أدمن يقدر يحوّل المتعذر للشئون الخارجية للفحص، والشئون الخارجية بترد.
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const isExternal = user?.role === ROLES.EXTERNAL;
  const canRespond = bucket === "current" &&
    ([ROLES.TECH, ROLES.ADMIN, ROLES.SUPER_ADMIN] as string[]).includes(user?.role ?? "");
  const canResetResp = bucket === "current" &&
    ([ROLES.ADMIN, ROLES.SUPER_ADMIN] as string[]).includes(user?.role ?? "");
  const [respBusy, setRespBusy] = useState<string | null>(null);

  const postResp = async (path: string, body: any, okMsg: string, done?: () => void) => {
    setRespBusy(String(body.serialNumber));
    try {
      await apiRequest("POST", path, body);
      qc.invalidateQueries({ queryKey: ["/api/ftth-orders"] });
      toast({ title: okMsg });
      done?.();
    } catch (e: any) {
      toast({ title: e?.message || "تعذّر الحفظ", variant: "destructive" });
    } finally { setRespBusy(null); }
  };

  const renderRespStatusCell = (r: Row) => {
    const st = r.respStatus || "pending";
    const detail =
      st === "not_feasible" ? r.respRejectionReason
      : st === "external_not_feasible" ? r.respExternalRejectionReason
      : null;
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className={`px-2 py-0.5 rounded font-semibold ${RESP_CLASS[st] ?? RESP_CLASS.pending}`}>
          {RESP_LABEL[st] ?? st}
        </span>
        {detail && <span className="text-[11px] text-muted-foreground">{detail}</span>}
        {/* الكابينة والبكس اللى الفنى كتبهم فى رده — كانوا بيتخزّنوا ومابيظهروش */}
        {(r.respCabinNumber || r.respBoxNumber) && (
          <span className="text-[11px] text-muted-foreground">
            {r.respCabinNumber ? `كابينة ${r.respCabinNumber}` : ""}
            {r.respCabinNumber && r.respBoxNumber ? " — " : ""}
            {r.respBoxNumber ? `بكس ${r.respBoxNumber}` : ""}
          </span>
        )}
        {r.respNearestBoxDistance && (
          <span className="text-[11px] text-muted-foreground">أقرب بكس: {r.respNearestBoxDistance}</span>
        )}
        {r.respTechName && <span className="text-[11px] text-muted-foreground">الفنى: {r.respTechName}</span>}
        {r.respExternalName && <span className="text-[11px] text-muted-foreground">خارجية: {r.respExternalName}</span>}
      </span>
    );
  };

  const renderRespActionsCell = (r: Row) => {
    const serial = r.serialNumber;
    if (!serial) return <span className="text-muted-foreground">—</span>;
    const st = r.respStatus || "pending";
    const busy = respBusy === serial;
    const submit = (values: any, done: () => void) =>
      postResp("/api/om-rejections/response", { serialNumber: serial, ...values }, "تم تسجيل الرد", done);

    return (
      <div className="flex flex-wrap items-center gap-1">
        {canRespond && (
          <>
            <TechActionModal action="feasible" onSubmit={submit} submitting={busy} />
            <TechActionModal action="not_feasible" onSubmit={submit} submitting={busy} />
          </>
        )}
        {/* تحويل للشئون الخارجية للفحص — سوبر أدمن، بعد ما الفنى يقول «لا يمكن» */}
        {isSuperAdmin && st === "not_feasible" && (
          <Button variant="outline" size="sm" disabled={busy}
            className="text-yellow-600 border-yellow-300 hover:bg-yellow-50"
            onClick={() => postResp("/api/om-rejections/request-external", { serialNumber: serial }, "تم التحويل للشئون الخارجية")}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تحويل للشئون الخارجية"}
          </Button>
        )}
        {/* رد الشئون الخارجية */}
        {(isExternal || isSuperAdmin) && st === "needs_external" && (
          <>
            <Button variant="outline" size="sm" disabled={busy}
              className="text-green-700 border-green-300 hover:bg-green-50"
              onClick={() => postResp("/api/om-rejections/external-response", { serialNumber: serial, isFeasible: true }, "تم تسجيل رد الشئون الخارجية")}>
              يمكن (خارجية)
            </Button>
            <Button variant="outline" size="sm" disabled={busy}
              className="text-red-700 border-red-300 hover:bg-red-50"
              onClick={() => {
                const reason = window.prompt("سبب عدم الإمكانية (شئون خارجية):", "");
                if (reason && reason.trim()) {
                  postResp("/api/om-rejections/external-response",
                    { serialNumber: serial, isFeasible: false, rejectionReason: reason.trim() },
                    "تم تسجيل رد الشئون الخارجية");
                }
              }}>
              لا يمكن (خارجية)
            </Button>
          </>
        )}
        {/* إلغاء الرد ورجوعه قيد الانتظار */}
        {canResetResp && st !== "pending" && (
          <Button variant="outline" size="sm" disabled={busy} title="إلغاء الرد"
            className="text-orange-600 border-orange-300 hover:bg-orange-50"
            onClick={() => postResp("/api/om-rejections/reset-response", { serialNumber: serial }, "تم إلغاء الرد")}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    );
  };

  const renderMobileCell = (r: Row) => {
    if (!canEditMobile || !r.serialNumber) return r.customerMobile || "-";
    const masked = !r.customerMobile || /[*]/.test(String(r.customerMobile));
    if (editSerial === r.serialNumber) {
      return (
        <span className="inline-flex items-center gap-1">
          <input value={mobileInput} onChange={(e) => setMobileInput(e.target.value)} placeholder="01xxxxxxxxx"
            className="border rounded px-2 py-0.5 text-sm w-32" dir="ltr" autoFocus />
          <button onClick={() => saveMobile(r.serialNumber!)} disabled={savingMobile}
            className="text-[11px] text-white bg-emerald-600 hover:bg-emerald-700 rounded px-2 py-0.5 disabled:opacity-50">
            {savingMobile ? "..." : "حفظ"}
          </button>
          <button onClick={() => setEditSerial(null)} className="text-[11px] text-gray-500 px-1">إلغاء</button>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2">
        <span className={masked && !r.manualMobile ? "text-orange-600" : ""} dir="ltr">{r.customerMobile || "-"}</span>
        <button onClick={() => { setMobileInput(r.manualMobile || ""); setEditSerial(r.serialNumber!); }}
          className="text-[11px] text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-50">
          {r.manualMobile ? "تعديل" : "＋ إضافة"}
        </button>
      </span>
    );
  };

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/ftth-orders", bucket, q, yearFilter, msanFilter, fccFilter, techFilter, dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams({ bucket });
      if (q.trim()) p.set("q", q.trim());
      if (yearFilter !== "all") p.set("yearFilter", yearFilter);
      if (msanFilter.trim()) p.set("msanFilter", msanFilter.trim());
      if (fccFilter.trim()) p.set("fccFilter", fccFilter.trim());
      if (techFilter.trim()) p.set("techFilter", techFilter.trim());
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/ftth-orders?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  // قائمة أكواد الكباين المميزة للدروب ليست (مستقلة عن فلتر الكابينه نفسه)
  const { data: msanCodes = [] } = useQuery<string[]>({
    queryKey: ["/api/ftth-orders/msan-codes", bucket, fccFilter],
    queryFn: async () => {
      const p = new URLSearchParams({ bucket });
      if (fccFilter.trim()) p.set("fccFilter", fccFilter.trim());
      const res = await fetch(`/api/ftth-orders/msan-codes?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل تحميل أكواد الكباين");
      return res.json();
    },
  });

  // إسناد فنى يدوى لكود كابينه غير معروف (أدمن) — نفس أسلوب تجاوزات ٢٤ ساعة
  const [assigningCode, setAssigningCode] = useState<string | null>(null);
  const { data: techList = [] } = useQuery<{ workerCode: string; techName: string }[]>({
    queryKey: ["/api/technician-names"],
    queryFn: async () => {
      const res = await fetch("/api/technician-names", { credentials: "include" });
      if (!res.ok) throw new Error("فشل");
      return res.json();
    },
    enabled: isAdmin,
  });
  const techNames = Array.from(new Set(techList.map((t) => t.techName).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ar"));

  // فلتر السنة client-side — يضمن الصحة بغض النظر عن الـ DB timezone
  const displayRows = useMemo(() => {
    const nowYear = new Date().getFullYear();
    return rows.filter((r) => {
      // فلتر السنة
      if (yearFilter !== "all") {
        if (!r.orderCreateTime) { if (yearFilter !== "previous") return false; }
        else {
          const yr = new Date(r.orderCreateTime).getFullYear();
          if (yearFilter === "current" ? yr !== nowYear : yr >= nowYear) return false;
        }
      }
      // فلتر رد الفنى / سبب التعذر
      if (respFilter) {
        const st = r.respStatus || "pending";
        if (respFilter === "pending") return st === "pending";
        // «يمكن التنفيذ» تشمل رد الفنى ورد الشئون الخارجية
        if (respFilter === "feasible") return st === "feasible" || st === "external_feasible";
        // غير كده: سبب تعذر محدد (من الفنى أو من الشئون الخارجية)
        return r.respRejectionReason === respFilter || r.respExternalRejectionReason === respFilter;
      }
      return true;
    });
  }, [rows, yearFilter, respFilter]);

  const assignTech = async (msanCode: string, techName: string) => {
    try {
      await apiRequest("POST", "/api/msan-tech", { msanCode, techName });
      setAssigningCode(null);
      qc.invalidateQueries({ queryKey: ["/api/ftth-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/reports/om-stats"] });
      toast({ title: "تم إسناد الفنى", description: `${techName} — كابينه ${msanCode}`, duration: 3500 });
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذّر الحفظ", variant: "destructive", duration: 5000 });
    }
  };

  const removeTech = async (msanCode: string) => {
    try {
      await apiRequest("DELETE", `/api/msan-tech/${encodeURIComponent(msanCode)}`);
      qc.invalidateQueries({ queryKey: ["/api/ftth-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/reports/om-stats"] });
      toast({ title: "تم إلغاء الإسناد", description: `كابينه ${msanCode}`, duration: 3000 });
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذّر الحذف", variant: "destructive", duration: 5000 });
    }
  };

  // خلية اسم الفنى مع إمكانية الإسناد اليدوى للأدمن عند "غير معروف"
  const renderTechCell = (r: Row) => {
    const code = String(r.msanCode ?? "").trim();
    const unknown = !r.techName || r.techName === "غير معروف";
    if (isAdmin && assigningCode === code && code) {
      return (
        <div className="flex items-center gap-1">
          <select
            autoFocus defaultValue=""
            onChange={(e) => { if (e.target.value) assignTech(code, e.target.value); }}
            className="border rounded text-xs px-1 py-1 max-w-[150px] bg-white"
          >
            <option value="" disabled>اختر الفنى…</option>
            {techNames.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={() => setAssigningCode(null)} className="text-gray-400 hover:text-gray-600" title="إلغاء">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <span className={r.techManual ? "text-blue-700 font-semibold" : unknown ? "text-muted-foreground" : ""}>
          {r.techName ?? "غير معروف"}
        </span>
        {isAdmin && code && (unknown || r.techManual) && (
          <button onClick={() => setAssigningCode(code)} className="text-blue-600 hover:text-blue-800"
            title={r.techManual ? "تعديل الفنى" : "إسناد فنى"}>
            {r.techManual ? <Pencil className="w-3.5 h-3.5" /> : <UserPlus className="w-4 h-4" />}
          </button>
        )}
        {isAdmin && r.techManual && code && (
          <button onClick={() => removeTech(code)} className="text-red-500 hover:text-red-700" title="إلغاء الإسناد اليدوى">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  };

  // ترتيب الأعمدة: البيانات اللى بيتقرا بيها الصف الأول (المسلسل → العميل → عنوانه →
  // التاريخ → أرقام الأوردر)، وبعدها البيانات الفنية، و«الحالة» و«النشاط الحالى» فى
  // الآخر (بيتقروا لما يحتاجهم). «إجراء» بيفضل آخر عمود لأنه أزرار مش بيانات.
  const cols: [string, (r: Row) => any][] = [
    ["المسلسل", (r) => r.serialNumber],
    ["اسم العميل", (r) => r.customerName],
    ["عنوان العميل", (r) => r.address],
    ["تاريخ الإنشاء", (r) => fmtDt(r.orderCreateTime)],
    ["Service Order ID", (r) => r.serviceOrderId],
    ["Customer Order ID", (r) => r.customerOrderId],
    ["كود MSAN", (r) => r.msanCode],
    ["FCC", (r) => r.fccExchange],
    ["اسم الفنى", (r) => r.techName],
    ["سبب التعذر", (r) => r.errorName],
    ["الموبايل", (r) => r.customerMobile],
    // رد الفنى وسبب التعذر — للمتعذرات الحالية، وبيظهروا **لكل** من يفتح التقرير
    // (ومنهم أدمن المبيعات) لأنهم معلومة، مش إجراء.
    ...(bucket === "current"
      ? ([
          ["رد الفنى", (r: Row) => RESP_LABEL[r.respStatus || "pending"] ?? "-"],
          ["سبب التعذر (الفنى)", (r: Row) => r.respRejectionReason ?? r.respExternalRejectionReason ?? "-"],
          // عدد الشغّال على البكس اللى الفنى كتبه — الشغّال = الخط اللى ليه بورت (فريم)،
          // وأى خط من غير بورت مابيتحسبش.
          ["الشغال على البكس", (r: Row) => (r.boxWorkingCount == null ? "-" : r.boxWorkingCount)],
        ] as [string, (r: Row) => any][])
      : []),
    // «الحالة» و«النشاط الحالى» متخفيين بطلب المستخدم — البيانات لسه موجودة فى الصف
    // (r.orderStatus / r.currentActivity)، فرجوعهم = شيل التعليق من السطرين دول.
    // ["الحالة", (r) => r.orderStatus],
    // ["النشاط الحالى", (r) => r.currentActivity],
    // عمود «إجراء» بيظهر بس لمين يقدر يعمل حاجة فعلاً — أدمن المبيعات مثلاً بيشوف
    // الأسباب من غير عمود فاضى.
    ...(bucket === "current" && (canRespond || canResetResp || isSuperAdmin || isExternal)
      ? ([["إجراء", () => ""]] as [string, (r: Row) => any][])
      : []),
  ];

  const handleExportExcel = () => {
    const data = displayRows.map((r, i) => {
      const o: Record<string, any> = { "#": i + 1 };
      cols.forEach(([h, f]) => { o[h] = f(r) ?? ""; });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "متعذرات");
    XLSX.writeFile(wb, `om-${bucket}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportPDF = () => {
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 20;
    const total = Math.max(1, Math.ceil(displayRows.length / ROWS_PER_PAGE));
    const head = `<th>#</th>` + cols.map(([h]) => `<th>${esc(h)}</th>`).join("");
    let pages = "";
    for (let pg = 0; pg < total; pg++) {
      const chunk = displayRows.slice(pg * ROWS_PER_PAGE, (pg + 1) * ROWS_PER_PAGE);
      const body = chunk.map((r, ci) =>
        `<tr><td>${pg * ROWS_PER_PAGE + ci + 1}</td>` + cols.map(([, f]) => `<td>${esc(f(r))}</td>`).join("") + `</tr>`,
      ).join("");
      pages += `
        <section class="page">
          <h2>${esc(title)} — ${displayRows.length} متعذر</h2>
          <div class="pageno">صفحة ${pg + 1} من ${total}</div>
          <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 10px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 14px; margin: 0 0 4px; }
        .pageno { text-align: center; font-size: 10px; color: #64748b; margin-bottom: 8px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 6px 3px; border: 1px solid #15407f; font-size: 10px; }
        td { border: 1px solid #ccc; padding: 4px 3px; text-align: center; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        .page { background: #fff; padding: 12px; margin: 10px auto; max-width: 1100px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; display: flex; gap: 10px; align-items: center; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
        @media print { body { background: #fff; } .toolbar { display: none; } .page { box-shadow: none; margin: 0; max-width: none; page-break-after: always; } @page { size: A4 landscape; margin: 8mm; } }
      </style></head><body>
      <div class="toolbar"><button onclick="window.print()">🖸️ طباعة / حفظ PDF</button>
        <span>اختر "حفظ بصيغة PDF" كوجهة الطباعة.</span></div>
      ${pages}</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold w-full sm:w-auto">{title}</h2>
          <Input
            placeholder="بحث بالمسلسل / Order ID / العميل / MSAN"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:w-56 text-sm"
            dir="rtl"
          />
          <div className="w-full sm:w-44">
            <SearchableCombobox
              options={msanCodes}
              value={msanFilter}
              onChange={setMsanFilter}
              placeholder="كود الكابينه (MSAN)"
              searchPlaceholder="ابحث بكود الكابينه..."
              emptyText="لا توجد أكواد"
              className="h-9 text-sm"
            />
          </div>
          <select
            value={fccFilter}
            onChange={(e) => setFccFilter(e.target.value)}
            className="border rounded-md text-sm px-2 py-2 bg-white"
            title="فلتر حسب كود السنترال"
          >
            <option value="">كل السنترالات</option>
            <option value="GHNAT">GHNAT</option>
            <option value="AMZAT">AMZAT</option>
            <option value="DRGAT">DRGAT</option>
            <option value="NGOAT">NGOAT</option>
          </select>
          {isAdmin && (
            <div className="w-full sm:w-44">
              <SearchableCombobox
                options={[...techNames, "غير معروف"]}
                value={techFilter}
                onChange={setTechFilter}
                placeholder="كل الفنيين"
                searchPlaceholder="ابحث باسم الفنى..."
                emptyText="لا يوجد فنيون"
                className="h-9 text-sm"
              />
            </div>
          )}
          {bucket === "current" && (
            <select
              value={respFilter}
              onChange={(e) => setRespFilter(e.target.value)}
              className="border rounded-md text-sm px-2 py-2 bg-white"
              title="فلتر حسب رد الفنى / سبب التعذر"
            >
              <option value="">كل الحالات</option>
              <option value="pending">قيد الانتظار</option>
              <option value="feasible">يمكن التنفيذ</option>
              {Object.values(REJECTION_REASONS).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value as YearFilter)}
            className="border rounded-md text-sm px-2 py-2 bg-white"
            title="فلتر حسب سنة إنشاء الطلب"
          >
            <option value="all">الكل</option>
            <option value="current">متعذرات العام</option>
            <option value="previous">متعذرات سنوات سابقة</option>
          </select>
          <label className="text-xs text-muted-foreground whitespace-nowrap">من:</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded-md text-sm px-2 py-1.5 bg-white" />
          <label className="text-xs text-muted-foreground whitespace-nowrap">إلى:</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border rounded-md text-sm px-2 py-1.5 bg-white" />
          {(msanFilter || fccFilter || techFilter || respFilter || dateFrom || dateTo) && (
            <button
              onClick={() => { setMsanFilter(""); setFccFilter(""); setTechFilter(""); setRespFilter(""); setDateFrom(""); setDateTo(""); }}
              className="text-xs text-red-500 hover:text-red-700 underline whitespace-nowrap"
            >مسح الفلاتر</button>
          )}
          <div className="flex-1" />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <span className="text-sm text-muted-foreground">إجمالي: <strong className="text-foreground">{displayRows.length}</strong> متعذر</span>
          <LastUpdatedBadge endpoint="/api/ftth-orders/import" label="آخر تحديث OSS" />
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={displayRows.length === 0} className="text-green-700 border-green-200 gap-1">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={displayRows.length === 0} className="text-red-700 border-red-200 gap-1">
            <Printer className="w-4 h-4" /> PDF
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-xs" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-10">#</TableHead>
                {cols.map(([h]) => (
                  <TableHead key={h}
                    className={`text-right font-bold ${h === "عنوان العميل" ? "max-w-[260px] min-w-[180px]" : "whitespace-nowrap"}`}>
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={cols.length + 1} className="text-center py-14 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد بيانات — تأكد من رفع ملفات متعذرات OM (الحالى + بداية السنة)"}
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((r, idx) => (
                  <TableRow key={r.id ?? idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    {cols.map(([h, f]) => (
                      // العنوان بيبقى طويل جداً — بنحدّد عرضه ونخلّيه يلتفّ على أكتر من
                      // سطر بدل ما يمدّ الجدول ويخفى باقى الأعمدة. باقى الأعمدة سطر واحد.
                      <TableCell key={h}
                        className={h === "عنوان العميل"
                          ? "whitespace-normal break-words align-top max-w-[260px] min-w-[180px] leading-5"
                          : "whitespace-nowrap"}>
                        {h === "اسم الفنى" ? renderTechCell(r)
                          : h === "الموبايل" ? renderMobileCell(r)
                          : h === "رد الفنى" ? renderRespStatusCell(r)
                          : h === "إجراء" ? renderRespActionsCell(r)
                          : (f(r) ?? "-")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

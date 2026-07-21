import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, FileSpreadsheet, Printer, Clock, UserPlus, Pencil, X } from "lucide-react";
import { format } from "date-fns";
import { closeReason } from "@/lib/close-codes";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ROLES } from "@shared/schema";

interface StatRow {
  centralName: string | null;
  techName: string | null;
  total: number;
  within24h: number;
  within48h: number;
  within120h: number;
  pct24h: number;
  pct48h: number;
  pct120h: number;
}

interface DiagInfo {
  total_all: string;
  total_closed: string;
  min_complain: string | null;
  max_complain: string | null;
  centrals: string[];
}

interface Beyond24Row {
  complainNo: string;
  phoneNumber: string;
  centralName: string;
  cabinetNo: string;
  complainTime: string;
  closeTime: string;
  closeCode: string | null;
  hours: number;
  closeByName: string;
  closeByManual?: boolean;
  areaTechName: string;
  lineCabin: string | null;
  lineBox: string | null;
  msanCode: string | null;
  frame: string | null;
  subName: string | null;
  subAdd: string | null;
}

interface StatsData {
  overall: StatRow | null;
  byCentral: StatRow[];
  byTech: StatRow[];
  byTechOnly: StatRow[];
  _diag?: DiagInfo;
}

// النِسب المستهدفة لكل نافذة زمنية
const TARGET_24 = 90, TARGET_48 = 95, TARGET_120 = 100;

// تلوين النسبة حسب المستهدف: أخضر إذا حقق المستهدف، بينك إذا قريب منه، أحمر إذا بعيد
const pctBadge = (pct: number, target: number) => {
  const cls =
    pct >= target        ? "bg-green-100 text-green-800" :
    pct >= target - 10   ? "bg-pink-100 text-pink-700" :
                           "bg-red-100 text-red-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{pct}%</span>;
};

export function RemovalStatsReport() {
  const today      = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo,   setDateTo]   = useState(today);
  const [activeTab, setActiveTab] = useState<"combined" | "details" | "remaining">("combined");
  const [beyond24Open, setBeyond24Open]     = useState(false);
  const [beyond24Data, setBeyond24Data]     = useState<Beyond24Row[] | null>(null);
  const [beyond24Tech, setBeyond24Tech]     = useState("");   // فلتر اسم الفنى داخل النافذة
  const [beyond24Loading, setBeyond24Loading] = useState(false);
  // خيارات فلتر الفنى (فنى الإغلاق + فنى المنطقة) + الصفوف بعد الفلترة
  const beyond24TechOptions = useMemo(() => {
    if (!beyond24Data) return [];
    const s = new Set<string>();
    for (const r of beyond24Data) {
      if (r.closeByName && r.closeByName !== "غير معروف") s.add(r.closeByName);
      if (r.areaTechName && r.areaTechName !== "غير معروف") s.add(r.areaTechName);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "ar"));
  }, [beyond24Data]);
  const beyond24Filtered = useMemo(() => {
    if (!beyond24Data) return [];
    if (!beyond24Tech) return beyond24Data;
    return beyond24Data.filter((r) => r.closeByName === beyond24Tech || r.areaTechName === beyond24Tech);
  }, [beyond24Data, beyond24Tech]);
  const [assigningNo, setAssigningNo]       = useState<string | null>(null);

  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === ROLES.ADMIN || user?.role === ROLES.SUPER_ADMIN;

  // قائمة أسماء الفنيين لاختيار فنى الإغلاق يدوياً (تُحمَّل عند فتح حوار التجاوزات)
  const { data: techList = [] } = useQuery<{ workerCode: string; techName: string }[]>({
    queryKey: ["/api/technician-names"],
    queryFn: async () => {
      const res = await fetch("/api/technician-names", { credentials: "include" });
      if (!res.ok) throw new Error("فشل");
      return res.json();
    },
    enabled: beyond24Open && isAdmin,
  });
  const techNames = Array.from(new Set(techList.map(t => t.techName).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ar"));

  const { data, isFetching: fetchingDetails } = useQuery<StatsData>({
    queryKey: ["/api/reports/removal-stats", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo",   dateTo);
      const res = await fetch(`/api/reports/removal-stats?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const { data: dataR, isFetching: fetchingRemaining } = useQuery<StatsData>({
    queryKey: ["/api/reports/remaining-stats", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo",   dateTo);
      const res = await fetch(`/api/reports/remaining-stats?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const { data: dataC, isFetching: fetchingCombined } = useQuery<StatsData>({
    queryKey: ["/api/reports/combined-stats", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo",   dateTo);
      const res = await fetch(`/api/reports/combined-stats?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const isFetching  = fetchingDetails || fetchingRemaining || fetchingCombined;
  const activeData  = activeTab === "combined" ? dataC : activeTab === "details" ? data : dataR;
  const ov          = activeData?.overall;

  // 🆕 عرض الفني: يشوف سطره فقط + سطر الإجمالى + ترتيبه (من غير باقى الفنيين)
  const myTech = (((user as any)?.techName) || user?.username || "").trim();
  const techView = user?.role === ROLES.TECH && !!myTech;
  const eqTech = (n: any) => String(n || "").trim() === myTech;
  const fullTechRows = activeData?.byTechOnly ?? [];
  const myRank = (() => { const i = fullTechRows.findIndex((r) => eqTech(r.techName)); return i >= 0 ? i + 1 : null; })();
  const visTechOnly = techView ? fullTechRows.filter((r) => eqTech(r.techName)) : fullTechRows;
  const visByTech   = techView ? (activeData?.byTech ?? []).filter((r) => eqTech(r.techName)) : (activeData?.byTech ?? []);

  const handleExportExcel = () => {
    if (!activeData) return;
    const wb = XLSX.utils.book_new();
    const period = `${dateFrom} → ${dateTo}`;

    // شيت الإجمالى
    if (ov) {
      const ws1 = XLSX.utils.json_to_sheet([{
        "الفترة": period,
        "إجمالى الأعطال": ov.total,
        "إزالة خلال 24 ساعة": ov.within24h, "نسبة 24 ساعة": `${ov.pct24h}%`,
        "إزالة خلال 48 ساعة": ov.within48h, "نسبة 48 ساعة": `${ov.pct48h}%`,
        "إزالة خلال 120 ساعة": ov.within120h, "نسبة 120 ساعة": `${ov.pct120h}%`,
      }]);
      XLSX.utils.book_append_sheet(wb, ws1, "الإجمالى");
    }

    // شيت بالسنترال
    const ws2 = XLSX.utils.json_to_sheet(activeData.byCentral.map(r => ({
      "السنترال": r.centralName,
      "إجمالى": r.total,
      "إزالة 24 ساعة": r.within24h, "نسبة 24 ساعة": `${r.pct24h}%`,
      "إزالة 48 ساعة": r.within48h, "نسبة 48 ساعة": `${r.pct48h}%`,
      "إزالة 120 ساعة": r.within120h, "نسبة 120 ساعة": `${r.pct120h}%`,
    })));
    XLSX.utils.book_append_sheet(wb, ws2, "بالسنترال");

    // شيت بالفنى
    const ws3 = XLSX.utils.json_to_sheet(activeData.byTech.map(r => ({
      "السنترال": r.centralName, "الفنى": r.techName,
      "إجمالى": r.total,
      "إزالة 24 ساعة": r.within24h, "نسبة 24 ساعة": `${r.pct24h}%`,
      "إزالة 48 ساعة": r.within48h, "نسبة 48 ساعة": `${r.pct48h}%`,
      "إزالة 120 ساعة": r.within120h, "نسبة 120 ساعة": `${r.pct120h}%`,
    })));
    XLSX.utils.book_append_sheet(wb, ws3, "بالفنى");

    const suffix = activeTab === "combined" ? "combined" : activeTab === "remaining" ? "remaining" : "removal";
    XLSX.writeFile(wb, `${suffix}-stats-${dateFrom}-${dateTo}.xlsx`);
  };

  const handleExportPDF = () => {
    if (!activeData) return;
    const tabLabel = activeTab === "combined" ? "الأعطال الإجمالية"
                   : activeTab === "remaining" ? "الأعطال المفتوحة"
                   : "الأعطال المغلقة";
    const title = `إحصائيات ${tabLabel} — ${dateFrom} إلى ${dateTo}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const thStyle = `background:#1e50a0!important;color:#fff!important;padding:5px 4px;border:1px solid #15407f;font-size:10px;text-align:right`;
    const tdStyle = `border:1px solid #ccc;padding:4px;text-align:right;font-size:10px`;
    // تلوين النسبة حسب المستهدف: أخضر (حقق) / بينك (قريب) / أحمر (بعيد)
    const pctStyle = (p: number, target: number) =>
      `background:${p >= target ? "#dcfce7" : p >= target - 10 ? "#fce7f3" : "#fee2e2"}!important;color:${p >= target ? "#166534" : p >= target - 10 ? "#9d174d" : "#991b1b"};font-weight:600;text-align:center`;

    const overallHtml = ov ? `
      <h3 style="margin:12px 0 4px;font-size:12px">الإجمالى</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr>
          <th style="${thStyle}">إجمالى الأعطال</th>
          <th style="${thStyle}">إزالة 24 ساعة</th><th style="${thStyle}">نسبة 24 ساعة</th>
          <th style="${thStyle}">إزالة 48 ساعة</th><th style="${thStyle}">نسبة 48 ساعة</th>
          <th style="${thStyle}">إزالة 120 ساعة</th><th style="${thStyle}">نسبة 120 ساعة</th>
        </tr></thead>
        <tbody><tr>
          <td style="${tdStyle}">${ov.total}</td>
          <td style="${tdStyle}">${ov.within24h}</td><td style="${pctStyle(Number(ov.pct24h), TARGET_24)};${tdStyle}">${ov.pct24h}%</td>
          <td style="${tdStyle}">${ov.within48h}</td><td style="${pctStyle(Number(ov.pct48h), TARGET_48)};${tdStyle}">${ov.pct48h}%</td>
          <td style="${tdStyle}">${ov.within120h}</td><td style="${pctStyle(Number(ov.pct120h), TARGET_120)};${tdStyle}">${ov.pct120h}%</td>
        </tr></tbody>
      </table>` : "";

    const centralRows = activeData.byCentral.map(r => `<tr>
      <td style="${tdStyle}">${esc(r.centralName)}</td>
      <td style="${tdStyle}">${r.total}</td>
      <td style="${tdStyle}">${r.within24h}</td><td style="${pctStyle(Number(r.pct24h), TARGET_24)};${tdStyle}">${r.pct24h}%</td>
      <td style="${tdStyle}">${r.within48h}</td><td style="${pctStyle(Number(r.pct48h), TARGET_48)};${tdStyle}">${r.pct48h}%</td>
      <td style="${tdStyle}">${r.within120h}</td><td style="${pctStyle(Number(r.pct120h), TARGET_120)};${tdStyle}">${r.pct120h}%</td>
    </tr>`).join("");

    const techRows = activeData.byTech.map(r => `<tr>
      <td style="${tdStyle}">${esc(r.centralName)}</td>
      <td style="${tdStyle}">${esc(r.techName)}</td>
      <td style="${tdStyle}">${r.total}</td>
      <td style="${tdStyle}">${r.within24h}</td><td style="${pctStyle(Number(r.pct24h), TARGET_24)};${tdStyle}">${r.pct24h}%</td>
      <td style="${tdStyle}">${r.within48h}</td><td style="${pctStyle(Number(r.pct48h), TARGET_48)};${tdStyle}">${r.pct48h}%</td>
      <td style="${tdStyle}">${r.within120h}</td><td style="${pctStyle(Number(r.pct120h), TARGET_120)};${tdStyle}">${r.pct120h}%</td>
    </tr>`).join("");

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(title)}</title>
      <style>
        body{font-family:Arial,"Segoe UI",sans-serif;font-size:10px;direction:rtl;margin:0;background:#f1f5f9}
        h2{text-align:center;font-size:13px;margin:0 0 6px}
        h3{font-size:11px;margin:10px 0 3px;color:#1e3a5f}
        .page{background:#fff;padding:12px;margin:10px auto;max-width:1100px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
        .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e2e8f0;padding:8px 12px;display:flex;gap:10px;align-items:center;z-index:10}
        .toolbar button{background:#dc2626;color:#fff;border:0;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;font-family:inherit}
        *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        @media print{body{background:#fff}.toolbar{display:none}.page{box-shadow:none;margin:0;padding:0}@page{size:A4 landscape;margin:8mm}}
      </style></head><body>
      <div class="toolbar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button></div>
      <div class="page">
        <h2>${esc(title)}</h2>
        ${overallHtml}
        <h3>بالسنترال</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <thead><tr>
            <th style="${thStyle}">السنترال</th><th style="${thStyle}">الإجمالى</th>
            <th style="${thStyle}">إزالة 24 ساعة</th><th style="${thStyle}">نسبة 24 ساعة</th>
            <th style="${thStyle}">إزالة 48 ساعة</th><th style="${thStyle}">نسبة 48 ساعة</th>
            <th style="${thStyle}">إزالة 120 ساعة</th><th style="${thStyle}">نسبة 120 ساعة</th>
          </tr></thead>
          <tbody>${centralRows}</tbody>
        </table>
        <h3>بالفنى</h3>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="${thStyle}">السنترال</th><th style="${thStyle}">الفنى</th><th style="${thStyle}">الإجمالى</th>
            <th style="${thStyle}">إزالة 24 ساعة</th><th style="${thStyle}">نسبة 24 ساعة</th>
            <th style="${thStyle}">إزالة 48 ساعة</th><th style="${thStyle}">نسبة 48 ساعة</th>
            <th style="${thStyle}">إزالة 120 ساعة</th><th style="${thStyle}">نسبة 120 ساعة</th>
          </tr></thead>
          <tbody>${techRows}</tbody>
        </table>
      </div></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const handleBeyond24 = async () => {
    setBeyond24Open(true);
    if (beyond24Data) return; // already loaded for this filter — reset on filter change
    setBeyond24Loading(true);
    const p = new URLSearchParams({ tab: activeTab });
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo)   p.set("dateTo",   dateTo);
    const r = await fetch(`/api/reports/removal-beyond24?${p}`, { credentials: "include" });
    setBeyond24Data(r.ok ? await r.json() : []);
    setBeyond24Loading(false);
  };

  // إعادة تحميل التجاوزات قسراً + تحديث جداول الإحصائيات بعد تعديل فنى الإغلاق
  const reloadBeyond24 = async () => {
    setBeyond24Loading(true);
    const p = new URLSearchParams({ tab: activeTab });
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo)   p.set("dateTo",   dateTo);
    const r = await fetch(`/api/reports/removal-beyond24?${p}`, { credentials: "include" });
    setBeyond24Data(r.ok ? await r.json() : []);
    setBeyond24Loading(false);
    qc.invalidateQueries({ queryKey: ["/api/reports/combined-stats"] });
    qc.invalidateQueries({ queryKey: ["/api/reports/removal-stats"] });
    qc.invalidateQueries({ queryKey: ["/api/reports/remaining-stats"] });
  };

  const assignCloseBy = async (complainNo: string, techName: string) => {
    try {
      await apiRequest("POST", "/api/manual-close-by", { complainNo, techName });
      setAssigningNo(null);
      await reloadBeyond24();
      toast({ title: "تم تعيين فنى الإغلاق", description: `${techName} — شكوى ${complainNo}`, duration: 3500 });
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذّر الحفظ", variant: "destructive", duration: 5000 });
    }
  };

  const removeCloseBy = async (complainNo: string) => {
    try {
      await apiRequest("DELETE", `/api/manual-close-by/${complainNo}`);
      await reloadBeyond24();
      toast({ title: "تم إلغاء التعيين اليدوى", description: `شكوى ${complainNo}`, duration: 3000 });
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذّر الحذف", variant: "destructive", duration: 5000 });
    }
  };

  const exportBeyond24Excel = () => {
    if (!beyond24Data) return;
    const ws = XLSX.utils.json_to_sheet(beyond24Filtered.map((r, i) => ({
      "#": i + 1,
      "رقم الشكوى": r.complainNo,
      "اسم العميل": r.subName ?? "",
      "العنوان": r.subAdd ?? "",
      "رقم التليفون": r.phoneNumber,
      "السنترال": r.centralName,
      "الكابينه (430D)": r.cabinetNo,
      "الكابينه (بيان الخطوط)": r.lineCabin ?? "",
      "البكس": r.lineBox ?? "",
      "كود الكابينه (MSAN)": r.msanCode ?? "",
      "الفريم": r.frame ?? "",
      "تاريخ الشكوى": r.complainTime ? new Date(r.complainTime).toLocaleString("ar-EG") : "",
      "تاريخ الإغلاق": r.closeTime ? new Date(r.closeTime).toLocaleString("ar-EG") : "",
      "المدة (ساعة)": r.hours,
      "كود الإغلاق": r.closeCode ?? "",
      "سبب الإغلاق": closeReason(r.closeCode),
      "فنى الإغلاق": r.closeByName,
      "فنى المنطقة": r.areaTechName,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تجاوزات 24 ساعة");
    XLSX.writeFile(wb, `beyond24-${activeTab}-${dateFrom}-${dateTo}.xlsx`);
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="text-xs text-muted-foreground shrink-0">من</span>
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setBeyond24Data(null); }} className="text-sm w-full sm:w-auto" dir="ltr" />
        </div>
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="text-xs text-muted-foreground shrink-0">إلى</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setBeyond24Data(null); }} className="text-sm w-full sm:w-auto" dir="ltr" />
        </div>
        {/* تبديل التابات */}
        <div className="flex rounded-lg border overflow-hidden text-xs w-full sm:w-auto">
          {(["combined", "details", "remaining"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setBeyond24Data(null); }}
              className={`px-3 py-1.5 font-medium transition-colors ${
                activeTab === tab
                  ? "bg-blue-900 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab === "combined" ? "الأعطال الإجمالية" : tab === "details" ? "الأعطال المغلقة" : "الأعطال المفتوحة"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <Button variant="outline" size="sm" onClick={handleBeyond24} disabled={!ov}
          className="text-amber-700 border-amber-300 gap-1">
          <Clock className="w-4 h-4" /> تجاوزات ٢٤ س
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!activeData || !ov}
          className="text-green-700 border-green-200 gap-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!activeData || !ov}
          className="text-red-700 border-red-200 gap-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      {/* إجمالى */}
      {ov && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "إزالة خلال 24 ساعة",  count: ov.within24h,  pct: ov.pct24h,  target: TARGET_24 },
            { label: "إزالة خلال 48 ساعة",  count: ov.within48h,  pct: ov.pct48h,  target: TARGET_48 },
            { label: "إزالة خلال 120 ساعة", count: ov.within120h, pct: ov.pct120h, target: TARGET_120 },
          ].map(({ label, count, pct, target }) => {
            const ok   = Number(pct) >= target;
            const near = Number(pct) >= target - 10;
            const numCls = ok ? "text-green-600" : near ? "text-pink-600" : "text-red-600";
            const barCls = ok ? "bg-green-500"  : near ? "bg-pink-500"  : "bg-red-500";
            return (
              <Card key={label} className="border-0 shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground font-normal">
                    {label} <span className="text-[10px]">(المستهدف {target}%)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className={`text-2xl font-bold ${numCls}`}>{count}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">من إجمالى {ov.total} — {pct}%</div>
                  <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-2 ${barCls} rounded-full`} style={{ width: `${Math.min(100, Number(pct))}%` }} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!ov && !isFetching && (
        <div className="py-6 bg-white rounded-lg border border-dashed space-y-3 px-6">
          <div className="text-center text-muted-foreground">
            لا توجد بيانات مُغلقة للفترة المحددة
          </div>
          {data?._diag && (
            <div className="text-xs text-gray-500 border-t pt-3 space-y-1 text-right" dir="rtl">
              <div>إجمالى السجلات في قاعدة البيانات: <strong>{data._diag.total_all}</strong> (منها مغلقة: <strong>{data._diag.total_closed}</strong>)</div>
              {data._diag.min_complain && (
                <div>نطاق تواريخ الشكاوى: <span dir="ltr">{data._diag.min_complain?.slice(0,10)}</span> — <span dir="ltr">{data._diag.max_complain?.slice(0,10)}</span></div>
              )}
              {data._diag.centrals?.length > 0 && (
                <div>أسماء السنترالات الموجودة: <span className="font-medium">{data._diag.centrals.filter(Boolean).join(" | ")}</span></div>
              )}
              {Number(data._diag.total_all) === 0 && (
                <div className="text-red-600 font-medium">الجدول فارغ — تأكد من رفع ملف 430D من صفحة رفع الملفات</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* إجمالى الفنيين — يظهر أولاً */}
      {activeData && activeData.byTechOnly.length > 0 && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <CardHeader className="pb-2 bg-blue-900 text-white rounded-t-lg px-4 py-3">
            <CardTitle className="text-sm font-bold">إحصائيات بالفنى (إجمالى الإدارة){techView && myRank ? ` — ترتيبك: ${myRank} من ${fullTechRows.length}` : ""}</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-blue-800">
                <TableRow>
                  <TableHead className="text-white font-bold text-right">الفنى</TableHead>
                  <TableHead className="text-white font-bold text-right">الإجمالى</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 24 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 24 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 48 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 48 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 120 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 120 ساعة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visTechOnly.map(r => (
                  <TableRow key={r.techName} className="hover:bg-green-50">
                    <TableCell className="font-medium">{r.techName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.within24h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct24h), TARGET_24)}</TableCell>
                    <TableCell>{r.within48h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct48h), TARGET_48)}</TableCell>
                    <TableCell>{r.within120h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct120h), TARGET_120)}</TableCell>
                  </TableRow>
                ))}
                {/* سطر إجمالى الإدارة */}
                {ov && (
                  <TableRow className="bg-blue-900 text-white font-bold hover:bg-blue-800">
                    <TableCell className="text-white font-bold">إجمالى الإدارة</TableCell>
                    <TableCell className="text-white font-bold">{ov.total}</TableCell>
                    <TableCell className="text-white">{ov.within24h}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded font-semibold bg-white text-blue-900">{ov.pct24h}%</span></TableCell>
                    <TableCell className="text-white">{ov.within48h}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded font-semibold bg-white text-blue-900">{ov.pct48h}%</span></TableCell>
                    <TableCell className="text-white">{ov.within120h}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded font-semibold bg-white text-blue-900">{ov.pct120h}%</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* بالسنترال */}
      {activeData && activeData.byCentral.length > 0 && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <CardHeader className="pb-2 bg-blue-900 text-white rounded-t-lg px-4 py-3">
            <CardTitle className="text-sm font-bold">إحصائيات بالسنترال</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-blue-800">
                <TableRow>
                  <TableHead className="text-white font-bold text-right">السنترال</TableHead>
                  <TableHead className="text-white font-bold text-right">الإجمالى</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 24 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 24 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 48 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 48 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 120 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 120 ساعة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeData.byCentral.map(r => (
                  <TableRow key={r.centralName} className="hover:bg-blue-50">
                    <TableCell className="font-medium">{r.centralName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.within24h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct24h), TARGET_24)}</TableCell>
                    <TableCell>{r.within48h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct48h), TARGET_48)}</TableCell>
                    <TableCell>{r.within120h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct120h), TARGET_120)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* بالفنى */}
      {activeData && activeData.byTech.length > 0 && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <CardHeader className="pb-2 bg-blue-900 text-white rounded-t-lg px-4 py-3">
            <CardTitle className="text-sm font-bold">إحصائيات بالفنى</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-blue-800">
                <TableRow>
                  <TableHead className="text-white font-bold text-right">السنترال</TableHead>
                  <TableHead className="text-white font-bold text-right">الفنى</TableHead>
                  <TableHead className="text-white font-bold text-right">الإجمالى</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 24 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 24 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 48 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 48 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">إزالة 120 ساعة</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة 120 ساعة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visByTech.map(r => (
                  <TableRow key={`${r.centralName}-${r.techName}`} className="hover:bg-green-50">
                    <TableCell>{r.centralName}</TableCell>
                    <TableCell className="font-medium">{r.techName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.within24h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct24h), TARGET_24)}</TableCell>
                    <TableCell>{r.within48h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct48h), TARGET_48)}</TableCell>
                    <TableCell>{r.within120h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct120h), TARGET_120)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Dialog: تفصيل الأعطال التى تجاوزت 24 ساعة */}
      <Dialog open={beyond24Open} onOpenChange={setBeyond24Open}>
        <DialogContent className="max-w-5xl w-full max-h-[88vh] flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right text-sm">
              تفصيل الأعطال التى تجاوزت ٢٤ ساعة — {activeTab === "combined" ? "إجمالية" : activeTab === "details" ? "مغلقة" : "مفتوحة"} — {dateFrom} إلى {dateTo}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <span className="text-xs text-muted-foreground">
              {beyond24Loading ? "جارى التحميل..." : `${beyond24Filtered.length} عطل تجاوز ٢٤ ساعة`}
            </span>
            <div className="flex items-center gap-2">
              <select value={beyond24Tech} onChange={(e) => setBeyond24Tech(e.target.value)}
                className="border rounded-md px-2 py-1 text-xs bg-background" dir="rtl">
                <option value="">كل الفنيين</option>
                {beyond24TechOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Button variant="outline" size="sm" onClick={exportBeyond24Excel}
                disabled={beyond24Filtered.length === 0}
                className="text-green-700 border-green-200 gap-1 text-xs">
                <FileSpreadsheet className="w-3 h-3" /> تصدير Excel
              </Button>
            </div>
          </div>
          {beyond24Loading && (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
          )}
          {!beyond24Loading && beyond24Data && (
            <div className="flex-1 min-h-0 overflow-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <Table className="text-right text-xs min-w-max" dir="rtl">
                <TableHeader className="bg-amber-900 sticky top-0">
                  <TableRow>
                    <TableHead className="text-white font-bold text-right">#</TableHead>
                    <TableHead className="text-white font-bold text-right">رقم الشكوى</TableHead>
                    <TableHead className="text-white font-bold text-right">رقم التليفون</TableHead>
                    <TableHead className="text-white font-bold text-right">اسم العميل</TableHead>
                    <TableHead className="text-white font-bold text-right">العنوان</TableHead>
                    <TableHead className="text-white font-bold text-right">السنترال</TableHead>
                    <TableHead className="text-white font-bold text-right">الكابينه</TableHead>
                    <TableHead className="text-white font-bold text-right">البكس</TableHead>
                    <TableHead className="text-white font-bold text-right">كود MSAN</TableHead>
                    <TableHead className="text-white font-bold text-right">الفريم</TableHead>
                    <TableHead className="text-white font-bold text-right">تاريخ الشكوى</TableHead>
                    <TableHead className="text-white font-bold text-right">تاريخ الإغلاق</TableHead>
                    <TableHead className="text-white font-bold text-right">المدة (ساعة)</TableHead>
                    <TableHead className="text-white font-bold text-right">سبب الإغلاق</TableHead>
                    <TableHead className="text-white font-bold text-right">فنى الإغلاق</TableHead>
                    <TableHead className="text-white font-bold text-right">فنى المنطقة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {beyond24Filtered.map((r, i) => (
                    <TableRow key={r.complainNo} className="hover:bg-amber-50">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{r.complainNo}</TableCell>
                      <TableCell className="font-bold">{r.phoneNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.subName ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={r.subAdd ?? ""}>{r.subAdd ?? "—"}</TableCell>
                      <TableCell>{r.centralName}</TableCell>
                      <TableCell>{r.lineCabin ?? r.cabinetNo}</TableCell>
                      <TableCell>{r.lineBox ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.msanCode ?? "—"}</TableCell>
                      <TableCell>{r.frame ?? "—"}</TableCell>
                      <TableCell dir="ltr" className="text-right">{r.complainTime ? new Date(r.complainTime).toLocaleDateString("ar-EG") : ""}</TableCell>
                      <TableCell dir="ltr" className="text-right">{r.closeTime ? new Date(r.closeTime).toLocaleDateString("ar-EG") : ""}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${Number(r.hours) <= 48 ? "bg-yellow-100 text-yellow-800" : Number(r.hours) <= 120 ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-800"}`}>
                          {r.hours}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap" title={r.closeCode ? `كود ${r.closeCode}` : ""}>
                        {r.closeCode ? (closeReason(r.closeCode) || `كود ${r.closeCode}`) : "—"}
                      </TableCell>
                      <TableCell>
                        {assigningNo === r.complainNo ? (
                          <div className="flex items-center gap-1">
                            <select
                              autoFocus
                              defaultValue=""
                              onChange={(e) => { if (e.target.value) assignCloseBy(r.complainNo, e.target.value); }}
                              className="border rounded text-xs px-1 py-1 max-w-[150px] bg-white"
                            >
                              <option value="" disabled>اختر الفنى…</option>
                              {techNames.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <button onClick={() => setAssigningNo(null)} className="text-gray-400 hover:text-gray-600" title="إلغاء">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className={r.closeByManual ? "text-blue-700 font-semibold" : r.closeByName === "غير معروف" ? "text-muted-foreground" : ""}>
                              {r.closeByName}
                            </span>
                            {isAdmin && (r.closeByName === "غير معروف" || r.closeByManual) && (
                              <button
                                onClick={() => setAssigningNo(r.complainNo)}
                                className="text-blue-600 hover:text-blue-800"
                                title={r.closeByManual ? "تعديل فنى الإغلاق" : "تعيين فنى الإغلاق"}
                              >
                                {r.closeByManual ? <Pencil className="w-3.5 h-3.5" /> : <UserPlus className="w-4 h-4" />}
                              </button>
                            )}
                            {isAdmin && r.closeByManual && (
                              <button onClick={() => removeCloseBy(r.complainNo)} className="text-red-500 hover:text-red-700" title="إلغاء التعيين اليدوى">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{r.areaTechName}</TableCell>
                    </TableRow>
                  ))}
                  {beyond24Data.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={14} className="text-center text-muted-foreground py-6">لا توجد أعطال تجاوزت ٢٤ ساعة</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

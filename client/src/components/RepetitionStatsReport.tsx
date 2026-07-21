import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { closeReason } from "@/lib/close-codes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, FileSpreadsheet, Printer, Repeat2, Pencil, Save, X } from "lucide-react";
import { format } from "date-fns";

interface RepRow {
  centralName: string | null;
  techName: string | null;
  total: number;
  distinctPhones: number;
  nonRepeated: number;
  repeatedPhones: number;
  repCharges: number;
  repRatio: number;
}

interface RepData {
  overall: RepRow | null;
  byCentral: RepRow[];
  byTech: RepRow[];
  byTechOnly: RepRow[];
}

interface RepDetailRow {
  complainNo: string;
  phoneNumber: string;
  centralName: string;
  cabinetNo: string;
  complainTime: string;
  closeTime: string;
  closeCode: string | null;
  appearances: number;
  closeByName: string;
  areaTechName: string;
  chargedTech: string;   // الفنى المحمَّل عليه الرقم (صاحب إغلاق أول شكوى، أو فنى المنطقة لو الإغلاق غير معروف)
  lineCabin: string | null;
  lineBox: string | null;
  msanCode: string | null;
  frame: string | null;
  subName: string | null;
  subAdd: string | null;
}

// نسبة التكرار: المستهدف ألا تتجاوز 4% — أخضر <3%، أصفر 3-4%، أحمر >4%
const TARGET_REP = 4;  // فوقها = أحمر (تعدّى المستهدف)
const WARN_REP = 3;    // من 3% حتى 4% = أصفر (تحذير)
const ratioBadge = (pct: number) => {
  const cls =
    pct < WARN_REP    ? "bg-green-100 text-green-800" :
    pct <= TARGET_REP ? "bg-yellow-100 text-yellow-800" :
                        "bg-red-100 text-red-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{pct}%</span>;
};

const ratioStyle = (p: number) =>
  `background:${p < WARN_REP ? "#dcfce7" : p <= TARGET_REP ? "#fef9c3" : "#fee2e2"}!important;color:${p < WARN_REP ? "#166534" : p <= TARGET_REP ? "#854d0e" : "#991b1b"};font-weight:600;text-align:center`;

export function RepetitionStatsReport() {
  const today      = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo,   setDateTo]   = useState(today);
  const [activeTab, setActiveTab] = useState<"combined" | "closed" | "open">("combined");
  const [repDetailOpen, setRepDetailOpen]     = useState(false);
  const [repDetailData, setRepDetailData]     = useState<RepDetailRow[] | null>(null);
  const [repDetailLoading, setRepDetailLoading] = useState(false);
  const [repDetailTech, setRepDetailTech]     = useState(""); // فلتر باسم الفنى
  const [editingTech, setEditingTech]         = useState<string | null>(null); // complainNo
  const [editTechDraft, setEditTechDraft]     = useState("");
  const [savingTech, setSavingTech]           = useState(false);
  const { user } = useAuth();
  const canEditTech = user?.role === ROLES.ADMIN || user?.role === ROLES.SUPER_ADMIN;

  // قائمة أسماء الفنيين لاختيار فنى الإغلاق من دروب ليست (بدل الكتابة اليدوية)
  const { data: techNamesList } = useQuery<{ workerCode: string; techName: string }[]>({
    queryKey: ["/api/technician-names"],
    queryFn: async () => {
      const res = await fetch("/api/technician-names", { credentials: "include" });
      if (!res.ok) throw new Error("فشل تحميل أسماء الفنيين");
      return res.json();
    },
    enabled: canEditTech,
  });
  const techNameOptions = [
    ...new Set((techNamesList ?? []).map((t) => (t.techName ?? "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "ar"));

  const handleSaveCloseTech = async (complainNo: string) => {
    const tech = editTechDraft.trim();
    if (!tech) return;
    setSavingTech(true);
    try {
      const res = await fetch("/api/manual-close-by", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ complainNo, techName: tech }),
      });
      if (!res.ok) throw new Error("فشل الحفظ");
      // تحديث البيانات المحلية مباشرةً بدون إعادة جلب
      setRepDetailData((prev) =>
        prev
          ? prev.map((r) => r.complainNo === complainNo ? { ...r, closeByName: tech } : r)
          : prev,
      );
      setEditingTech(null);
    } catch {
      alert("تعذّر حفظ فنى الإغلاق");
    } finally {
      setSavingTech(false);
    }
  };

  const mkQuery = (endpoint: string, key: string) => useQuery<RepData>({
    queryKey: [key, dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo",   dateTo);
      const res = await fetch(`${endpoint}?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const { data: dataC, isFetching: fC } = mkQuery("/api/reports/repetition-combined", "/api/reports/repetition-combined");
  const { data: dataCl, isFetching: fCl } = mkQuery("/api/reports/repetition-closed",  "/api/reports/repetition-closed");
  const { data: dataO,  isFetching: fO  } = mkQuery("/api/reports/repetition-open",    "/api/reports/repetition-open");

  const isFetching = fC || fCl || fO;
  const activeData = activeTab === "combined" ? dataC : activeTab === "closed" ? dataCl : dataO;
  const ov         = activeData?.overall;

  // 🆕 عرض الفني: سطره فقط + الإجمالى + ترتيبه (من غير باقى الفنيين)
  const myTech = (((user as any)?.techName) || user?.username || "").trim();
  const techView = user?.role === ROLES.TECH && !!myTech;
  const eqTech = (n: any) => String(n || "").trim() === myTech;
  const fullTechRows = activeData?.byTechOnly ?? [];
  const myRank = (() => { const i = fullTechRows.findIndex((r) => eqTech(r.techName)); return i >= 0 ? i + 1 : null; })();
  const visTechOnly = techView ? fullTechRows.filter((r) => eqTech(r.techName)) : fullTechRows;
  const visByTech   = techView ? (activeData?.byTech ?? []).filter((r) => eqTech(r.techName)) : (activeData?.byTech ?? []);

  const handleExportExcel = () => {
    if (!activeData) return;
    const wb   = XLSX.utils.book_new();
    const period = `${dateFrom} → ${dateTo}`;
    const tabLabel = activeTab === "combined" ? "إجمالية" : activeTab === "closed" ? "مغلقة" : "مفتوحة";

    if (ov) {
      const ws1 = XLSX.utils.json_to_sheet([{
        "الفترة": period,
        "إجمالى الأعطال": ov.total,
        "الخطوط الفريدة": ov.distinctPhones,
        "غير مكررة": ov.nonRepeated,
        "مكررة": ov.repeatedPhones,
        "مرات التكرار المحسوبة": ov.repCharges,
        "نسبة التكرار": `${ov.repRatio}%`,
      }]);
      XLSX.utils.book_append_sheet(wb, ws1, "الإجمالى");
    }

    const ws2 = XLSX.utils.json_to_sheet(activeData.byCentral.map(r => ({
      "السنترال": r.centralName,
      "إجمالى": r.total,
      "الخطوط الفريدة": r.distinctPhones,
      "غير مكررة": r.nonRepeated,
      "مكررة": r.repeatedPhones,
      "مرات التكرار": r.repCharges,
      "نسبة التكرار": `${r.repRatio}%`,
    })));
    XLSX.utils.book_append_sheet(wb, ws2, "بالسنترال");

    const ws3 = XLSX.utils.json_to_sheet(activeData.byTech.map(r => ({
      "السنترال": r.centralName,
      "الفنى": r.techName,
      "إجمالى": r.total,
      "الخطوط الفريدة": r.distinctPhones,
      "غير مكررة": r.nonRepeated,
      "مكررة": r.repeatedPhones,
      "مرات التكرار": r.repCharges,
      "نسبة التكرار": `${r.repRatio}%`,
    })));
    XLSX.utils.book_append_sheet(wb, ws3, "بالفنى");

    XLSX.writeFile(wb, `repetition-${tabLabel}-${dateFrom}-${dateTo}.xlsx`);
  };

  const handleExportPDF = () => {
    if (!activeData) return;
    const tabLabel = activeTab === "combined" ? "الأعطال الإجمالية"
                   : activeTab === "closed"   ? "الأعطال المغلقة"
                   :                            "الأعطال المفتوحة";
    const title = `إحصائيات التكرار — ${tabLabel} — ${dateFrom} إلى ${dateTo}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const thStyle = `background:#1e50a0!important;color:#fff!important;padding:5px 4px;border:1px solid #15407f;font-size:10px;text-align:right`;
    const tdStyle = `border:1px solid #ccc;padding:4px;text-align:right;font-size:10px`;

    const overallHtml = ov ? `
      <h3 style="margin:12px 0 4px;font-size:12px">الإجمالى</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr>
          <th style="${thStyle}">إجمالى الأعطال</th>
          <th style="${thStyle}">الخطوط الفريدة</th>
          <th style="${thStyle}">غير مكررة</th>
          <th style="${thStyle}">مكررة</th>
          <th style="${thStyle}">مرات التكرار</th>
          <th style="${thStyle}">نسبة التكرار</th>
        </tr></thead>
        <tbody><tr>
          <td style="${tdStyle}">${ov.total}</td>
          <td style="${tdStyle}">${ov.distinctPhones}</td>
          <td style="${tdStyle}">${ov.nonRepeated}</td>
          <td style="${tdStyle}">${ov.repeatedPhones}</td>
          <td style="${tdStyle}">${ov.repCharges}</td>
          <td style="${ratioStyle(Number(ov.repRatio))};${tdStyle}">${ov.repRatio}%</td>
        </tr></tbody>
      </table>` : "";

    const centralRows = activeData.byCentral.map(r => `<tr>
      <td style="${tdStyle}">${esc(r.centralName)}</td>
      <td style="${tdStyle}">${r.total}</td>
      <td style="${tdStyle}">${r.distinctPhones}</td>
      <td style="${tdStyle}">${r.nonRepeated}</td>
      <td style="${tdStyle}">${r.repeatedPhones}</td>
      <td style="${tdStyle}">${r.repCharges}</td>
      <td style="${ratioStyle(Number(r.repRatio))};${tdStyle}">${r.repRatio}%</td>
    </tr>`).join("");

    const techRows = activeData.byTech.map(r => `<tr>
      <td style="${tdStyle}">${esc(r.centralName)}</td>
      <td style="${tdStyle}">${esc(r.techName)}</td>
      <td style="${tdStyle}">${r.total}</td>
      <td style="${tdStyle}">${r.distinctPhones}</td>
      <td style="${tdStyle}">${r.nonRepeated}</td>
      <td style="${tdStyle}">${r.repeatedPhones}</td>
      <td style="${tdStyle}">${r.repCharges}</td>
      <td style="${ratioStyle(Number(r.repRatio))};${tdStyle}">${r.repRatio}%</td>
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
            <th style="${thStyle}">الخطوط الفريدة</th><th style="${thStyle}">غير مكررة</th>
            <th style="${thStyle}">مكررة</th><th style="${thStyle}">مرات التكرار</th>
            <th style="${thStyle}">نسبة التكرار</th>
          </tr></thead>
          <tbody>${centralRows}</tbody>
        </table>
        <h3>بالفنى</h3>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="${thStyle}">السنترال</th><th style="${thStyle}">الفنى</th>
            <th style="${thStyle}">الإجمالى</th><th style="${thStyle}">الخطوط الفريدة</th>
            <th style="${thStyle}">غير مكررة</th><th style="${thStyle}">مكررة</th>
            <th style="${thStyle}">مرات التكرار</th><th style="${thStyle}">نسبة التكرار</th>
          </tr></thead>
          <tbody>${techRows}</tbody>
        </table>
      </div></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const handleRepDetail = async () => {
    setRepDetailOpen(true);
    if (repDetailData) return;
    setRepDetailLoading(true);
    const p = new URLSearchParams({ tab: activeTab });
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo)   p.set("dateTo",   dateTo);
    const r = await fetch(`/api/reports/repetition-detail?${p}`, { credentials: "include" });
    setRepDetailData(r.ok ? await r.json() : []);
    setRepDetailLoading(false);
  };

  // قائمة أسماء الفنيين المحمَّلين عليهم الأرقام (الفنى المحمَّل) للفلتر
  const repDetailTechOptions = useMemo(() => {
    if (!repDetailData) return [];
    const s = new Set<string>();
    for (const r of repDetailData) {
      if (r.chargedTech && r.chargedTech !== "غير معروف") s.add(r.chargedTech);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "ar"));
  }, [repDetailData]);

  // الصفوف بعد تطبيق فلتر اسم الفنى (يطابق الفنى المحمَّل عليه الرقم)
  const repDetailFiltered = useMemo(() => {
    if (!repDetailData) return [];
    if (!repDetailTech) return repDetailData;
    return repDetailData.filter((r) => r.chargedTech === repDetailTech);
  }, [repDetailData, repDetailTech]);

  const exportRepDetailExcel = () => {
    if (!repDetailFiltered.length) return;
    const ws = XLSX.utils.json_to_sheet(repDetailFiltered.map((r, i) => ({
      "#": i + 1,
      "رقم التليفون": r.phoneNumber,
      "اسم العميل": r.subName ?? "",
      "العنوان": r.subAdd ?? "",
      "السنترال": r.centralName,
      "الكابينه (بيان الخطوط)": r.lineCabin ?? "",
      "البكس": r.lineBox ?? "",
      "كود الكابينه (MSAN)": r.msanCode ?? "",
      "الفريم": r.frame ?? "",
      "عدد المرات": r.appearances,
      "رقم الشكوى": r.complainNo,
      "تاريخ الشكوى": r.complainTime ? new Date(r.complainTime).toLocaleString("ar-EG") : "",
      "تاريخ الإغلاق": r.closeTime ? new Date(r.closeTime).toLocaleString("ar-EG") : "",
      "كود الإغلاق": r.closeCode ?? "",
      "سبب الإغلاق": closeReason(r.closeCode),
      "فنى الإغلاق": r.closeByName,
      "فنى المنطقة": r.areaTechName,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الخطوط المكررة");
    XLSX.writeFile(wb, `repetition-detail-${activeTab}-${dateFrom}-${dateTo}.xlsx`);
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="text-xs text-muted-foreground shrink-0">من</span>
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setRepDetailData(null); }} className="text-sm w-full sm:w-auto" dir="ltr" />
        </div>
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="text-xs text-muted-foreground shrink-0">إلى</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setRepDetailData(null); }} className="text-sm w-full sm:w-auto" dir="ltr" />
        </div>
        <div className="flex rounded-lg border overflow-hidden text-xs w-full sm:w-auto">
          {(["combined", "closed", "open"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setRepDetailData(null); }}
              className={`px-3 py-1.5 font-medium transition-colors ${
                activeTab === tab
                  ? "bg-blue-900 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab === "combined" ? "الأعطال الإجمالية" : tab === "closed" ? "الأعطال المغلقة" : "الأعطال المفتوحة"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <Button variant="outline" size="sm" onClick={handleRepDetail} disabled={!ov}
          className="text-purple-700 border-purple-300 gap-1">
          <Repeat2 className="w-4 h-4" /> الخطوط المكررة
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

      {/* بطاقات الإجمالى */}
      {ov && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "إجمالى الأعطال",   value: ov.total,          sub: "" },
            { label: "الخطوط الفريدة",   value: ov.distinctPhones, sub: "" },
            { label: "مرات التكرار",      value: ov.repCharges,     sub: `خطوط مكررة: ${ov.repeatedPhones}` },
            { label: "نسبة التكرار",  value: `${ov.repRatio}%`, sub: `المستهدف ≤ ${TARGET_REP}% — مكررة: ${ov.repeatedPhones}` },
          ].map(({ label, value, sub }) => (
            <Card key={label} className="border-0 shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground font-normal">{label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className={`text-2xl font-bold ${label === "نسبة التكرار" ? (Number(ov.repRatio) < WARN_REP ? "text-green-600" : Number(ov.repRatio) <= TARGET_REP ? "text-yellow-600" : "text-red-600") : "text-gray-800"}`}>{value}</div>
                {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!ov && !isFetching && (
        <div className="py-6 bg-white rounded-lg border border-dashed text-center text-muted-foreground">
          لا توجد بيانات للفترة المحددة
        </div>
      )}

      {/* إجمالى الفنيين (إجمالى الإدارة) */}
      {activeData && activeData.byTechOnly.length > 0 && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <CardHeader className="pb-2 bg-blue-900 text-white rounded-t-lg px-4 py-3">
            <CardTitle className="text-sm font-bold">إحصائيات التكرار بالفنى (إجمالى الإدارة){techView && myRank ? ` — ترتيبك: ${myRank} من ${fullTechRows.length}` : ""}</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-blue-800">
                <TableRow>
                  <TableHead className="text-white font-bold text-right">الفنى</TableHead>
                  <TableHead className="text-white font-bold text-right">الإجمالى</TableHead>
                  <TableHead className="text-white font-bold text-right">الخطوط الفريدة</TableHead>
                  <TableHead className="text-white font-bold text-right">غير مكررة</TableHead>
                  <TableHead className="text-white font-bold text-right">مكررة</TableHead>
                  <TableHead className="text-white font-bold text-right">مرات التكرار</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة التكرار</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visTechOnly.map(r => (
                  <TableRow key={r.techName} className="hover:bg-green-50">
                    <TableCell className="font-medium">{r.techName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.distinctPhones}</TableCell>
                    <TableCell>{r.nonRepeated}</TableCell>
                    <TableCell>{r.repeatedPhones}</TableCell>
                    <TableCell>{r.repCharges}</TableCell>
                    <TableCell>{ratioBadge(Number(r.repRatio))}</TableCell>
                  </TableRow>
                ))}
                {ov && (
                  <TableRow className="bg-blue-900 text-white font-bold hover:bg-blue-800">
                    <TableCell className="text-white font-bold">إجمالى الإدارة</TableCell>
                    <TableCell className="text-white font-bold">{ov.total}</TableCell>
                    <TableCell className="text-white">{ov.distinctPhones}</TableCell>
                    <TableCell className="text-white">{ov.nonRepeated}</TableCell>
                    <TableCell className="text-white">{ov.repeatedPhones}</TableCell>
                    <TableCell className="text-white">{ov.repCharges}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded font-semibold bg-white text-blue-900">{ov.repRatio}%</span></TableCell>
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
            <CardTitle className="text-sm font-bold">إحصائيات التكرار بالسنترال</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-blue-800">
                <TableRow>
                  <TableHead className="text-white font-bold text-right">السنترال</TableHead>
                  <TableHead className="text-white font-bold text-right">الإجمالى</TableHead>
                  <TableHead className="text-white font-bold text-right">الخطوط الفريدة</TableHead>
                  <TableHead className="text-white font-bold text-right">غير مكررة</TableHead>
                  <TableHead className="text-white font-bold text-right">مكررة</TableHead>
                  <TableHead className="text-white font-bold text-right">مرات التكرار</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة التكرار</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeData.byCentral.map(r => (
                  <TableRow key={r.centralName} className="hover:bg-blue-50">
                    <TableCell className="font-medium">{r.centralName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.distinctPhones}</TableCell>
                    <TableCell>{r.nonRepeated}</TableCell>
                    <TableCell>{r.repeatedPhones}</TableCell>
                    <TableCell>{r.repCharges}</TableCell>
                    <TableCell>{ratioBadge(Number(r.repRatio))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* بالفنى (مقسم بالسنترال) */}
      {activeData && activeData.byTech.length > 0 && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <CardHeader className="pb-2 bg-blue-900 text-white rounded-t-lg px-4 py-3">
            <CardTitle className="text-sm font-bold">إحصائيات التكرار بالفنى</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-blue-800">
                <TableRow>
                  <TableHead className="text-white font-bold text-right">السنترال</TableHead>
                  <TableHead className="text-white font-bold text-right">الفنى</TableHead>
                  <TableHead className="text-white font-bold text-right">الإجمالى</TableHead>
                  <TableHead className="text-white font-bold text-right">الخطوط الفريدة</TableHead>
                  <TableHead className="text-white font-bold text-right">غير مكررة</TableHead>
                  <TableHead className="text-white font-bold text-right">مكررة</TableHead>
                  <TableHead className="text-white font-bold text-right">مرات التكرار</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة التكرار</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visByTech.map(r => (
                  <TableRow key={`${r.centralName}-${r.techName}`} className="hover:bg-green-50">
                    <TableCell>{r.centralName}</TableCell>
                    <TableCell className="font-medium">{r.techName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.distinctPhones}</TableCell>
                    <TableCell>{r.nonRepeated}</TableCell>
                    <TableCell>{r.repeatedPhones}</TableCell>
                    <TableCell>{r.repCharges}</TableCell>
                    <TableCell>{ratioBadge(Number(r.repRatio))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Dialog: تفصيل الخطوط المكررة */}
      <Dialog open={repDetailOpen} onOpenChange={setRepDetailOpen}>
        <DialogContent className="max-w-5xl w-full max-h-[88vh] flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right text-sm">
              تفصيل الخطوط المكررة — {activeTab === "combined" ? "إجمالية" : activeTab === "closed" ? "مغلقة" : "مفتوحة"} — {dateFrom} إلى {dateTo}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {repDetailLoading
                ? "جارى التحميل..."
                : repDetailData
                  ? `${new Set(repDetailFiltered.map(r => r.phoneNumber)).size} خط مكرر — ${repDetailFiltered.length} شكوى`
                  : ""}
            </span>
            <div className="flex items-center gap-2">
              <SearchableCombobox
                options={repDetailTechOptions}
                value={repDetailTech}
                onChange={setRepDetailTech}
                placeholder="كل الفنيين"
                searchPlaceholder="ابحث باسم الفنى..."
                className="w-44 text-xs"
              />
              <Button variant="outline" size="sm" onClick={exportRepDetailExcel}
                disabled={!repDetailFiltered.length}
                className="text-green-700 border-green-200 gap-1 text-xs">
                <FileSpreadsheet className="w-3 h-3" /> تصدير Excel
              </Button>
            </div>
          </div>
          {repDetailLoading && (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-purple-600" /></div>
          )}
          {!repDetailLoading && repDetailData && (
            <div className="flex-1 min-h-0 overflow-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <Table className="text-right text-xs min-w-max" dir="rtl">
                <TableHeader className="bg-purple-900 sticky top-0">
                  <TableRow>
                    <TableHead className="text-white font-bold text-right">#</TableHead>
                    <TableHead className="text-white font-bold text-right">رقم التليفون</TableHead>
                    <TableHead className="text-white font-bold text-right">اسم العميل</TableHead>
                    <TableHead className="text-white font-bold text-right">العنوان</TableHead>
                    <TableHead className="text-white font-bold text-right">السنترال</TableHead>
                    <TableHead className="text-white font-bold text-right">الكابينه</TableHead>
                    <TableHead className="text-white font-bold text-right">البكس</TableHead>
                    <TableHead className="text-white font-bold text-right">كود MSAN</TableHead>
                    <TableHead className="text-white font-bold text-right">الفريم</TableHead>
                    <TableHead className="text-white font-bold text-right">عدد المرات</TableHead>
                    <TableHead className="text-white font-bold text-right">رقم الشكوى</TableHead>
                    <TableHead className="text-white font-bold text-right">تاريخ الشكوى</TableHead>
                    <TableHead className="text-white font-bold text-right">تاريخ الإغلاق</TableHead>
                    <TableHead className="text-white font-bold text-right">سبب الإغلاق</TableHead>
                    <TableHead className="text-white font-bold text-right">فنى الإغلاق</TableHead>
                    <TableHead className="text-white font-bold text-right">فنى المنطقة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repDetailFiltered.map((r, i) => (
                    <TableRow key={`${r.complainNo}-${i}`}
                      className={`hover:bg-purple-50 ${i > 0 && repDetailFiltered[i-1].phoneNumber === r.phoneNumber ? "border-t-0" : "border-t-2 border-purple-200"}`}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-bold text-purple-900">{r.phoneNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.subName ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={r.subAdd ?? ""}>{r.subAdd ?? "—"}</TableCell>
                      <TableCell>{r.centralName}</TableCell>
                      <TableCell>{r.lineCabin ?? r.cabinetNo}</TableCell>
                      <TableCell>{r.lineBox ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.msanCode ?? "—"}</TableCell>
                      <TableCell>{r.frame ?? "—"}</TableCell>
                      <TableCell>
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800">{r.appearances} مرات</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.complainNo}</TableCell>
                      <TableCell dir="ltr" className="text-right">{r.complainTime ? new Date(r.complainTime).toLocaleDateString("ar-EG") : ""}</TableCell>
                      <TableCell dir="ltr" className="text-right">{r.closeTime ? new Date(r.closeTime).toLocaleDateString("ar-EG") : ""}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {r.closeCode ? (
                          <span title={`كود ${r.closeCode}`}>{closeReason(r.closeCode) || `كود ${r.closeCode}`}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        {editingTech === r.complainNo ? (
                          <span className="inline-flex items-center gap-1">
                            <SearchableCombobox
                              options={techNameOptions}
                              value={editTechDraft}
                              onChange={setEditTechDraft}
                              placeholder="اختر اسم الفنى"
                              searchPlaceholder="ابحث عن فنى..."
                              className="w-40 text-xs"
                            />
                            <button
                              onClick={() => handleSaveCloseTech(r.complainNo)}
                              disabled={savingTech || !editTechDraft.trim()}
                              className="text-green-600 hover:text-green-800 disabled:opacity-40"
                              title="حفظ"
                            >
                              {savingTech ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            </button>
                            <button onClick={() => setEditingTech(null)} className="text-gray-400 hover:text-gray-600" title="إلغاء">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <span>{r.closeByName || "غير معروف"}</span>
                            {canEditTech && (!r.closeByName || r.closeByName === "غير معروف") && (
                              <button
                                onClick={() => { setEditingTech(r.complainNo); setEditTechDraft(r.closeByName === "غير معروف" ? "" : (r.closeByName ?? "")); }}
                                className="text-amber-500 hover:text-amber-700"
                                title="تعيين فنى الإغلاق يدوياً"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{r.areaTechName}</TableCell>
                    </TableRow>
                  ))}
                  {repDetailFiltered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={14} className="text-center text-muted-foreground py-6">لا توجد خطوط مكررة</TableCell>
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

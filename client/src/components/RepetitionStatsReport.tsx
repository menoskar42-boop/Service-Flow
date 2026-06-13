import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer } from "lucide-react";
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

  return (
    <div className="space-y-6" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">من</span>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm w-auto" dir="ltr" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">إلى</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm w-auto" dir="ltr" />
        </div>
        <div className="flex rounded-lg border overflow-hidden text-xs">
          {(["combined", "closed", "open"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
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
            { label: "خطوط مكررة",        value: ov.repeatedPhones, sub: `مرات تكرار: ${ov.repCharges}` },
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
            <CardTitle className="text-sm font-bold">إحصائيات التكرار بالفنى (إجمالى الإدارة)</CardTitle>
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
                {activeData.byTechOnly.map(r => (
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
                {activeData.byTech.map(r => (
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
    </div>
  );
}

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

interface StatsData {
  overall: StatRow | null;
  byCentral: StatRow[];
  byTech: StatRow[];
  byTechOnly: StatRow[];
  _diag?: DiagInfo;
}

const pctBadge = (pct: number) => {
  const cls =
    pct >= 80 ? "bg-green-100 text-green-800" :
    pct >= 50 ? "bg-yellow-100 text-yellow-800" :
                "bg-red-100 text-red-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{pct}%</span>;
};

export function RemovalStatsReport() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo,   setDateTo]   = useState(today);

  const { data, isFetching } = useQuery<StatsData>({
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

  const ov = data?.overall;

  const handleExportExcel = () => {
    if (!data) return;
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
    const ws2 = XLSX.utils.json_to_sheet(data.byCentral.map(r => ({
      "السنترال": r.centralName,
      "إجمالى": r.total,
      "إزالة 24 ساعة": r.within24h, "نسبة 24 ساعة": `${r.pct24h}%`,
      "إزالة 48 ساعة": r.within48h, "نسبة 48 ساعة": `${r.pct48h}%`,
      "إزالة 120 ساعة": r.within120h, "نسبة 120 ساعة": `${r.pct120h}%`,
    })));
    XLSX.utils.book_append_sheet(wb, ws2, "بالسنترال");

    // شيت بالفنى
    const ws3 = XLSX.utils.json_to_sheet(data.byTech.map(r => ({
      "السنترال": r.centralName, "الفنى": r.techName,
      "إجمالى": r.total,
      "إزالة 24 ساعة": r.within24h, "نسبة 24 ساعة": `${r.pct24h}%`,
      "إزالة 48 ساعة": r.within48h, "نسبة 48 ساعة": `${r.pct48h}%`,
      "إزالة 120 ساعة": r.within120h, "نسبة 120 ساعة": `${r.pct120h}%`,
    })));
    XLSX.utils.book_append_sheet(wb, ws3, "بالفنى");

    XLSX.writeFile(wb, `removal-stats-${dateFrom}-${dateTo}.xlsx`);
  };

  const handleExportPDF = () => {
    if (!data) return;
    const title = `إحصائيات الإزالة — ${dateFrom} إلى ${dateTo}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const thStyle = `background:#1e50a0!important;color:#fff!important;padding:5px 4px;border:1px solid #15407f;font-size:10px;text-align:right`;
    const tdStyle = `border:1px solid #ccc;padding:4px;text-align:right;font-size:10px`;
    const pctStyle = (p: number) =>
      `background:${p >= 80 ? "#dcfce7" : p >= 50 ? "#fef9c3" : "#fee2e2"}!important;color:${p >= 80 ? "#166534" : p >= 50 ? "#854d0e" : "#991b1b"};font-weight:600;text-align:center`;

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
          <td style="${tdStyle}">${ov.within24h}</td><td style="${pctStyle(Number(ov.pct24h))};${tdStyle}">${ov.pct24h}%</td>
          <td style="${tdStyle}">${ov.within48h}</td><td style="${pctStyle(Number(ov.pct48h))};${tdStyle}">${ov.pct48h}%</td>
          <td style="${tdStyle}">${ov.within120h}</td><td style="${pctStyle(Number(ov.pct120h))};${tdStyle}">${ov.pct120h}%</td>
        </tr></tbody>
      </table>` : "";

    const centralRows = data.byCentral.map(r => `<tr>
      <td style="${tdStyle}">${esc(r.centralName)}</td>
      <td style="${tdStyle}">${r.total}</td>
      <td style="${tdStyle}">${r.within24h}</td><td style="${pctStyle(Number(r.pct24h))};${tdStyle}">${r.pct24h}%</td>
      <td style="${tdStyle}">${r.within48h}</td><td style="${pctStyle(Number(r.pct48h))};${tdStyle}">${r.pct48h}%</td>
      <td style="${tdStyle}">${r.within120h}</td><td style="${pctStyle(Number(r.pct120h))};${tdStyle}">${r.pct120h}%</td>
    </tr>`).join("");

    const techRows = data.byTech.map(r => `<tr>
      <td style="${tdStyle}">${esc(r.centralName)}</td>
      <td style="${tdStyle}">${esc(r.techName)}</td>
      <td style="${tdStyle}">${r.total}</td>
      <td style="${tdStyle}">${r.within24h}</td><td style="${pctStyle(Number(r.pct24h))};${tdStyle}">${r.pct24h}%</td>
      <td style="${tdStyle}">${r.within48h}</td><td style="${pctStyle(Number(r.pct48h))};${tdStyle}">${r.pct48h}%</td>
      <td style="${tdStyle}">${r.within120h}</td><td style="${pctStyle(Number(r.pct120h))};${tdStyle}">${r.pct120h}%</td>
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
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!data || !ov}
          className="text-green-700 border-green-200 gap-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!data || !ov}
          className="text-red-700 border-red-200 gap-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      {/* إجمالى */}
      {ov && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "إزالة خلال 24 ساعة", count: ov.within24h, pct: ov.pct24h, color: "green" },
            { label: "إزالة خلال 48 ساعة", count: ov.within48h, pct: ov.pct48h, color: "yellow" },
            { label: "إزالة خلال 120 ساعة", count: ov.within120h, pct: ov.pct120h, color: "blue" },
          ].map(({ label, count, pct, color }) => (
            <Card key={label} className="border-0 shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground font-normal">{label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className={`text-2xl font-bold text-${color}-600`}>{count}</div>
                <div className="text-xs text-muted-foreground mt-0.5">من إجمالى {ov.total} — {pct}%</div>
                <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-2 bg-${color}-500 rounded-full`} style={{ width: `${Math.min(100, Number(pct))}%` }} />
                </div>
              </CardContent>
            </Card>
          ))}
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
      {data && data.byTechOnly.length > 0 && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <CardHeader className="pb-2 bg-blue-900 text-white rounded-t-lg px-4 py-3">
            <CardTitle className="text-sm font-bold">إحصائيات بالفنى (إجمالى الإدارة)</CardTitle>
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
                {data.byTechOnly.map(r => (
                  <TableRow key={r.techName} className="hover:bg-green-50">
                    <TableCell className="font-medium">{r.techName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.within24h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct24h))}</TableCell>
                    <TableCell>{r.within48h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct48h))}</TableCell>
                    <TableCell>{r.within120h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct120h))}</TableCell>
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
      {data && data.byCentral.length > 0 && (
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
                {data.byCentral.map(r => (
                  <TableRow key={r.centralName} className="hover:bg-blue-50">
                    <TableCell className="font-medium">{r.centralName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.within24h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct24h))}</TableCell>
                    <TableCell>{r.within48h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct48h))}</TableCell>
                    <TableCell>{r.within120h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct120h))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* بالفنى */}
      {data && data.byTech.length > 0 && (
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
                {data.byTech.map(r => (
                  <TableRow key={`${r.centralName}-${r.techName}`} className="hover:bg-green-50">
                    <TableCell>{r.centralName}</TableCell>
                    <TableCell className="font-medium">{r.techName}</TableCell>
                    <TableCell className="font-bold">{r.total}</TableCell>
                    <TableCell>{r.within24h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct24h))}</TableCell>
                    <TableCell>{r.within48h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct48h))}</TableCell>
                    <TableCell>{r.within120h}</TableCell>
                    <TableCell>{pctBadge(Number(r.pct120h))}</TableCell>
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

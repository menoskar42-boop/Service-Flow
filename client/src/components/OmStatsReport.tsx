import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer } from "lucide-react";

interface TechRow {
  techName: string;
  soyTotal: number;
  currentTotal: number;
  resolved: number;
  pctResolved: number;
}
interface CabinetRow extends Omit<TechRow, "techName"> {
  msanCode: string;
  centralName: string | null;
  techName: string | null;
}
interface Overall {
  soyTotal: number;
  currentTotal: number;
  resolved: number;
  pctResolved: number;
}
interface StatsData {
  byTech: TechRow[];
  byCabinet: CabinetRow[];
  overall: Overall;
}

// نسبة التحقيق: أخضر ≥ 70% / بينك ≥ 40% / أحمر أقل.
const pctBadge = (pct: number) => {
  const cls =
    pct >= 70 ? "bg-green-100 text-green-800" :
    pct >= 40 ? "bg-pink-100 text-pink-700" :
                "bg-red-100 text-red-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{pct}%</span>;
};

export function OmStatsReport() {
  const [activeTab, setActiveTab] = useState<"tech" | "cabinet">("tech");

  const { data, isFetching } = useQuery<StatsData>({
    queryKey: ["/api/reports/om-stats"],
    queryFn: async () => {
      const res = await fetch("/api/reports/om-stats", { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const ov = data?.overall;

  const handleExportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const wsT = XLSX.utils.json_to_sheet(data.byTech.map((r) => ({
      "الفنى": r.techName,
      "متعذرات بداية الفترة": r.soyTotal,
      "المتعذرات الحالية": r.currentTotal,
      "تم فكها": r.resolved,
      "نسبة التحقيق": `${r.pctResolved}%`,
    })));
    XLSX.utils.book_append_sheet(wb, wsT, "لكل فنى");
    const wsC = XLSX.utils.json_to_sheet(data.byCabinet.map((r) => ({
      "السنترال": r.centralName ?? "",
      "كود MSAN": r.msanCode,
      "الفنى": r.techName ?? "غير معروف",
      "متعذرات بداية الفترة": r.soyTotal,
      "المتعذرات الحالية": r.currentTotal,
      "تم فكها": r.resolved,
      "نسبة التحقيق": `${r.pctResolved}%`,
    })));
    XLSX.utils.book_append_sheet(wb, wsC, "لكل كابينة");
    XLSX.writeFile(wb, `om-stats-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportPDF = () => {
    if (!data) return;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const thStyle = `background:#1e50a0!important;color:#fff!important;padding:5px 4px;border:1px solid #15407f;font-size:10px;text-align:right`;
    const tdStyle = `border:1px solid #ccc;padding:4px;text-align:right;font-size:10px`;
    const pctStyle = (p: number) =>
      `background:${p >= 70 ? "#dcfce7" : p >= 40 ? "#fce7f3" : "#fee2e2"}!important;color:${p >= 70 ? "#166534" : p >= 40 ? "#9d174d" : "#991b1b"};font-weight:600;text-align:center`;

    const techRows = data.byTech.map((r) => `<tr>
      <td style="${tdStyle}">${esc(r.techName)}</td>
      <td style="${tdStyle}">${r.soyTotal}</td>
      <td style="${tdStyle}">${r.currentTotal}</td>
      <td style="${tdStyle}">${r.resolved}</td>
      <td style="${pctStyle(Number(r.pctResolved))};${tdStyle}">${r.pctResolved}%</td>
    </tr>`).join("");
    const overallTechRow = ov ? `<tr>
      <td style="${tdStyle};font-weight:bold;background:#1e3a5f!important;color:#fff!important">إجمالى الإدارة</td>
      <td style="${tdStyle};font-weight:bold">${ov.soyTotal}</td>
      <td style="${tdStyle};font-weight:bold">${ov.currentTotal}</td>
      <td style="${tdStyle};font-weight:bold">${ov.resolved}</td>
      <td style="${pctStyle(Number(ov.pctResolved))};${tdStyle};font-weight:bold">${ov.pctResolved}%</td>
    </tr>` : "";

    const cabRows = data.byCabinet.map((r) => `<tr>
      <td style="${tdStyle}">${esc(r.centralName)}</td>
      <td style="${tdStyle}">${esc(r.msanCode)}</td>
      <td style="${tdStyle}">${esc(r.techName ?? "غير معروف")}</td>
      <td style="${tdStyle}">${r.soyTotal}</td>
      <td style="${tdStyle}">${r.currentTotal}</td>
      <td style="${tdStyle}">${r.resolved}</td>
      <td style="${pctStyle(Number(r.pctResolved))};${tdStyle}">${r.pctResolved}%</td>
    </tr>`).join("");

    const title = "إحصائية متعذرات OM";
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
        <h3>لكل فنى</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <thead><tr>
            <th style="${thStyle}">الفنى</th>
            <th style="${thStyle}">متعذرات بداية الفترة</th>
            <th style="${thStyle}">المتعذرات الحالية</th>
            <th style="${thStyle}">تم فكها</th>
            <th style="${thStyle}">نسبة التحقيق</th>
          </tr></thead>
          <tbody>${techRows}${overallTechRow}</tbody>
        </table>
        <h3>لكل كابينة</h3>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="${thStyle}">السنترال</th>
            <th style="${thStyle}">كود MSAN</th>
            <th style="${thStyle}">الفنى</th>
            <th style="${thStyle}">متعذرات بداية الفترة</th>
            <th style="${thStyle}">المتعذرات الحالية</th>
            <th style="${thStyle}">تم فكها</th>
            <th style="${thStyle}">نسبة التحقيق</th>
          </tr></thead>
          <tbody>${cabRows}</tbody>
        </table>
      </div></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-bold">إحصائية متعذرات OM</h2>
        {/* تبديل التابات */}
        <div className="flex rounded-lg border overflow-hidden text-xs">
          {(["tech", "cabinet"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                activeTab === tab ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab === "tech" ? "لكل فنى" : "لكل كابينة"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!data}
          className="text-green-700 border-green-200 gap-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!data}
          className="text-red-700 border-red-200 gap-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      {/* بطاقات الإجمالى */}
      {ov && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "متعذرات بداية الفترة", value: ov.soyTotal, cls: "text-blue-700" },
            { label: "المتعذرات الحالية", value: ov.currentTotal, cls: "text-amber-700" },
            { label: "تم فكها", value: ov.resolved, cls: "text-green-700" },
            { label: "نسبة التحقيق", value: `${ov.pctResolved}%`, cls: "text-indigo-700" },
          ].map(({ label, value, cls }) => (
            <Card key={label} className="border-0 shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground font-normal">{label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className={`text-2xl font-bold ${cls}`}>{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!ov && !isFetching && (
        <div className="py-10 text-center text-muted-foreground bg-white rounded-lg border border-dashed">
          لا توجد بيانات — تأكد من رفع ملفات متعذرات OM (الحالى + بداية الفترة)
        </div>
      )}

      {/* تاب لكل فنى */}
      {activeTab === "tech" && data && data.byTech.length > 0 && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <CardHeader className="pb-2 bg-blue-900 text-white rounded-t-lg px-4 py-3">
            <CardTitle className="text-sm font-bold">إحصائية متعذرات OM — لكل فنى</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-blue-800">
                <TableRow>
                  <TableHead className="text-white font-bold text-right">الفنى</TableHead>
                  <TableHead className="text-white font-bold text-right">متعذرات بداية الفترة</TableHead>
                  <TableHead className="text-white font-bold text-right">المتعذرات الحالية</TableHead>
                  <TableHead className="text-white font-bold text-right">تم فكها</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة التحقيق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byTech.map((r) => (
                  <TableRow key={r.techName} className="hover:bg-green-50">
                    <TableCell className="font-medium">{r.techName}</TableCell>
                    <TableCell className="font-bold">{r.soyTotal}</TableCell>
                    <TableCell>{r.currentTotal}</TableCell>
                    <TableCell className="text-green-700 font-bold">{r.resolved}</TableCell>
                    <TableCell>{pctBadge(Number(r.pctResolved))}</TableCell>
                  </TableRow>
                ))}
                {ov && (
                  <TableRow className="bg-blue-900 text-white font-bold hover:bg-blue-800">
                    <TableCell className="text-white font-bold">إجمالى الإدارة</TableCell>
                    <TableCell className="text-white font-bold">{ov.soyTotal}</TableCell>
                    <TableCell className="text-white">{ov.currentTotal}</TableCell>
                    <TableCell className="text-white font-bold">{ov.resolved}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded font-semibold bg-white text-blue-900">{ov.pctResolved}%</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* تاب لكل كابينة */}
      {activeTab === "cabinet" && data && data.byCabinet.length > 0 && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <CardHeader className="pb-2 bg-blue-900 text-white rounded-t-lg px-4 py-3">
            <CardTitle className="text-sm font-bold">إحصائية متعذرات OM — لكل كابينة</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-blue-800">
                <TableRow>
                  <TableHead className="text-white font-bold text-right">السنترال</TableHead>
                  <TableHead className="text-white font-bold text-right">كود MSAN</TableHead>
                  <TableHead className="text-white font-bold text-right">الفنى</TableHead>
                  <TableHead className="text-white font-bold text-right">متعذرات بداية الفترة</TableHead>
                  <TableHead className="text-white font-bold text-right">المتعذرات الحالية</TableHead>
                  <TableHead className="text-white font-bold text-right">تم فكها</TableHead>
                  <TableHead className="text-white font-bold text-right">نسبة التحقيق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byCabinet.map((r, i) => (
                  <TableRow key={`${r.msanCode}-${i}`} className="hover:bg-blue-50">
                    <TableCell>{r.centralName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.msanCode}</TableCell>
                    <TableCell className="font-medium">{r.techName ?? "غير معروف"}</TableCell>
                    <TableCell className="font-bold">{r.soyTotal}</TableCell>
                    <TableCell>{r.currentTotal}</TableCell>
                    <TableCell className="text-green-700 font-bold">{r.resolved}</TableCell>
                    <TableCell>{pctBadge(Number(r.pctResolved))}</TableCell>
                  </TableRow>
                ))}
                {ov && (
                  <TableRow className="bg-blue-900 text-white font-bold hover:bg-blue-800">
                    <TableCell className="text-white font-bold" colSpan={3}>إجمالى الإدارة</TableCell>
                    <TableCell className="text-white font-bold">{ov.soyTotal}</TableCell>
                    <TableCell className="text-white">{ov.currentTotal}</TableCell>
                    <TableCell className="text-white font-bold">{ov.resolved}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded font-semibold bg-white text-blue-900">{ov.pctResolved}%</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

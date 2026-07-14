import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer } from "lucide-react";
import { format } from "date-fns";

interface PlanRow {
  centralName: string;
  cabinNumber: string;
  msanCode: string;
  copperCabinets: number;
  workingAdsl: number;
  boxCount: number;
  workingLines: number;
  capacity: number;
  faultCount: number;
  perThousand: number;
  sector: string;
  region: string;
  centralCode: string;
  maintenanceMonth: string;
}

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function MaintenancePlanH2Report() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState("2026-01-01");
  const [dateTo,   setDateTo]   = useState(today);
  const [central,  setCentral]  = useState("");

  const buildParams = () => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo)   p.set("dateTo",   dateTo);
    if (central)  p.set("central",  central);
    return p;
  };

  const { data: rows = [], isFetching } = useQuery<PlanRow[]>({
    queryKey: ["/api/reports/maintenance-plan-h2", dateFrom, dateTo, central],
    queryFn: async () => {
      const res = await fetch(`/api/reports/maintenance-plan-h2?${buildParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  // أعمدة النموذج "plan 2026- H2" + عرض كل عمود
  const HEADERS: [string, number][] = [
    ["رئاسة القطاعات", 16], ["القطاع", 16], ["المنطقة", 20], ["السنترال", 20],
    ["كود السنترال", 12], ["كود كابينة MSAN", 16], ["تاريخ الصيانه", 12], ["السعة", 10],
    ["الشغال", 10], ["اجمالى عدد الكبائن النحاسية المربوطة على MSAN", 20],
    ["اجمالى عدد البكسيات المربوطة على MSAN", 20], ["الشغال DATA", 12], ["الإدارة", 12],
  ];
  // رئاسة القطاعات = القطاعات الجنوبية، الإدارة = الغنايم (قيم ثابتة) — بنفس ترتيب النموذج الأصلى
  const rowValues = (r: PlanRow) => [
    "القطاعات الجنوبية", r.sector, r.region, r.centralName, r.centralCode, r.msanCode,
    r.maintenanceMonth, r.capacity, r.workingLines, r.copperCabinets,
    r.boxCount, r.workingAdsl, "الغنايم",
  ];

  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("plan 2026- H2", {
      views: [{ rightToLeft: true }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9,
        margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
    });
    const border = {
      top: { style: "thin" as const, color: { argb: "FFBFBFBF" } },
      bottom: { style: "thin" as const, color: { argb: "FFBFBFBF" } },
      left: { style: "thin" as const, color: { argb: "FFBFBFBF" } },
      right: { style: "thin" as const, color: { argb: "FFBFBFBF" } },
    };
    // ترويسة ملوّنة
    const header = ws.addRow(HEADERS.map(([h]) => h));
    header.height = 44;
    header.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E50A0" } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = border;
    });
    // الصفوف
    rows.forEach((r, i) => {
      const row = ws.addRow(rowValues(r));
      row.eachCell((c) => {
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.border = border;
        if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FB" } };
      });
    });
    ws.columns.forEach((col, idx) => { col.width = HEADERS[idx]?.[1] ?? 14; });
    ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `خطة-الصيانة-النصف-الثانى-${dateTo}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = () => {
    const title = "خطة الصيانة للنصف الثانى من العام 2026";
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const head = `<th>#</th><th>القطاع</th><th>المنطقة</th><th>السنترال</th><th>كود كابينة MSAN</th><th>تاريخ الصيانه</th><th>الشغال</th><th>عدد الكباين النحاسية</th><th>عدد البكسيات</th><th>الشغال DATA</th><th>عدد الأعطال</th><th>أعطال / الألف</th>`;
    const body = rows.map((r, i) => `<tr>
        <td>${i + 1}</td><td>${esc(r.sector)}</td><td>${esc(r.region)}</td><td>${esc(r.centralName)}</td>
        <td>${esc(r.msanCode)}</td><td>${esc(r.maintenanceMonth)}</td><td>${esc(r.workingLines)}</td>
        <td>${esc(r.copperCabinets)}</td><td>${esc(r.boxCount)}</td><td>${esc(r.workingAdsl)}</td>
        <td>${esc(r.faultCount)}</td><td>${esc(r.perThousand)}</td>
      </tr>`).join("");
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 16px; margin: 0 0 8px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 7px 4px; border: 1px solid #15407f; font-size: 12px; }
        td { border: 1px solid #ccc; padding: 5px 4px; text-align: center; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        .page { background: #fff; padding: 14px; margin: 12px auto; max-width: 1100px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; display: flex; gap: 10px; align-items: center; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
        @media print { body { background: #fff; } .toolbar { display: none; } .page { box-shadow: none; margin: 0; max-width: none; } @page { size: A4 landscape; margin: 10mm; } }
      </style></head><body>
      <div class="toolbar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>اختر "حفظ بصيغة PDF" كوجهة الطباعة.</span></div>
      <section class="page"><h2>${esc(title)}</h2>
        <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      </section></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap items-end gap-2 w-full sm:w-auto">
            <div className="flex-1 sm:flex-none">
              <label className="text-xs text-muted-foreground block mb-1">من تاريخ</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-40 text-sm" />
            </div>
            <div className="flex-1 sm:flex-none">
              <label className="text-xs text-muted-foreground block mb-1">إلى تاريخ</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-40 text-sm" />
            </div>
          </div>
          <select
            value={central}
            onChange={(e) => setCentral(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm w-full sm:w-auto"
            dir="rtl"
          >
            <option value="">كل السنترالات</option>
            {CENTRALS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex-1" />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={rows.length === 0} className="text-green-700 border-green-200 gap-1">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={rows.length === 0} className="text-red-700 border-red-200 gap-1">
            <Printer className="w-4 h-4" /> PDF
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          الكباين المختارة: عدد أعطالها أكبر من 70 وأعطالها/الألف أكبر من 30 — مرتبة تنازلياً حسب أعطال الألف.
          التوزيع: أغسطس (كابينة) — أكتوبر (كابينة) — ديسمبر (كابينتان).
        </p>
      </Card>

      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-10">#</TableHead>
                <TableHead className="text-right font-bold">القطاع</TableHead>
                <TableHead className="text-right font-bold">المنطقة</TableHead>
                <TableHead className="text-right font-bold">السنترال</TableHead>
                <TableHead className="text-right font-bold">كود السنترال</TableHead>
                <TableHead className="text-right font-bold">كود كابينة MSAN</TableHead>
                <TableHead className="text-right font-bold">تاريخ الصيانه</TableHead>
                <TableHead className="text-right font-bold">السعة</TableHead>
                <TableHead className="text-right font-bold">الشغال</TableHead>
                <TableHead className="text-right font-bold">الكباين النحاسية</TableHead>
                <TableHead className="text-right font-bold">البكسيات</TableHead>
                <TableHead className="text-right font-bold">الشغال DATA</TableHead>
                <TableHead className="text-right font-bold">عدد الأعطال</TableHead>
                <TableHead className="text-right font-bold">أعطال / الألف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center py-14 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد كباين مطابقة للشروط (أعطال > 70 و أعطال/الألف > 30)"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, idx) => (
                  <TableRow key={`${r.msanCode}-${idx}`} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.sector}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.region}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>
                    <TableCell className="font-mono text-xs">{r.centralCode}</TableCell>
                    <TableCell className="font-mono text-xs">{r.msanCode}</TableCell>
                    <TableCell className="font-bold text-purple-700">{r.maintenanceMonth}</TableCell>
                    <TableCell className="text-center font-semibold">{r.capacity}</TableCell>
                    <TableCell className="text-center">{r.workingLines}</TableCell>
                    <TableCell className="text-center">{r.copperCabinets}</TableCell>
                    <TableCell className="text-center">{r.boxCount}</TableCell>
                    <TableCell className="text-center font-bold text-green-700">{r.workingAdsl}</TableCell>
                    <TableCell className="text-center font-bold text-red-700">{r.faultCount}</TableCell>
                    <TableCell className="text-center font-bold text-blue-700">{r.perThousand}</TableCell>
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

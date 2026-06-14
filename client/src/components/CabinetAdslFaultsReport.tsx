import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer } from "lucide-react";
import { format } from "date-fns";

interface Row {
  centralName: string;
  cabinNumber: string;
  msanCode: string;
  techName: string;
  workingAdsl: number;
  faultCount: number;
}

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function CabinetAdslFaultsReport() {
  const today      = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo,   setDateTo]   = useState(today);
  const [central, setCentral]   = useState("");
  const [q, setQ]               = useState("");

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/reports/cabinet-adsl-faults", dateFrom, dateTo, central, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo",   dateTo);
      if (central)  p.set("central",  central);
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch(`/api/reports/cabinet-adsl-faults?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const totWorking = rows.reduce((s, r) => s + (Number(r.workingAdsl) || 0), 0);
  const totFaults  = rows.reduce((s, r) => s + (Number(r.faultCount) || 0), 0);
  // عدد الأعطال لكل 1000 مشترك = (الأعطال × 1000 ÷ الشغال) مقرّباً لرقمين عشريين
  const per1000 = (f: number, w: number) => (Number(w) > 0 ? Math.round((Number(f) * 1000 / Number(w)) * 100) / 100 : 0);
  const totPer1000 = per1000(totFaults, totWorking);
  // ترتيب تنازلى حسب عدد الأعطال فى الألف لكل كابينة (الأعلى أولاً)
  const sortedRows = [...rows].sort((a, b) => per1000(b.faultCount, b.workingAdsl) - per1000(a.faultCount, a.workingAdsl));

  const handleExportExcel = () => {
    const data: any[] = sortedRows.map((r, i) => ({
      "#": i + 1,
      "السنترال": r.centralName,
      "رقم الكابينة": r.cabinNumber,
      "كود الكابينة (MSAN)": r.msanCode,
      "اسم الفنى": r.techName,
      "الشغال ADSL": r.workingAdsl,
      "عدد الأعطال": r.faultCount,
      "أعطال لكل 1000 مشترك": per1000(r.faultCount, r.workingAdsl),
    }));
    data.push({
      "#": "", "السنترال": "إجمالى الإدارة", "رقم الكابينة": "", "كود الكابينة (MSAN)": "",
      "اسم الفنى": "", "الشغال ADSL": totWorking, "عدد الأعطال": totFaults, "أعطال لكل 1000 مشترك": totPer1000,
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الكباين");
    XLSX.writeFile(wb, `cabinet-adsl-faults-${dateFrom}-${dateTo}.xlsx`);
  };

  const handleExportPDF = () => {
    const title = `تقرير عدد الأعطال فى الألف لكل كابينة — ${dateFrom} إلى ${dateTo}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 22;
    const total = Math.max(1, Math.ceil(sortedRows.length / ROWS_PER_PAGE));
    let pages = "";
    for (let pg = 0; pg < total; pg++) {
      const chunk = sortedRows.slice(pg * ROWS_PER_PAGE, (pg + 1) * ROWS_PER_PAGE);
      let body = chunk.map((r, ci) => `
        <tr>
          <td>${pg * ROWS_PER_PAGE + ci + 1}</td>
          <td>${esc(r.centralName)}</td>
          <td>${esc(r.cabinNumber)}</td>
          <td>${esc(r.msanCode)}</td>
          <td>${esc(r.techName)}</td>
          <td>${esc(r.workingAdsl)}</td>
          <td>${esc(r.faultCount)}</td>
          <td>${esc(per1000(r.faultCount, r.workingAdsl))}</td>
        </tr>`).join("");
      if (pg === total - 1) {
        body += `<tr class="total">
          <td colspan="5">إجمالى الإدارة</td>
          <td>${esc(totWorking)}</td>
          <td>${esc(totFaults)}</td>
          <td>${esc(totPer1000)}</td>
        </tr>`;
      }
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          <div class="pageno">صفحة ${pg + 1} من ${total}</div>
          <table>
            <thead><tr><th>#</th><th>السنترال</th><th>رقم الكابينة</th><th>كود الكابينة (MSAN)</th><th>اسم الفنى</th><th>الشغال ADSL</th><th>عدد الأعطال</th><th>أعطال / 1000 مشترك</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 15px; margin: 0 0 4px; }
        .pageno { text-align: center; font-size: 10px; color: #64748b; margin-bottom: 8px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 7px 4px; border: 1px solid #15407f; font-size: 12px; }
        td { border: 1px solid #ccc; padding: 5px 4px; text-align: center; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        tr.total td { background: #1e50a0 !important; color: #fff !important; font-weight: bold; }
        .page { background: #fff; padding: 14px; margin: 12px auto; max-width: 900px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; display: flex; gap: 10px; align-items: center; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
        @media print { body { background: #fff; } .toolbar { display: none; } .page { box-shadow: none; margin: 0; max-width: none; page-break-after: always; } @page { size: A4 portrait; margin: 10mm; } }
      </style></head><body>
      <div class="toolbar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>اختر "حفظ بصيغة PDF" كوجهة الطباعة.</span></div>
      ${pages}</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
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
          <Input
            placeholder="بحث برقم الكابينة / كود الكابينة / الفنى"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:max-w-xs text-sm"
            dir="rtl"
          />
          <div className="flex-1" />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={rows.length === 0} className="text-green-700 border-green-200 gap-1">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={rows.length === 0} className="text-red-700 border-red-200 gap-1">
            <Printer className="w-4 h-4" /> PDF
          </Button>
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-white p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-foreground">{rows.length}</div>
          <div className="text-xs text-muted-foreground mt-1">عدد الكباين</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-green-700">{totWorking}</div>
          <div className="text-xs text-green-700 mt-1">إجمالى الشغال ADSL</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-red-700">{totFaults}</div>
          <div className="text-xs text-red-700 mt-1">إجمالى الأعطال</div>
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-10">#</TableHead>
                <TableHead className="text-right font-bold">السنترال</TableHead>
                <TableHead className="text-right font-bold">رقم الكابينة</TableHead>
                <TableHead className="text-right font-bold">كود الكابينة (MSAN)</TableHead>
                <TableHead className="text-right font-bold">اسم الفنى</TableHead>
                <TableHead className="text-right font-bold">الشغال ADSL</TableHead>
                <TableHead className="text-right font-bold">عدد الأعطال</TableHead>
                <TableHead className="text-right font-bold">أعطال / ١٠٠٠ مشترك</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-14 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد بيانات — تأكد من رفع ملف الفنيين بأرقام الكباين وملف مشتركى FTTH/ADSL"}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sortedRows.map((r, idx) => (
                    <TableRow key={`${r.centralName}-${r.cabinNumber}-${r.msanCode}-${idx}`} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>
                      <TableCell className="font-semibold">{r.cabinNumber}</TableCell>
                      <TableCell className="font-mono text-xs">{r.msanCode}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.techName}</TableCell>
                      <TableCell className="text-center font-bold text-green-700">{r.workingAdsl}</TableCell>
                      <TableCell className="text-center font-bold text-red-700">{r.faultCount}</TableCell>
                      <TableCell className="text-center font-bold text-blue-700">{per1000(r.faultCount, r.workingAdsl)}</TableCell>
                    </TableRow>
                  ))}
                  {/* إجمالى الإدارة */}
                  <TableRow className="bg-blue-900 hover:bg-blue-900">
                    <TableCell colSpan={5} className="text-white font-bold text-center">إجمالى الإدارة</TableCell>
                    <TableCell className="text-center text-white font-bold">{totWorking}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totFaults}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totPer1000}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

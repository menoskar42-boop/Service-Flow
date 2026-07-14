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

interface CapacityRow {
  centralName: string | null;
  exchCode: string | null;
  cabinNumber: string | null;
  cabinetType: string | null;
  primaryCapacity: number | null;
  secondaryCapacity: number | null;
}

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function CabinetCapacityReport() {
  const [central, setCentral] = useState("");
  const [q, setQ] = useState("");

  const { data: rows = [], isFetching } = useQuery<CapacityRow[]>({
    queryKey: ["/api/cabinet-capacity", q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch(`/api/cabinet-capacity?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const filtered = rows.filter((r) => !central || r.centralName === central);
  const totPrimary   = filtered.reduce((s, r) => s + (Number(r.primaryCapacity) || 0), 0);
  const totSecondary = filtered.reduce((s, r) => s + (Number(r.secondaryCapacity) || 0), 0);

  const handleExportExcel = () => {
    const data = filtered.map((r, i) => ({
      "#": i + 1,
      "السنترال": r.centralName,
      "كود السنترال": r.exchCode,
      "رقم الكابينة": r.cabinNumber,
      "نوع الكابينة": r.cabinetType,
      "السعة الابتدائية": r.primaryCapacity,
      "السعة الثانوية": r.secondaryCapacity,
    }));
    data.push({
      "#": "" as any, "السنترال": "الإجمالى", "كود السنترال": "", "رقم الكابينة": "",
      "نوع الكابينة": "", "السعة الابتدائية": totPrimary, "السعة الثانوية": totSecondary,
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سعة الكباين");
    XLSX.writeFile(wb, `سعة-الكباين.xlsx`);
  };

  const handleExportPDF = () => {
    const title = "السعة الابتدائية والثانوية للكباين";
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const head = `<th>#</th><th>السنترال</th><th>كود السنترال</th><th>رقم الكابينة</th><th>نوع الكابينة</th><th>السعة الابتدائية</th><th>السعة الثانوية</th>`;
    const body = filtered.map((r, i) => `<tr>
        <td>${i + 1}</td><td>${esc(r.centralName)}</td><td>${esc(r.exchCode)}</td><td>${esc(r.cabinNumber)}</td>
        <td>${esc(r.cabinetType)}</td><td>${esc(r.primaryCapacity)}</td><td>${esc(r.secondaryCapacity)}</td>
      </tr>`).join("");
    const totalRow = `<tr class="total"><td colspan="5">الإجمالى</td><td>${esc(totPrimary)}</td><td>${esc(totSecondary)}</td></tr>`;
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 15px; margin: 0 0 8px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 7px 4px; border: 1px solid #15407f; }
        td { border: 1px solid #ccc; padding: 5px 4px; text-align: center; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        tr.total td { background: #1e50a0 !important; color: #fff !important; font-weight: bold; }
        .page { background: #fff; padding: 14px; margin: 12px auto; max-width: 900px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
        @media print { body { background: #fff; } .toolbar { display: none; } .page { box-shadow: none; margin: 0; max-width: none; } @page { size: A4; margin: 10mm; } }
      </style></head><body>
      <div class="toolbar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button></div>
      <section class="page"><h2>${esc(title)}</h2>
        <table><thead><tr>${head}</tr></thead><tbody>${body}${totalRow}</tbody></table>
      </section></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
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
            placeholder="بحث برقم الكابينة / النوع / كود السنترال"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:max-w-xs text-sm"
            dir="rtl"
          />
          <div className="flex-1" />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={filtered.length === 0} className="text-green-700 border-green-200 gap-1">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={filtered.length === 0} className="text-red-700 border-red-200 gap-1">
            <Printer className="w-4 h-4" /> PDF
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-white p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-foreground">{filtered.length}</div>
          <div className="text-xs text-muted-foreground mt-1">عدد الكباين</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-blue-700">{totPrimary}</div>
          <div className="text-xs text-blue-700 mt-1">إجمالى السعة الابتدائية</div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-emerald-700">{totSecondary}</div>
          <div className="text-xs text-emerald-700 mt-1">إجمالى السعة الثانوية</div>
        </div>
      </div>

      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-10">#</TableHead>
                <TableHead className="text-right font-bold">السنترال</TableHead>
                <TableHead className="text-right font-bold">كود السنترال</TableHead>
                <TableHead className="text-right font-bold">رقم الكابينة</TableHead>
                <TableHead className="text-right font-bold">نوع الكابينة</TableHead>
                <TableHead className="text-right font-bold">السعة الابتدائية</TableHead>
                <TableHead className="text-right font-bold">السعة الثانوية</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-14 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف سعة الكباين من قسم رفع الملفات"}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {filtered.map((r, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>
                      <TableCell className="font-mono text-xs">{r.exchCode}</TableCell>
                      <TableCell className="font-semibold">{r.cabinNumber}</TableCell>
                      <TableCell>{r.cabinetType}</TableCell>
                      <TableCell className="text-center font-bold text-blue-700">{r.primaryCapacity}</TableCell>
                      <TableCell className="text-center font-bold text-emerald-700">{r.secondaryCapacity}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-blue-900 hover:bg-blue-900">
                    <TableCell colSpan={5} className="text-white font-bold text-center">الإجمالى</TableCell>
                    <TableCell className="text-center text-white font-bold">{totPrimary}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totSecondary}</TableCell>
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

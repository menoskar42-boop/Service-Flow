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
  boxNumber: string;
  techName: string;
  workingLines: number;
  faultCount: number;
}

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function BoxFaultsReport() {
  const today      = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo,   setDateTo]   = useState(today);
  const [central, setCentral]   = useState("");
  const [q, setQ]               = useState("");
  const [minFaults, setMinFaults]       = useState("");
  const [minProjected, setMinProjected] = useState("");
  const [tab, setTab] = useState<"box" | "tech">("tech");
  const isTech = tab === "tech";

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/reports/box-faults", dateFrom, dateTo, central, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo",   dateTo);
      if (central)  p.set("central",  central);
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch(`/api/reports/box-faults?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const periodDays = (() => {
    if (!dateFrom || !dateTo) return 31;
    const d = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
    return d > 0 ? d : 1;
  })();
  const monthDays = (() => {
    if (!dateFrom || !dateTo) return 31;
    const [y1, m1] = dateFrom.split("-").map(Number);
    const [y2, m2] = dateTo.split("-").map(Number);
    if (y1 === y2 && m1 === m2) return new Date(y1, m1, 0).getDate();
    return 31;
  })();

  const per1000   = (f: number, w: number) => (Number(w) > 0 ? Math.round(Number(f) * 1000 / Number(w) * 100) / 100 : 0);
  const projected = (f: number, w: number) => (Number(w) > 0 ? Math.round(Number(f) / periodDays * monthDays * 1000 / Number(w) * 100) / 100 : 0);

  const passMin = (f: number, w: number) => {
    if (minFaults !== "" && !(Number(f) > Number(minFaults))) return false;
    if (minProjected !== "" && !(projected(f, w) > Number(minProjected))) return false;
    return true;
  };

  const boxRows = rows
    .filter((r) => passMin(r.faultCount, r.workingLines))
    .sort((a, b) => per1000(b.faultCount, b.workingLines) - per1000(a.faultCount, a.workingLines));

  const techRows = (() => {
    const m = new Map<string, { techName: string; workingLines: number; faultCount: number }>();
    for (const r of rows) {
      const key = r.techName || "غير معروف";
      const cur = m.get(key) ?? { techName: key, workingLines: 0, faultCount: 0 };
      cur.workingLines += Number(r.workingLines) || 0;
      cur.faultCount   += Number(r.faultCount) || 0;
      m.set(key, cur);
    }
    return Array.from(m.values())
      .filter((r) => passMin(r.faultCount, r.workingLines))
      .sort((a, b) => per1000(b.faultCount, b.workingLines) - per1000(a.faultCount, a.workingLines));
  })();

  const displayRows: any[] = isTech ? techRows : boxRows;
  const totWorking  = displayRows.reduce((s, r) => s + (Number(r.workingLines) || 0), 0);
  const totFaults   = displayRows.reduce((s, r) => s + (Number(r.faultCount) || 0), 0);
  const totPer1000  = per1000(totFaults, totWorking);
  const totProjected = projected(totFaults, totWorking);

  const handleExportExcel = () => {
    const metric = (r: any) => ({
      "عدد الخطوط": r.workingLines,
      "عدد الأعطال": r.faultCount,
      "أعطال لكل 1000 خط": per1000(r.faultCount, r.workingLines),
      "أعطال الألف المتوقع (نهاية الشهر)": projected(r.faultCount, r.workingLines),
    });
    const data: any[] = displayRows.map((r, i) => isTech
      ? { "#": i + 1, "اسم الفنى": r.techName, ...metric(r) }
      : { "#": i + 1, "السنترال": r.centralName, "رقم الكابينه": r.cabinNumber, "رقم البكس": r.boxNumber, "اسم الفنى": r.techName, ...metric(r) });
    const totMetric = { "عدد الخطوط": totWorking, "عدد الأعطال": totFaults, "أعطال لكل 1000 خط": totPer1000, "أعطال الألف المتوقع (نهاية الشهر)": totProjected };
    data.push(isTech
      ? { "#": "", "اسم الفنى": "إجمالى الإدارة", ...totMetric }
      : { "#": "", "السنترال": "إجمالى الإدارة", "رقم الكابينه": "", "رقم البكس": "", "اسم الفنى": "", ...totMetric });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isTech ? "بالفنى" : "البكسيات");
    XLSX.writeFile(wb, `box-faults-${isTech ? "tech" : "box"}-${dateFrom}-${dateTo}.xlsx`);
  };

  const handleExportPDF = () => {
    const title = `تقرير عدد الأعطال فى الألف ${isTech ? "لكل فنى" : "لكل بكس"} — ${dateFrom} إلى ${dateTo}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const head = isTech
      ? `<th>#</th><th>اسم الفنى</th><th>عدد الخطوط</th><th>عدد الأعطال</th><th>أعطال / 1000</th><th>متوقع نهاية الشهر</th>`
      : `<th>#</th><th>السنترال</th><th>رقم الكابينه</th><th>رقم البكس</th><th>اسم الفنى</th><th>عدد الخطوط</th><th>عدد الأعطال</th><th>أعطال / 1000</th><th>متوقع نهاية الشهر</th>`;
    const cells = (r: any, n: number) => {
      const m = `<td>${esc(r.workingLines)}</td><td>${esc(r.faultCount)}</td><td>${esc(per1000(r.faultCount, r.workingLines))}</td><td>${esc(projected(r.faultCount, r.workingLines))}</td>`;
      return isTech
        ? `<td>${n}</td><td>${esc(r.techName)}</td>${m}`
        : `<td>${n}</td><td>${esc(r.centralName)}</td><td>${esc(r.cabinNumber)}</td><td>${esc(r.boxNumber)}</td><td>${esc(r.techName)}</td>${m}`;
    };
    const totalRow = `<tr class="total"><td colspan="${isTech ? 2 : 5}">إجمالى الإدارة</td><td>${esc(totWorking)}</td><td>${esc(totFaults)}</td><td>${esc(totPer1000)}</td><td>${esc(totProjected)}</td></tr>`;
    const ROWS_PER_PAGE = 22;
    const total = Math.max(1, Math.ceil(displayRows.length / ROWS_PER_PAGE));
    let pages = "";
    for (let pg = 0; pg < total; pg++) {
      const chunk = displayRows.slice(pg * ROWS_PER_PAGE, (pg + 1) * ROWS_PER_PAGE);
      let body = chunk.map((r, ci) => `<tr>${cells(r, pg * ROWS_PER_PAGE + ci + 1)}</tr>`).join("");
      if (pg === total - 1) body += totalRow;
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          <div class="pageno">صفحة ${pg + 1} من ${total}</div>
          <table>
            <thead><tr>${head}</tr></thead>
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
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 7px 4px; border: 1px solid #15407f; font-size: 12px; }
        td { border: 1px solid #ccc; padding: 5px 4px; text-align: center; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        tr.total td { background: #1e50a0 !important; color: #fff !important; font-weight: bold; }
        .page { background: #fff; padding: 14px; margin: 12px auto; max-width: 900px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; display: flex; gap: 10px; align-items: center; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
        @media print { body { background: #fff; } .toolbar { display: none; } .page { box-shadow: none; margin: 0; max-width: none; page-break-after: always; } @page { size: A4 landscape; margin: 10mm; } }
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
            placeholder="بحث برقم الكابينه / رقم البكس / الفنى"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:max-w-xs text-sm"
            dir="rtl"
          />
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الأعطال أكبر من</label>
            <Input type="number" inputMode="numeric" value={minFaults} onChange={(e) => setMinFaults(e.target.value)} placeholder="مثال: 5" className="w-full sm:w-28 text-sm" dir="ltr" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">المتوقع أكبر من</label>
            <Input type="number" inputMode="decimal" value={minProjected} onChange={(e) => setMinProjected(e.target.value)} placeholder="مثال: 20" className="w-full sm:w-28 text-sm" dir="ltr" />
          </div>
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

      {/* تبديل التبويبين */}
      <div className="flex rounded-lg border overflow-hidden text-sm w-full sm:w-auto">
        {([["tech", "لكل فنى"], ["box", "لكل بكس"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 sm:flex-none px-4 py-2 font-medium transition-colors ${
              tab === key ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            عدد الأعطال فى الألف {label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-white p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-foreground">{displayRows.length}</div>
          <div className="text-xs text-muted-foreground mt-1">{isTech ? "عدد الفنيين" : "عدد البكسيات"}</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-green-700">{totWorking}</div>
          <div className="text-xs text-green-700 mt-1">إجمالى الخطوط</div>
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
                {!isTech && <TableHead className="text-right font-bold">السنترال</TableHead>}
                {!isTech && <TableHead className="text-right font-bold">رقم الكابينه</TableHead>}
                {!isTech && <TableHead className="text-right font-bold">رقم البكس</TableHead>}
                <TableHead className="text-right font-bold">اسم الفنى</TableHead>
                <TableHead className="text-right font-bold">عدد الخطوط</TableHead>
                <TableHead className="text-right font-bold">عدد الأعطال</TableHead>
                <TableHead className="text-right font-bold">أعطال / ١٠٠٠ خط</TableHead>
                <TableHead className="text-right font-bold">المتوقع نهاية الشهر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isTech ? 6 : 9} className="text-center py-14 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد بيانات — تأكد من رفع ملف بيان التليفونات وملف الأعطال 430D"}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {displayRows.map((r, idx) => (
                    <TableRow key={isTech ? r.techName : `${r.centralName}-${r.cabinNumber}-${r.boxNumber}-${idx}`} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      {!isTech && <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>}
                      {!isTech && <TableCell className="font-semibold">{r.cabinNumber}</TableCell>}
                      {!isTech && <TableCell className="font-semibold">{r.boxNumber}</TableCell>}
                      <TableCell className="whitespace-nowrap">{r.techName}</TableCell>
                      <TableCell className="text-center font-bold text-green-700">{r.workingLines}</TableCell>
                      <TableCell className="text-center font-bold text-red-700">{r.faultCount}</TableCell>
                      <TableCell className="text-center font-bold text-blue-700">{per1000(r.faultCount, r.workingLines)}</TableCell>
                      <TableCell className="text-center font-bold text-purple-700">{projected(r.faultCount, r.workingLines)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-blue-900 hover:bg-blue-900">
                    <TableCell colSpan={isTech ? 2 : 5} className="text-white font-bold text-center">إجمالى الإدارة</TableCell>
                    <TableCell className="text-center text-white font-bold">{totWorking}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totFaults}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totPer1000}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totProjected}</TableCell>
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

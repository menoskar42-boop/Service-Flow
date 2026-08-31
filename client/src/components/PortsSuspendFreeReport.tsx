import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer } from "lucide-react";
import { format } from "date-fns";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

interface Row {
  phoneNumber: string;
  central: string | null;
  subName: string | null;
  subAdd: string | null;
  workOrdDate: string | null;
  workOrdNo: string | null;
  msanCode: string | null;
  frame: string | null;
  portNumber: string | null;
  portType: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  operator: string | null;
}

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function PortsSuspendFreeReport() {
  const [central, setCentral] = useState("");
  const [q, setQ] = useState("");

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/reports/ports-suspend-free", central, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (central) p.set("central", central);
      if (q) p.set("q", q);
      const res = await fetch(`/api/reports/ports-suspend-free?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });
  const mobileLookup = useMobileLookup(rows.map((r) => r.phoneNumber));

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r, i) => ({
        "#": i + 1,
        "رقم التليفون": r.phoneNumber,
         "رقم الموبايل": mobileLookup[phoneLookupKey(r.phoneNumber)] || "",
        "السنترال": r.central ?? "",
        "اسم العميل": r.subName ?? "",
        "العنوان": r.subAdd ?? "",
        "تاريخ الأمر": r.workOrdDate ?? "",
        "رقم الأمر": r.workOrdNo ?? "",
        "MSAN": r.msanCode ?? "",
        "Frame": r.frame ?? "",
        "المنفذ": r.portNumber ?? "",
        "الصوت": r.voiceStatus ?? "",
        "الداتا": r.dataStatus ?? "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ALL_SUSPEND-FREE");
    XLSX.writeFile(wb, `ports-suspend-free-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const title = `أرقام ALL_SUSPEND / FREE${central ? " — " + central : ""} — ${format(new Date(), "yyyy/MM/dd HH:mm")}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 20;
    const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    const headRow = `<tr>
       <th>#</th><th>رقم التليفون</th><th>رقم الموبايل</th><th>السنترال</th><th>اسم العميل</th><th>العنوان</th>
      <th>تاريخ الأمر</th><th>رقم الأمر</th><th>MSAN</th><th>Frame</th><th>المنفذ</th><th>الصوت</th><th>الداتا</th>
    </tr>`;
    let pages = "";
    for (let p = 0; p < totalPages; p++) {
      const chunk = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const body = chunk.map((r, ci) => `
        <tr>
          <td>${p * ROWS_PER_PAGE + ci + 1}</td>
          <td>${esc(r.phoneNumber)}</td>
           <td>${esc(mobileLookup[phoneLookupKey(r.phoneNumber)] || "")}</td>
          <td>${esc(r.central)}</td>
          <td>${esc(r.subName)}</td>
          <td>${esc(r.subAdd)}</td>
          <td>${esc(r.workOrdDate)}</td>
          <td>${esc(r.workOrdNo)}</td>
          <td>${esc(r.msanCode)}</td>
          <td>${esc(r.frame)}</td>
          <td>${esc(r.portNumber)}</td>
          <td>${esc(r.voiceStatus)}</td>
          <td>${esc(r.dataStatus)}</td>
        </tr>`).join("");
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          <div class="pageno">صفحة ${p + 1} من ${totalPages} — إجمالي: ${rows.length} رقم</div>
          <table><thead>${headRow}</thead><tbody>${body}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(title)}</title>
      <style>
        body { font-family: Arial, "Segoe UI", sans-serif; font-size: 11px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 14px; margin: 0 0 4px; }
        .pageno { text-align: center; font-size: 10px; color: #64748b; margin-bottom: 6px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 6px 4px; border: 1px solid #15407f; font-size: 11px; }
        td { border: 1px solid #ccc; padding: 5px 4px; text-align: right; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        .page { background: #fff; padding: 12px; margin: 10px auto; max-width: 1100px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 8px 12px; display: flex; gap: 10px; align-items: center; z-index: 10; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .toolbar span { color: #475569; font-size: 11px; }
        @media print {
          body { background: #fff; }
          .toolbar { display: none; }
          .page { box-shadow: none; margin: 0; padding: 0; max-width: none; page-break-after: always; }
          .page:last-child { page-break-after: auto; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      </style></head><body>
      <div class="toolbar">
        <button onclick="try{window.close()}catch(e){};setTimeout(function(){history.length>1?history.back():location.href='/'},150)" style="padding:6px 14px;background:#475569;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;margin-left:8px">↩ رجوع</button><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>في نافذة الطباعة اختر &quot;حفظ بصيغة PDF&quot; كوجهة الطباعة.</span>
      </div>
      ${pages}
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={central}
          onChange={(e) => setCentral(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm"
          dir="rtl"
        >
          <option value="">كل السنترالات</option>
          {CENTRALS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Input
          placeholder="بحث برقم التليفون / الاسم / العنوان / MSAN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm text-sm"
          dir="rtl"
        />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <span className="text-sm text-muted-foreground">إجمالي: <strong>{rows.length}</strong></span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={rows.length === 0} className="text-green-700 border-green-200 gap-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={rows.length === 0} className="text-red-700 border-red-200 gap-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-cyan-50">
              <TableRow>
                <TableHead className="text-right font-bold w-8">#</TableHead>
                <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                <TableHead className="text-right font-bold">رقم الموبايل</TableHead>
                <TableHead className="text-right font-bold">السنترال</TableHead>
                <TableHead className="text-right font-bold">اسم العميل</TableHead>
                <TableHead className="text-right font-bold">العنوان</TableHead>
                <TableHead className="text-right font-bold">تاريخ الأمر</TableHead>
                <TableHead className="text-right font-bold">رقم الأمر</TableHead>
                <TableHead className="text-right font-bold">MSAN</TableHead>
                <TableHead className="text-right font-bold">Frame</TableHead>
                <TableHead className="text-right font-bold">المنفذ</TableHead>
                <TableHead className="text-right font-bold">الصوت</TableHead>
                <TableHead className="text-right font-bold">الداتا</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
               {rows.length === 0 ? (
                 <TableRow><TableCell colSpan={13} className="text-center py-16 text-muted-foreground">
                  {isFetching ? "جاري التحميل..." : "لا توجد أرقام بحالة ALL_SUSPEND / FREE"}
                </TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={r.phoneNumber} className="hover:bg-muted/30">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell dir="ltr" className="text-left font-mono text-xs">{r.phoneNumber}</TableCell>
                   <TableCell><MobileValue mobile={mobileLookup[phoneLookupKey(r.phoneNumber)]} /></TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{r.central || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-normal break-words min-w-[140px]">{r.subName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-normal break-words min-w-[200px] max-w-[320px]">{r.subAdd || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{r.workOrdDate || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{r.workOrdNo || "—"}</TableCell>
                  <TableCell className="text-xs">{r.msanCode || "—"}</TableCell>
                  <TableCell className="text-xs">{r.frame || "—"}</TableCell>
                  <TableCell className="text-xs">{r.portNumber || "—"}</TableCell>
                  <TableCell className="text-xs">{r.voiceStatus || "—"}</TableCell>
                  <TableCell className="text-xs">{r.dataStatus || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

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

interface Installation {
  centralName: string | null;
  workOrderId: number | null;
  phoneNumber: string | null;
  workOrderType: string | null;
  stage: string | null;
  status: string | null;
  priority: string | null;
  cabinetNo: string | null;
  boxNo: string | null;
  dpTerminal: string | null;
  workerCode: string | null;
  techName: string | null;
  creationDate: string | null;
  description: string | null;
  mobile: string | null;
  customerName: string | null;
  address: string | null;
  referenceNo: string | null;
}

const fmtDt = (d: string | null) =>
  d ? format(new Date(d), "yyyy/MM/dd HH:mm") : "-";

function classify(creationDate: string | null): { label: string; cls: string } {
  if (!creationDate) return { label: "—", cls: "bg-gray-100 text-gray-600" };
  const hours = (Date.now() - new Date(creationDate).getTime()) / 3_600_000;
  if (hours <= 24) return { label: "24 ساعة", cls: "bg-green-100 text-green-800" };
  if (hours <= 48) return { label: "48 ساعة", cls: "bg-yellow-100 text-yellow-800" };
  return { label: "متبقيات", cls: "bg-red-100 text-red-800" };
}

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function InstallationsReport({
  endpoint, queryKey, title, regularized = false, sheetName, fileName,
  showDates = false, extraParams, phoneLabel = "التليفون",
}: {
  endpoint: string;
  queryKey: string;
  title: string;
  regularized?: boolean;
  sheetName: string;
  fileName: string;
  showDates?: boolean;
  extraParams?: Record<string, string>;
  phoneLabel?: string;
}) {
  const [central, setCentral] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: items = [], isFetching } = useQuery<Installation[]>({
    queryKey: [queryKey, central, q, dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams(extraParams ?? {});
      if (central) p.set("central", central);
      if (q) p.set("q", q);
      if (showDates && dateFrom) p.set("dateFrom", dateFrom);
      if (showDates && dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`${endpoint}?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const handleExportExcel = () => {
    const rows = items.map((o, i) => ({
      "#": i + 1,
      "اسم السنترال": o.centralName,
      "رقم أمر الشغل": o.workOrderId,
      "رقم المرجع": o.referenceNo,
      [phoneLabel]: o.phoneNumber,
      "رقم الموبايل": o.mobile,
      "اسم العميل": o.customerName,
      "العنوان": o.address,
      "نوع أمر الشغل": o.workOrderType,
      "المرحلة": o.stage,
      "الحالة": o.status,
      "الأهمية": o.priority,
      "كود العامل": o.workerCode,
      "اسم الفنى": o.techName,
      "تاريخ الإنشاء": fmtDt(o.creationDate),
      "التصنيف": classify(o.creationDate).label,
      ...(regularized ? { "حالة الانتظام": "تم التنفيذ" } : {}),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${fileName}-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const fullTitle = `${title} — ${format(new Date(), "yyyy/MM/dd HH:mm")}`;
    const esc = (v: any) =>
      String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 11;
    const totalPages = Math.max(1, Math.ceil(items.length / ROWS_PER_PAGE));
    const headRow = `<tr>
      <th>#</th><th>السنترال</th><th>رقم المرجع</th><th>${esc(phoneLabel)}</th><th>الموبايل</th>
      <th>اسم العميل</th><th>العنوان</th><th>نوع الأمر</th>
      <th>اسم الفنى</th><th>تاريخ الإنشاء</th><th>التصنيف</th>${regularized ? "<th>الانتظام</th>" : ""}
    </tr>`;
    let pages = "";
    for (let p = 0; p < totalPages; p++) {
      const chunk = items.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const body = chunk.map((o, ci) => {
        const cl = classify(o.creationDate);
        const clColor = cl.label === "24 ساعة" ? "#166534" : cl.label === "48 ساعة" ? "#854d0e" : "#991b1b";
        const clBg = cl.label === "24 ساعة" ? "#dcfce7" : cl.label === "48 ساعة" ? "#fef9c3" : "#fee2e2";
        return `
        <tr class="green">
          <td>${p * ROWS_PER_PAGE + ci + 1}</td>
          <td>${esc(o.centralName)}</td>
          <td style="font-size:9px">${esc(o.referenceNo)}</td>
          <td>${esc(o.phoneNumber)}</td>
          <td>${esc(o.mobile)}</td>
          <td style="font-size:9px">${esc(o.customerName)}</td>
          <td style="font-size:8px">${esc(o.address)}</td>
          <td style="font-size:9px">${esc(o.workOrderType)}</td>
          <td>${esc(o.techName)}</td>
          <td style="font-size:9px">${esc(fmtDt(o.creationDate))}</td>
          <td style="background:${clBg}!important;color:${clColor};font-weight:600;text-align:center">${esc(cl.label)}</td>
          ${regularized ? "<td>تم التنفيذ</td>" : ""}
        </tr>`;
      }).join("");
      pages += `
        <section class="page">
          <h2>${esc(fullTitle)}</h2>
          <div class="pageno">صفحة ${p + 1} من ${totalPages} — إجمالي: ${items.length} أمر</div>
          <table><thead>${headRow}</thead><tbody>${body}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(fullTitle)}</title>
      <style>
        body { font-family: Arial, "Segoe UI", sans-serif; font-size: 10px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 13px; margin: 0 0 3px; }
        .pageno { text-align: center; font-size: 9px; color: #64748b; margin-bottom: 6px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 5px 3px; border: 1px solid #15407f; font-size: 10px; }
        td { border: 1px solid #ccc; padding: 4px 3px; text-align: right; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        tbody tr.green td { background: #dcfce7 !important; }
        .page { background: #fff; padding: 10px; margin: 10px auto; max-width: 1200px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0;
          padding: 8px 12px; display: flex; gap: 10px; align-items: center; z-index: 10; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px;
          padding: 7px 14px; font-size: 12px; cursor: pointer; font-family: inherit; }
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
        <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>في نافذة الطباعة اختر &quot;حفظ بصيغة PDF&quot; كوجهة الطباعة.</span>
      </div>
      ${pages}
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const colCount = regularized ? 17 : 16;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {showDates && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">من</span>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-sm w-auto" dir="ltr" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">إلى</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-sm w-auto" dir="ltr" />
            </div>
          </>
        )}
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
          placeholder="بحث برقم التليفون / النوع / الكابينة / البكس"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs text-sm"
          dir="rtl"
        />
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <span className="text-sm text-muted-foreground">إجمالي: <strong>{items.length}</strong> أمر</span>
        <Button
          variant="outline" size="sm"
          onClick={handleExportExcel}
          disabled={items.length === 0}
          className="text-green-700 border-green-200 gap-1"
        >
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={handleExportPDF}
          disabled={items.length === 0}
          className="text-red-700 border-red-200 gap-1"
        >
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      {/* Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-xs" dir="rtl">
            <TableHeader className="bg-blue-900">
              <TableRow>
                <TableHead className="text-right font-bold text-white w-8">#</TableHead>
                <TableHead className="text-right font-bold text-white">السنترال</TableHead>
                <TableHead className="text-right font-bold text-white">رقم المرجع</TableHead>
                <TableHead className="text-right font-bold text-white">رقم الأمر</TableHead>
                <TableHead className="text-right font-bold text-white">{phoneLabel}</TableHead>
                <TableHead className="text-right font-bold text-white">الموبايل</TableHead>
                <TableHead className="text-right font-bold text-white">اسم العميل</TableHead>
                <TableHead className="text-right font-bold text-white">العنوان</TableHead>
                <TableHead className="text-right font-bold text-white">نوع أمر الشغل</TableHead>
                <TableHead className="text-right font-bold text-white">المرحلة</TableHead>
                <TableHead className="text-right font-bold text-white">الحالة</TableHead>
                <TableHead className="text-right font-bold text-white">الأهمية</TableHead>
                <TableHead className="text-right font-bold text-white">اسم الفنى</TableHead>
                <TableHead className="text-right font-bold text-white">تاريخ الإنشاء</TableHead>
                <TableHead className="text-right font-bold text-white">التصنيف</TableHead>
                {regularized && <TableHead className="text-right font-bold text-white">حالة الانتظام</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center py-16 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." :
                      regularized
                        ? "لا توجد تركيبات منتظمة اليوم — تأكد من رفع ملف أوامر الشغل (بداية اليوم والحالى)"
                        : "لا توجد تركيبات حالية — تأكد من رفع ملف أوامر الشغل الحالى"}
                  </TableCell>
                </TableRow>
              ) : items.map((o, i) => (
                <TableRow key={i} className="bg-green-50 hover:bg-green-100">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>{o.centralName || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left font-mono text-xs">{o.referenceNo || "-"}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{o.workOrderId ?? "-"}</span>
                  </TableCell>
                  <TableCell dir="ltr" className="text-left font-mono">{o.phoneNumber || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left font-mono">{o.mobile || "-"}</TableCell>
                  <TableCell className="max-w-[180px] whitespace-normal break-words align-top">{o.customerName || "-"}</TableCell>
                  <TableCell className="max-w-[260px] whitespace-normal break-words align-top">{o.address || "-"}</TableCell>
                  <TableCell className="max-w-[160px] truncate" title={o.workOrderType || ""}>{o.workOrderType || "-"}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{o.stage || "-"}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{o.status || "-"}</TableCell>
                  <TableCell>{o.priority || "-"}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{o.techName || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(o.creationDate)}</TableCell>
                  <TableCell>
                    {(() => { const c = classify(o.creationDate); return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${c.cls}`}>{c.label}</span>; })()}
                  </TableCell>
                  {regularized && (
                    <TableCell>
                      <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-800">تم التنفيذ</span>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

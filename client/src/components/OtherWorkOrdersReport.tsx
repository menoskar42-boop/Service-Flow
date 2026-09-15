import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, FileSpreadsheet, Printer, ListFilter } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { format } from "date-fns";

// «أوامر شغل أخرى (بدون سلك)» — الأنواع اللى مش نقل ولا تركيب ومابتستهلكش سلك:
// تفعيل/إلغاء خدمة مضافة، التحقق من إتاحة رقم، المعاينة.
// دى اتشالت من «أوامر الشغل» ومن «أوامر شغل بدون كمية سلك» عشان ماتلخبطش الأرقام
// (كانت بتتحسب «نقل» لأن الاستيراد بيحطّ أى نوع مش تركيب على إنه نقل)، والتقرير ده
// هو مكانها. نفس القائمة بالظبط على السيرفر فمفيش أمر بيضيع ولا بيتكرر.
interface Row {
  id: number;
  workOrderId: number | null;
  phoneNumber: string | null;
  centralName: string | null;
  workOrderType: string | null;
  closeDate: string | null;
  closeCategory: string | null;
  techName: string | null;
  msanCode: string | null;
}

const COLS = ["#", "رقم امر الشغل", "رقم التليفون", "اسم السنترال", "نوع امر الشغل",
  "حالة الاغلاق", "اسم الفنى", "كود المسان", "تاريخ الاغلاق"];

const fmtDate = (d: string | null) => {
  if (!d) return "-";
  try { return format(new Date(d), "yyyy/MM/dd HH:mm"); } catch { return "-"; }
};

export function OtherWorkOrdersReport() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");

  const { data, isFetching } = useQuery<{ data: Row[]; types: string[] }>({
    queryKey: ["/api/reports/other-work-orders", dateFrom, dateTo, type],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      if (type) p.set("type", type);
      const res = await fetch(`/api/reports/other-work-orders?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "تعذّر تحميل التقرير");
      return res.json();
    },
  });

  const rows = data?.data ?? [];
  // البحث محلى على المعروض — نفس سلوك باقى تقارير أوامر الشغل
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    const digits = s.replace(/\D/g, "");
    return rows.filter((r) =>
      (digits && String(r.phoneNumber ?? "").replace(/\D/g, "").includes(digits)) ||
      (digits && String(r.workOrderId ?? "").includes(digits)) ||
      String(r.techName ?? "").toLowerCase().includes(s) ||
      String(r.workOrderType ?? "").toLowerCase().includes(s) ||
      String(r.centralName ?? "").toLowerCase().includes(s));
  }, [rows, q]);

  const exportRows = () => shown.map((r, i) => [
    i + 1, r.workOrderId ?? "", r.phoneNumber ?? "", r.centralName ?? "",
    r.workOrderType ?? "", r.closeCategory ?? "", r.techName ?? "",
    r.msanCode ?? "", fmtDate(r.closeDate),
  ]);

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLS, ...exportRows()]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أوامر شغل أخرى");
    XLSX.writeFile(wb, `other-work-orders-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    printTablePDF({ title: "أوامر شغل أخرى (بدون سلك)", columns: COLS, rows: exportRows() });
  };

  return (
    <Card className="p-4 sm:p-5 bg-white border-0 shadow-sm" dir="rtl">
      <div className="flex items-center gap-2 mb-1">
        <ListFilter className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold">أوامر شغل أخرى (بدون سلك)</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        الأنواع اللى <strong>مش نقل ولا تركيب ومابتستهلكش سلك</strong>: تفعيل/إلغاء خدمة
        مضافة، التحقق من إتاحة رقم، والمعاينة. اتشالت من «أوامر الشغل» ومن «أوامر شغل بدون
        كمية سلك» عشان ماتلخبطش الأرقام، وبتظهر هنا.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">من</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-sm h-9" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">إلى</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-sm h-9" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">نوع امر الشغل</label>
          <select value={type} onChange={(e) => setType(e.target.value)} dir="rtl"
            className="h-9 border rounded-md px-2 text-sm bg-white min-w-[220px]">
            <option value="">كل الأنواع</option>
            {(data?.types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <label className="text-xs text-muted-foreground block mb-1">بحث</label>
          <Search className="absolute right-2 top-[30px] w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="رقم التليفون / أمر الشغل / الفنى / النوع" className="text-sm pr-8 h-9" dir="rtl" />
        </div>
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mb-2" />}
        <span className="text-sm text-muted-foreground mb-2">
          إجمالي: <strong>{shown.length}</strong> أمر شغل
        </span>
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!shown.length}
          className="text-green-700 border-green-200 gap-1 mb-1">
          <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!shown.length}
          className="text-red-700 border-red-200 gap-1 mb-1">
          <Printer className="w-4 h-4" /> تصدير PDF
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table className="text-right text-sm" dir="rtl">
          <TableHeader className="bg-muted/50">
            <TableRow>
              {COLS.map((c) => (
                <TableHead key={c} className="text-right font-bold whitespace-nowrap">{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLS.length} className="text-center py-10 text-muted-foreground">
                  {isFetching ? "جارٍ التحميل…" : "مفيش أوامر شغل من الأنواع دى فى المدة المحددة"}
                </TableCell>
              </TableRow>
            ) : shown.map((r, i) => (
              <TableRow key={r.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-mono">{r.workOrderId ?? "-"}</TableCell>
                <TableCell className="font-mono font-semibold text-blue-700">{r.phoneNumber ?? "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.centralName ?? "-"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-indigo-50 text-indigo-700">
                    {r.workOrderType ?? "-"}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    r.closeCategory === "Fail" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                    {r.closeCategory || "-"}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{r.techName || "-"}</TableCell>
                <TableCell className="font-mono text-xs">{r.msanCode || "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.closeDate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

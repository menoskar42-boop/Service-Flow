import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, FileText, ListChecks } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

interface ExecJobRow {
  id: number;
  type: "measure" | "raise" | "stop" | string;
  status: string;
  result: string | null;
  requestedBy: string | null;
  source: string | null;
  createdAt: string;
  doneAt: string | null;
  requested: number; // عدد الخطوط المطلوبة
  measured: number;  // اتنفّذ فعلاً
}

const TYPE_LABEL: Record<string, string> = { measure: "قياس", raise: "رفع سرعة", stop: "إيقاف PO" };

// حالة العملية بشكل مقروء (الحالة + النتيجة)
function statusText(j: ExecJobRow): string {
  if (j.status === "pending") return "فى الطابور";
  if (j.status === "claimed") return "جارٍ التنفيذ";
  if (j.status === "stale") return "أُلغِيت (جهاز التنفيذ مقفول)";
  if (j.status === "done") {
    if (j.result === "tab_closed") return "اتقفل قبل ما يخلص";
    if (j.result === "timeout") return "علّق قبل ما يخلص";
    if (j.result === "stopped") return "اتوقف يدوياً";
    return "تم";
  }
  return j.status;
}

function fmt(iso: string | null): string {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ExecJobsReport() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return ymd(d); });
  const [to, setTo] = useState(() => ymd(new Date()));
  const [jobs, setJobs] = useState<ExecJobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/exec-queue/history?from=${from}&to=${to}`, { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر تحميل التقرير");
      const d = await r.json();
      setJobs(d.jobs ?? []);
    } catch (e: any) { setError(e.message || "خطأ"); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // إجماليات
  const totals = useMemo(() => {
    const measured = jobs.reduce((s, j) => s + (j.measured || 0), 0);
    const requested = jobs.reduce((s, j) => s + (j.requested || 0), 0);
    return { jobs: jobs.length, measured, requested };
  }, [jobs]);

  const COLUMNS = ["التاريخ", "النوع", "عدد الخطوط", "اتنفّذ فعلاً", "طلبها", "من تقرير", "الحالة"];
  const toRow = (j: ExecJobRow) => [
    fmt(j.createdAt),
    TYPE_LABEL[j.type] || j.type,
    j.requested,
    j.measured,
    j.requestedBy || "-",
    j.source || "-",
    statusText(j),
  ];

  const handleExportExcel = () => {
    const aoa = [COLUMNS, ...jobs.map(toRow)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "معاملات التنفيذ");
    XLSX.writeFile(wb, `exec-jobs-${from}_${to}.xlsx`);
  };

  const handleExportPDF = () => {
    printTablePDF({ title: `تقرير معاملات التنفيذ (${from} → ${to})`, columns: COLUMNS, rows: jobs.map(toRow) });
  };

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><ListChecks className="w-5 h-5 text-indigo-600" /> تقرير معاملات التنفيذ (القياس/رفع السرعة/الإيقاف)</h2>
          <p className="text-xs text-muted-foreground">كل مهام جهاز التنفيذ: قاس كام خط، مين طلبها، من تقرير إيه، والحالة.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1 text-green-700 border-green-200" disabled={!jobs.length}>
            <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
          </Button>
          <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1 text-red-700 border-red-200" disabled={!jobs.length}>
            <FileText className="w-4 h-4" /> تصدير PDF
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">من</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">إلى</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
        </div>
        <Button onClick={load} size="sm" className="gap-1" disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث
        </Button>
        <div className="text-sm text-muted-foreground mr-auto">
          {totals.jobs} عملية · إجمالى الخطوط المطلوبة {totals.requested} · اتنفّذ فعلاً {totals.measured}
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="rounded-md border max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>{COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : jobs.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">لا توجد عمليات فى الفترة المختارة</TableCell></TableRow>
            ) : (
              jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="whitespace-nowrap">{fmt(j.createdAt)}</TableCell>
                  <TableCell>{TYPE_LABEL[j.type] || j.type}</TableCell>
                  <TableCell className="text-center">{j.requested}</TableCell>
                  <TableCell className="text-center font-semibold">{j.measured}</TableCell>
                  <TableCell className="whitespace-nowrap">{j.requestedBy || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">{j.source || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">{statusText(j)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

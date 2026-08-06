import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, FileText, Layers, Search, X } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { arNorm, arIncludes } from "@shared/ar-norm";

// كل الباتشات اللى اتطلبت (قياس/رفع سرعة/إيقاف PO) مهما كانت أولويتها وحالتها:
// اكتملت / اكتملت جزئياً / أُلغِيت / لسه فى الطابور / موقّفة مؤقتاً.
interface BatchRow {
  batchId: string;
  type: "measure" | "raise" | "stop" | string;
  priority: number;
  requestedBy: string | null;
  note: string | null;
  total: number;
  done: number;
  doneOk: number;
  doneErr: number;
  canceled: number;
  pending: number;
  running: number;
  paused: boolean;
  active: number;
  state: string;
  createdAt: string | null;
  finishedAt: string | null;
}

const typeLabel = (t: string) =>
  t === "measure" ? "قياس" : t === "raise" ? "رفع سرعة" : t === "stop" ? "إيقاف PO" : t;

const priorityLabel = (p: number) =>
  p === 2 ? "عاجلة (≤3 خطوط)" : p === 1 ? "محتاجة رفع سرعة" : "مؤجّلة (>3 خطوط)";

const fmt = (d: string | null) => {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const stateStyle = (s: string) =>
  s === "اكتملت"        ? "bg-green-100 text-green-800"
  : s === "اكتملت جزئياً" ? "bg-amber-100 text-amber-800"
  : s === "أُلغِيت بالكامل" ? "bg-red-100 text-red-800"
  : s === "موقّف مؤقتاً"   ? "bg-orange-100 text-orange-800"
  : s === "جارٍ التنفيذ"   ? "bg-blue-100 text-blue-800"
  : s === "فى الطابور"    ? "bg-slate-100 text-slate-700"
  :                        "bg-gray-100 text-gray-600";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ExecBatchesReport() {
  // الافتراضى: آخر 30 يوم
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return ymd(d); });
  const [to, setTo] = useState(() => ymd(new Date()));
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");            // بحث بالباتش/التقرير/الطالب
  const [stateFilter, setStateFilter] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // silent = تحديث خلفى (التلقائى): مايوريّش سبينر ولا يمسح الجدول لو الطلب فشل،
  // عشان الشاشة ماترفرفش كل 5 ثوانى.
  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    try {
      const r = await fetch(`/api/exec-queue/batches?from=${from}&to=${to}`, { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر تحميل التقرير");
      const d = await r.json();
      setRows(Array.isArray(d.data) ? d.data : []);
      setLastRefresh(new Date());
    } catch (e: any) { if (!silent) { setError(e.message || "خطأ"); setRows([]); } }
    finally { if (!silent) setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  // تحديث تلقائى كل 5 ثوانى — الباتشات بتتغيّر لحظياً وجهاز التنفيذ شغّال. بيقف لو
  // التاب مش ظاهر (مافيش داعى نضرب السيرفر فى الخلفية).
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load(true);
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const states = useMemo(() => [...new Set(rows.map((r) => r.state))], [rows]);

  const shown = useMemo(() => {
    const s = arNorm(q.trim());
    return rows.filter((r) => {
      if (stateFilter && r.state !== stateFilter) return false;
      if (!s) return true;
      return arIncludes((r.batchId || ""), s)
          || arIncludes((r.note || ""), s)
          || arIncludes((r.requestedBy || ""), s)
          || arIncludes(typeLabel(r.type), s);
    });
  }, [rows, q, stateFilter]);

  // إجماليات المعروض
  const tot = useMemo(() => shown.reduce((a, r) => ({
    batches: a.batches + 1,
    lines: a.lines + r.total,
    done: a.done + r.done,
    canceled: a.canceled + r.canceled,
    active: a.active + r.active,
  }), { batches: 0, lines: 0, done: 0, canceled: 0, active: 0 }), [shown]);

  const COLS = ["#", "النوع", "الأولوية", "من تقرير", "طلبها", "الحالة", "إجمالى الخطوط", "اتنفّذ", "منها بإيرور", "أُلغِيت", "متبقّى", "وقت الطلب", "آخر تنفيذ", "الباتش"];

  const asRow = (r: BatchRow, i: number) => [
    i + 1, typeLabel(r.type), priorityLabel(r.priority), r.note || "غير محدد",
    r.requestedBy || "—", r.state, r.total, r.done, r.doneErr, r.canceled, r.active,
    fmt(r.createdAt), fmt(r.finishedAt), r.batchId,
  ];

  const handleExportExcel = () => {
    const data = shown.map((r, i) => Object.fromEntries(COLS.map((c, ci) => [c, asRow(r, i)[ci]])));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الباتشات");
    XLSX.writeFile(wb, `exec-batches-${from}-${to}.xlsx`);
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: `سجل الباتشات (${from} → ${to})`,
      columns: COLS,
      rows: shown.map(asRow),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4 space-y-3 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-bold text-base flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-700" /> سجل كل الباتشات (المنفَّذة والملغاة)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              كل الباتشات مهما كانت أولويتها — اكتملت أو جزئياً أو أُلغِيت أو لسه فى الطابور.
              <span className="text-blue-600"> {" "}🔄 يتحدّث تلقائياً كل 5 ثوانى
                {lastRefresh ? ` — آخر تحديث ${lastRefresh.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">من</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">إلى</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 text-sm" />
            </div>
            <Button onClick={handleExportExcel} size="sm" variant="outline" disabled={!shown.length} className="text-green-700 border-green-200 gap-1">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button onClick={handleExportPDF} size="sm" variant="outline" disabled={!shown.length} className="text-red-700 border-red-200 gap-1">
              <FileText className="w-4 h-4" /> PDF
            </Button>
          </div>
        </div>

        {/* بحث + فلتر الحالة */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-muted-foreground block mb-1">بحث بالباتش / التقرير / الطالب</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب رقم الباتش أو اسم التقرير…" className="text-sm pr-8" />
              {q && (
                <button type="button" onClick={() => setQ("")} title="مسح البحث"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الحالة</label>
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
              className="border rounded-md px-2 h-9 text-sm bg-background" dir="rtl">
              <option value="">كل الحالات</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {/* «تحديث» جنب البحث (مش فوق مع التواريخ) عشان يفضل قريب من الجدول
              ويبان وانت نازل بالسكرول على الصفوف */}
          <Button onClick={() => load()} size="sm" variant="outline" className="gap-1 h-9" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث
          </Button>
        </div>

        {/* إحصائية المعروض */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-indigo-50 text-indigo-800 font-semibold">باتشات: {tot.batches}</span>
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">إجمالى الخطوط: {tot.lines}</span>
          <span className="px-2 py-1 rounded bg-green-50 text-green-800">اتنفّذ: {tot.done}</span>
          <span className="px-2 py-1 rounded bg-red-50 text-red-800">أُلغِيت: {tot.canceled}</span>
          <span className="px-2 py-1 rounded bg-blue-50 text-blue-800">لسه فى الطابور: {tot.active}</span>
        </div>
      </Card>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <Table className="text-right text-xs min-w-max" dir="rtl">
            <TableHeader>
              <TableRow className="bg-indigo-900 hover:bg-indigo-900">
                {COLS.map((c) => (
                  <TableHead key={c} className="text-white font-bold text-center whitespace-nowrap">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center py-14">
                  <Loader2 className="w-5 h-5 animate-spin inline ml-2" />جارٍ التحميل…
                </TableCell></TableRow>
              ) : shown.length === 0 ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center py-14 text-muted-foreground">
                  {q || stateFilter ? "مفيش باتشات مطابقة للبحث" : "لا توجد باتشات فى الفترة"}
                </TableCell></TableRow>
              ) : (
                shown.map((r, i) => (
                  <TableRow key={r.batchId} className="hover:bg-muted/30">
                    <TableCell className="text-center text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-center font-semibold">{typeLabel(r.type)}</TableCell>
                    <TableCell className="text-center">{priorityLabel(r.priority)}</TableCell>
                    <TableCell>{r.note || "غير محدد"}</TableCell>
                    <TableCell className="text-center">{r.requestedBy || "—"}</TableCell>
                    <TableCell className="text-center">
                      <span className={`px-2 py-0.5 rounded font-semibold ${stateStyle(r.state)}`}>{r.state}</span>
                    </TableCell>
                    <TableCell className="text-center font-bold">{r.total}</TableCell>
                    <TableCell className="text-center text-green-700 font-semibold">{r.done}</TableCell>
                    <TableCell className="text-center text-amber-700">{r.doneErr || "—"}</TableCell>
                    <TableCell className="text-center text-red-700">{r.canceled || "—"}</TableCell>
                    <TableCell className="text-center text-blue-700">{r.active || "—"}</TableCell>
                    <TableCell className="text-center">{fmt(r.createdAt)}</TableCell>
                    <TableCell className="text-center">{fmt(r.finishedAt)}</TableCell>
                    <TableCell className="text-center font-mono text-[11px] text-muted-foreground">{r.batchId}</TableCell>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, FileText, ListChecks } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { arNorm, arIncludes } from "@shared/ar-norm";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

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
  account: string;   // رقم الأكونت
  phone: string;     // رقم التليفون
  batchId: string | null; // رقم الباتش (كل الأرقام اللى اتطلبت مرة واحدة ليها نفس القيمة)
}

const TYPE_LABEL: Record<string, string> = { measure: "قياس", raise: "رفع سرعة", stop: "إيقاف PO" };
// نتائج تعتبر «تم بإيرور» (خلصت المهمة بس من غير نتيجة سليمة)
const ERR_RESULTS = ["tab_closed", "timeout", "stopped", "preempted"];

// حالة العملية بشكل مقروء (الحالة + النتيجة)
function statusText(j: ExecJobRow): string {
  if (j.status === "pending") return "فى الطابور";
  if (j.status === "claimed") return "جارٍ التنفيذ";
  if (j.status === "stale") {
    // اتلغت بعد ما التعليق تكرّر — نوضّح السبب بدل «جهاز التنفيذ مقفول» العام
    if (j.result === "stuck_max_attempts") return "أُلغِيت بعد 3 محاولات (علّقت كل مرة)";
    if (j.result === "stuck_expired") return "أُلغِيت (علّقت أكثر من 6 ساعات)";
    return "أُلغِيت (جهاز التنفيذ مقفول)";
  }
  if (j.status === "done") {
    if (j.result === "tab_closed") return "اتقفل قبل ما يخلص";
    if (j.result === "timeout") return "علّق قبل ما يخلص";
    if (j.result === "stopped") return "اتوقف يدوياً";
    if (j.result === "preempted") return "اتوقف مؤقتاً لطلب عاجل (الباقى اترجّع)";
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
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); }); // الافتراضى: من تاريخ البارحة
  const [to, setTo] = useState(() => ymd(new Date()));
  const [jobs, setJobs] = useState<ExecJobRow[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set()); // صفوف الفحوصات القديمة (متعددة الأرقام) المفتوحة
  const [q, setQ] = useState(""); // بحث برقم الباتش / التليفون / الأكونت / الطالب
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
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

  // إلغاء مهام من الطابور: بالـ ids (رقم/أرقام) أو batchId (باتش كامل). يعلّمها stale ثم يعيد التحميل.
  const cancel = useCallback(async (opts: { ids?: number[]; batchId?: string }, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return;
    setCanceling(true); setError(null);
    try {
      const r = await fetch("/api/exec-queue/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(opts),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || "تعذّر الإلغاء"); }
      await load();
    } catch (e: any) { setError(e.message || "خطأ فى الإلغاء"); } finally { setCanceling(false); }
  }, [load]);

  // بحث برقم الباتش / التليفون / الأكونت / الطالب / المصدر
  const displayed = useMemo(() => {
    const s = arNorm(q.trim());
    if (!s) return jobs;
    return jobs.filter((j) =>
      arIncludes((j.batchId || ""), s) ||
      arIncludes((j.phone || ""), s) ||
      arIncludes((j.account || ""), s) ||
      arIncludes((j.requestedBy || ""), s) ||
      arIncludes((j.source || ""), s),
    );
  }, [jobs, q]);
  const mobileLookup = useMobileLookup(displayed.map((j) => j.phone));

  // إحصائية المعروض: خلص كام من كام + تفريق «تم فعلًا» عن «تم بإيرور»
  const stats = useMemo(() => {
    const total = displayed.length;
    let doneOk = 0, doneErr = 0, active = 0, canceled = 0;
    for (const j of displayed) {
      if (j.status === "done") {
        if (j.result && ERR_RESULTS.includes(j.result)) doneErr++;
        else doneOk++;
      } else if (j.status === "stale") canceled++;
      else active++; // pending/claimed
    }
    const measured = displayed.reduce((s, j) => s + (j.measured || 0), 0);
    return { total, doneOk, doneErr, active, canceled, measured };
  }, [displayed]);

  // ids المهام النشطة (فى الطابور/جارية) المعروضة — لزر الإلغاء الجماعى (يعمل كإلغاء باتش لو البحث مفلتَر على باتش)
  const activeDisplayedIds = useMemo(
    () => displayed.filter((j) => j.status === "pending" || j.status === "claimed").map((j) => j.id),
    [displayed],
  );

  const COLUMNS = ["التاريخ", "النوع", "رقم التليفون", "رقم الموبايل", "رقم الأكونت", "طلبها", "من تقرير", "الباتش", "الحالة"];
  const toRow = (j: ExecJobRow) => [
    fmt(j.createdAt),
    TYPE_LABEL[j.type] || j.type,
    j.phone || "-",
    mobileLookup[phoneLookupKey(j.phone)] || "-",
    j.account || "-",
    j.requestedBy || "-",
    j.source || "-",
    j.batchId || "-",
    statusText(j),
  ];

  const handleExportExcel = () => {
    const aoa = [COLUMNS, ...displayed.map(toRow)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "معاملات التنفيذ");
    XLSX.writeFile(wb, `exec-jobs-${from}_${to}.xlsx`);
  };

  const handleExportPDF = () => {
    printTablePDF({ title: `تقرير معاملات التنفيذ (${from} → ${to})`, columns: COLUMNS, rows: displayed.map(toRow) });
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
        <div className="grid gap-1 flex-1 min-w-[220px]">
          <label className="text-xs text-muted-foreground">بحث برقم الباتش / التليفون / الأكونت</label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب رقم الباتش أو التليفون أو الأكونت…" className="h-9" dir="rtl" />
        </div>
      </div>

      {/* إحصائية: خلص كام من كام (على المعروض — يتحدّث مع البحث بالباتش) */}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">إجمالى: <strong>{stats.total}</strong></span>
        <span className="px-2 py-1 rounded bg-green-100 text-green-800">تم فعلًا: <strong>{stats.doneOk}</strong> من {stats.total}</span>
        {stats.doneErr > 0 && <span className="px-2 py-1 rounded bg-orange-100 text-orange-800">تم بإيرور (اتقفل/علّق): <strong>{stats.doneErr}</strong></span>}
        <span className="px-2 py-1 rounded bg-blue-100 text-blue-800">قيد التنفيذ/الطابور: <strong>{stats.active}</strong></span>
        {stats.canceled > 0 && <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">أُلغِيت: <strong>{stats.canceled}</strong></span>}
        {q.trim() && <button onClick={() => setQ("")} className="px-2 py-1 rounded border text-muted-foreground hover:text-foreground">مسح البحث ✕</button>}
        {activeDisplayedIds.length > 0 && (
          <button
            onClick={() => cancel(
              { ids: activeDisplayedIds },
              `هل تريد إلغاء ${activeDisplayedIds.length} مهمة نشطة من الطابور؟${q.trim() ? " (المعروض حسب البحث الحالى — يشمل الباتش المفلتَر)" : ""}`,
            )}
            disabled={canceling}
            className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
          >
            {canceling ? "جارٍ الإلغاء…" : `إلغاء المعروض النشط (${activeDisplayedIds.length})`}
          </button>
        )}
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="rounded-md border max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}
              <TableHead className="text-right whitespace-nowrap">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length + 1} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : displayed.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length + 1} className="text-center h-24 text-muted-foreground">{q.trim() ? "لا توجد نتائج للبحث" : "لا توجد عمليات فى الفترة المختارة"}</TableCell></TableRow>
            ) : (
              displayed.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="whitespace-nowrap">{fmt(j.createdAt)}</TableCell>
                  <TableCell>{TYPE_LABEL[j.type] || j.type}</TableCell>
                  <TableCell className="align-top">
                    {(() => {
                      const phones = (j.phone || "").split("،").map((x) => x.trim()).filter(Boolean);
                      const accts = (j.account || "").split("،").map((x) => x.trim()).filter(Boolean);
                      const n = Math.max(phones.length, accts.length);
                      // فحص جديد (خط واحد) → اعرض الرقم مباشرة
                      if (n <= 1) return <span className="font-medium whitespace-nowrap">{phones[0] || accts[0] || "-"}</span>;
                      // فحص قديم متعدد الأرقام → زر يعرض القائمة
                      const isOpen = expanded.has(j.id);
                      return (
                        <div>
                          <button
                            onClick={() => setExpanded((prev) => { const s = new Set(prev); s.has(j.id) ? s.delete(j.id) : s.add(j.id); return s; })}
                            className="text-blue-600 hover:underline text-xs whitespace-nowrap"
                          >
                            {isOpen ? "إخفاء ▲" : `عرض ${n} أرقام ▾`}
                          </button>
                          {isOpen && (
                            <div className="mt-1 max-h-40 overflow-auto border rounded p-1 bg-muted/30 min-w-[150px]">
                              {(phones.length ? phones : accts).map((p, i) => (
                                <div key={i} className="font-mono text-xs whitespace-nowrap">{p}{accts[i] && phones.length ? ` — أكونت ${accts[i]}` : ""}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                   <TableCell className="align-top">
                     <MobileValue mobile={mobileLookup[phoneLookupKey(j.phone.split("،")[0]?.trim())]} />
                   </TableCell>
                  <TableCell className="align-top">
                    {(() => {
                      const accts = (j.account || "").split("،").map((x) => x.trim()).filter(Boolean);
                      if (accts.length <= 1) return <span className="whitespace-nowrap">{accts[0] || "-"}</span>;
                      const isOpen = expanded.has(j.id);
                      return (
                        <button
                          onClick={() => setExpanded((prev) => { const s = new Set(prev); s.has(j.id) ? s.delete(j.id) : s.add(j.id); return s; })}
                          className="text-blue-600 hover:underline text-xs whitespace-nowrap"
                        >
                          {isOpen ? "إخفاء ▲" : `${accts.length} أكونت ▾`}
                        </button>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{j.requestedBy || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">{j.source || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {j.batchId ? (
                      <button onClick={() => setQ(j.batchId!)} className="text-blue-600 hover:underline font-mono text-xs" title={"فلترة الباتش: " + j.batchId}>
                        {j.batchId.slice(-6)}
                      </button>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{statusText(j)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {(j.status === "pending" || j.status === "claimed") ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => cancel({ ids: [j.id] }, `إلغاء ${j.phone || j.account || "هذا الرقم"} من الطابور؟`)}
                          disabled={canceling}
                          className="px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50 text-xs disabled:opacity-60"
                        >
                          إلغاء الرقم
                        </button>
                        {j.batchId && (
                          <button
                            onClick={() => cancel({ batchId: j.batchId! }, `إلغاء الباتش كامل (${j.batchId!.slice(-6)}) من الطابور؟ سيتم إلغاء كل الأرقام النشطة فيه.`)}
                            disabled={canceling}
                            className="px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50 text-xs disabled:opacity-60"
                          >
                            إلغاء الباتش
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, FileText, PlugZap, ClipboardCopy } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// «الكباين المغلقة بورتات» — بتكتب فى الخانة الكباين اللى قافلة بورتات (كل كابينة فى سطر:
// سواء بالـ MSAN code أو برقم الكابينة — الاتنين بيطابقوا)، والتقرير بيجيب من «الأعطال الحالية»
// الأرقام اللى كابينتها من ضمن اللى كتبتها، بنفس أعمدة جدول Access:
// ارضى (88+الرقم) / Msan Code / اسم السنترال / FCC code / وقت الشكوى / نوع العطل.
interface Fault {
  phoneShort: string | null;
  centralName: string | null;
  centralCode: string | null;
  cabinetNo: string | null;
  msanCode: string | null;
  complainTime: string | null;
  complainTypeName: string | null;
  statusCode: string | null;
}

const LS_KEY = "closedPortCabinets";              // كاش محلى فورى (يظهر بسرعة قبل رد السيرفر)
const SETTING_KEY = "closed_port_cabinets";       // مفتاح الإعداد المشترك على السيرفر (يثبت للكل)

// تطبيع مفتاح المطابقة: إزالة المسافات والمحارف غير الأرقام/الحروف للمقارنة المرنة.
const norm = (s: string | null | undefined) =>
  String(s ?? "").trim().replace(/\s+/g, "").toLowerCase();

// تاريخ الشكوى بصيغة الإيميل: 2026-06-16 19:11:16.0 (كما هى UTC بدون إزاحة المتصفح).
const fmtComplain = (d: string | null) => {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}.0`;
};

export function ClosedPortCabinetsReport() {
  const [all, setAll] = useState<Fault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedText, setClosedText] = useState<string>(() => {
    try { return localStorage.getItem(LS_KEY) || ""; } catch { return ""; }
  });
  const serverLoaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // تحميل القائمة المشتركة من السيرفر عند الفتح — تثبت لكل المستخدمين لحد ما حد يغيّرها.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/settings/${SETTING_KEY}`, { credentials: "include" });
        if (r.ok) {
          const d = await r.json();
          if (d && typeof d.value === "string") {
            setClosedText(d.value);
            try { localStorage.setItem(LS_KEY, d.value); } catch {}
          }
        }
      } catch {}
      serverLoaded.current = true;
    })();
  }, []);

  // حفظ محلى فورى + حفظ على السيرفر (debounced) بعد أول تحميل من السيرفر (عشان مايكتبش قيمة قديمة).
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, closedText); } catch {}
    if (!serverLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/settings/${SETTING_KEY}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: closedText }),
      }).catch(() => {});
    }, 800);
  }, [closedText]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/reports/current-faults", { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر التحميل");
      const d = await r.json();
      setAll(Array.isArray(d) ? d : []);
    } catch (e: any) { setError(e.message || "خطأ"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // مجموعة الكباين المغلقة (من الـ textarea) — كل سطر كابينة (MSAN code أو رقم كابينة).
  const closedSet = useMemo(() => {
    const set = new Set<string>();
    for (const line of closedText.split(/[\n,،]+/)) {
      const k = norm(line);
      if (k) set.add(k);
    }
    return set;
  }, [closedText]);

  // الأرقام اللى كابينتها مغلقة بورتات: نطابق بالـ MSAN code أو برقم الكابينة (أيهما اتكتب).
  const rows = useMemo(() => {
    if (closedSet.size === 0) return [];
    return all.filter((f) => closedSet.has(norm(f.msanCode)) || closedSet.has(norm(f.cabinetNo)));
  }, [all, closedSet]);

  // أعمدة جدول Access (بالترتيب): ارضى / Msan Code / اسم السنترال / FCC code / وقت الشكوى / نوع العطل.
  const COLUMNS = ["ارضى", "Msan Code", "اسم السنترال", "FCC code", "وقت الشكوى", "نوع العطل"];
  const toRow = (f: Fault) => [
    f.phoneShort ? "88" + f.phoneShort : "",
    f.msanCode || "",
    f.centralName || "",
    f.centralCode || "",
    fmtComplain(f.complainTime),
    f.complainTypeName || f.statusCode || "",
  ];

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows.map(toRow)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "كباين مغلقة بورتات");
    XLSX.writeFile(wb, `closed-port-cabinets-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const handleExportPDF = () => printTablePDF({ title: "الكباين المغلقة بورتات", columns: COLUMNS, rows: rows.map(toRow) });

  // نسخ الجدول كـ HTML بحدود → يتلصق فى الإيميل مباشرة بالبوردر.
  const handleCopyTable = async () => {
    const cell = (t: any, head = false) =>
      `<${head ? "th" : "td"} style="border:1px solid #000;padding:4px 8px;${head ? "background:#f2f2f2;" : ""}white-space:nowrap">${t ?? ""}</${head ? "th" : "td"}>`;
    const head = `<tr>${COLUMNS.map((c) => cell(c, true)).join("")}</tr>`;
    const body = rows.map((f) => `<tr>${toRow(f).map((c) => cell(c || "")).join("")}</tr>`).join("");
    const html = `<table dir="rtl" border="1" style="border-collapse:collapse;font-family:Arial;font-size:13px">${head}${body}</table>`;
    const text = [COLUMNS, ...rows.map(toRow)].map((r) => r.join("\t")).join("\n");
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      alert("تم نسخ الجدول (بحدود) — الصقه فى الإيميل مباشرة (Ctrl+V)");
    } catch (e) {
      try { await navigator.clipboard.writeText(text); alert("تم نسخ الجدول كنص (المتصفح لا يدعم نسخ الجدول المنسّق)"); }
      catch { alert("تعذّر النسخ"); }
    }
  };

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><PlugZap className="w-5 h-5 text-amber-600" /> الكباين المغلقة بورتات</h2>
          <p className="text-xs text-muted-foreground">اكتب الكباين المغلقة بورتات (كل كابينة فى سطر — بالـ MSAN code أو برقم الكابينة)، والتقرير هيجيب من الأعطال الحالية الأرقام اللى كابينتها من ضمنهم.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} size="sm" className="gap-1" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
          <Button onClick={handleCopyTable} variant="outline" size="sm" className="gap-1 text-indigo-700 border-indigo-200" disabled={!rows.length} title="نسخ الجدول بحدود للصقه فى الإيميل مباشرة"><ClipboardCopy className="w-4 h-4" /> نسخ الجدول</Button>
          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1 text-green-700 border-green-200" disabled={!rows.length}><FileSpreadsheet className="w-4 h-4" /> تصدير Excel</Button>
          <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1 text-red-700 border-red-200" disabled={!rows.length}><FileText className="w-4 h-4" /> تصدير PDF</Button>
        </div>
      </div>

      {/* خانة كتابة الكباين المغلقة بورتات — تتحفظ تلقائياً على الجهاز */}
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">الكباين المغلقة بورتات (كل كابينة فى سطر — MSAN code أو رقم الكابينة)</label>
        <textarea
          value={closedText}
          onChange={(e) => setClosedText(e.target.value)}
          rows={4}
          dir="ltr"
          placeholder={"11-2-26-24\n2-8\n..."}
          className="w-full rounded-md border px-3 py-2 text-sm bg-background font-mono resize-y"
        />
        <div className="text-xs text-muted-foreground">عدد الكباين المكتوبة: <strong>{closedSet.size}</strong> — الأرقام المطابقة: <strong>{rows.length}</strong></div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="rounded-md border max-h-[60vh] overflow-auto">
        <Table>
          <TableHeader><TableRow>{COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : closedSet.size === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">اكتب الكباين المغلقة بورتات فى الخانة أعلاه</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">لا توجد أرقام فى الأعطال الحالية لكباين مغلقة بورتات</TableCell></TableRow>
            ) : rows.map((f, i) => {
              const r = toRow(f);
              return <TableRow key={i}>{r.map((cell, j) => <TableCell key={j} className="whitespace-nowrap">{cell || "-"}</TableCell>)}</TableRow>;
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

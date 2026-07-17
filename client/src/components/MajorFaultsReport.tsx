import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, FileText, AlertOctagon } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// «الأعطال الجسيمة» — الخطوط اللى حالتها «9999 / أعطال تنتظر الحل» (تُعرض 99-DSL).
// نعيد استخدام بيانات «الأعطال الحالية» ونفلتر الحالة دى، ونعرضها بشكل جدول إيميل «اغلاق جسيم».
interface Fault {
  phoneShort: string | null;
  centralName: string | null;
  centralCode: string | null;
  cabinetNo: string | null;
  statusCode: string | null;
  complainTime: string | null;
}

const isMajor = (s: string | null) => !!s && (s.includes("9999") || s.includes("تنتظر الحل"));

// تاريخ الشكوى بصيغة الإيميل: 2026-06-16 19:11:16.0 (كما هى UTC بدون إزاحة المتصفح).
const fmtComplain = (d: string | null) => {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}.0`;
};
// تاريخ رفع الجسيم = تاريخ اليوم (يوم/شهر/سنة) — قابل للتعديل يدوياً فى الإكسيل.
const todayDMY = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

export function MajorFaultsReport() {
  const [rows, setRows] = useState<Fault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/reports/current-faults", { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر التحميل");
      const d = await r.json();
      setRows((Array.isArray(d) ? d : []).filter((f: Fault) => isMajor(f.statusCode)));
    } catch (e: any) { setError(e.message || "خطأ"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // أعمدة جدول «اغلاق جسيم» (بترتيب الإيميل). الأعمدة الفاضية تُملأ يدوياً بعد التصدير.
  const COLUMNS = [
    "كود المحافظة", "رقم التليفون", "اسم السنترال", "كود السنترال",
    "رقم العنصر المرفوع جسيم", "رقم الكابينة الحالى", "سبب رفع الجسيم",
    "تاريخ رفع الجسيم", "تاريخ شكوي المشترك", "ايميل مرسل الطلب",
  ];
  const toRow = (f: Fault) => [
    "88",                       // كود المحافظة (أسيوط)
    f.phoneShort || "",         // رقم التليفون
    f.centralName || "",        // اسم السنترال
    f.centralCode || "",        // كود السنترال (GHNAT/…)
    "",                         // رقم العنصر المرفوع جسيم — يُملأ يدوياً (الكابينة/بكسيات…)
    f.cabinetNo || "",          // رقم الكابينة الحالى
    "صيانة",                    // سبب رفع الجسيم (افتراضى — قابل للتعديل)
    todayDMY(),                 // تاريخ رفع الجسيم (اليوم — قابل للتعديل)
    fmtComplain(f.complainTime),// تاريخ شكوي المشترك
    "",                         // ايميل مرسل الطلب — يُملأ يدوياً
  ];

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows.map(toRow)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أعطال جسيمة");
    XLSX.writeFile(wb, `major-faults-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const handleExportPDF = () => printTablePDF({ title: "الأعطال الجسيمة (اغلاق جسيم)", columns: COLUMNS, rows: rows.map(toRow) });

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><AlertOctagon className="w-5 h-5 text-red-600" /> الأعطال الجسيمة</h2>
          <p className="text-xs text-muted-foreground">الخطوط ذات الحالة «9999 / أعطال تنتظر الحل» (99-DSL) — بشكل جدول «اغلاق جسيم». الأعمدة الفاضية (العنصر المرفوع / الإيميل) تُملأ يدوياً.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} size="sm" className="gap-1" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1 text-green-700 border-green-200" disabled={!rows.length}><FileSpreadsheet className="w-4 h-4" /> تصدير Excel</Button>
          <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1 text-red-700 border-red-200" disabled={!rows.length}><FileText className="w-4 h-4" /> تصدير PDF</Button>
        </div>
      </div>
      <div className="text-sm text-muted-foreground">إجمالى: <strong>{rows.length}</strong> عطل جسيم</div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="rounded-md border max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader><TableRow>{COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">لا توجد أعطال جسيمة حالياً</TableCell></TableRow>
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

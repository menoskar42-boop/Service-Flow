import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, HardHat, FileSpreadsheet, ClipboardCopy, Wrench } from "lucide-react";
import * as XLSX from "xlsx";
import { copyHtmlTable } from "@/lib/copy-table";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

// «أعطال التفتيش الهندسى» — تكتب الأرقام والنظام يبني جدول إيميل «اغلاق تفتيش هندسى» بنفس الأعمدة،
// مع زر «نسخ الجدول» للصقه فى الإيميل مباشرة (بحدود). البيانات تُجلب من بحث برقم التليفون/الشكاوى.
interface Row {
  phoneShort: string | null;
  central: string | null;
  centralCode: string | null;
  currentCabin: string | null;
  lastComplaintAt: string | null;
}

const GOV_CODE = "88";
const REASONS = ["نقل بدون معرفة الشركة بمعرفة العميل", "توزيع غير شرعى للانترنت"];
const DEFAULT_REASON = REASONS[0];
const DEFAULT_EMAIL = "mena.haleem@te.eg";

// تاريخ اليوم بصيغة dd/mm/yyyy
const todayStr = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
// تاريخ الشكوى بصيغة الإيميل: 2026-02-03 19:45:55.0 (UTC كما هى)
const fmtComplain = (iso: string | null) => {
  if (!iso) return "";
  const t = new Date(iso);
  if (isNaN(t.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}.0`;
};

export function EngineeringInspectionReport() {
  const [phonesText, setPhonesText] = useState("");
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const mobileLookup = useMobileLookup(rows.map((x) => x.phoneShort));

  const build = async () => {
    const phones = phonesText.split(/[\s,;]+/).map((s) => s.replace(/\D/g, "")).filter(Boolean);
    if (!phones.length) { setRows([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/reports/engineering-inspection?phones=${encodeURIComponent(phones.join(","))}`, { credentials: "include" });
      const d = await r.json();
      setRows(Array.isArray(d.data) ? d.data : []);
    } catch { setRows([]); } finally { setLoading(false); }
  };

  const COLUMNS = ["كود المحافظة", "رقم التليفون", "رقم الموبايل", "اسم السنترال", "كود السنترال", "رقم الكابينة الحالى", "سبب رفع التفتيش", "تاريخ", "تاريخ شكوى المشترك", "ايميل مرسل الطلب"];
  const toRow = (x: Row) => [
    GOV_CODE, x.phoneShort || "", mobileLookup[phoneLookupKey(x.phoneShort)] || "", x.central || "", x.centralCode || "", x.currentCabin || "",
    reason, todayStr(), fmtComplain(x.lastComplaintAt), email,
  ];

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows.map(toRow)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أعطال التفتيش الهندسى");
    XLSX.writeFile(wb, `engineering-inspection-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // نسخ الجدول كـ HTML بحدود (RTL + أرقام لاتينية) → يتلصق فى الإيميل مباشرة.
  const handleCopyTable = async () => {
    const ok = await copyHtmlTable(COLUMNS, rows.map(toRow));
    alert(ok ? "تم نسخ الجدول (بحدود) — الصقه فى الإيميل مباشرة (Ctrl+V)" : "تعذّر النسخ");
  };

  const count = phonesText.split(/[\s,;]+/).map((s) => s.replace(/\D/g, "")).filter(Boolean).length;

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><HardHat className="w-5 h-5 text-amber-600" /> أعطال التفتيش الهندسى</h2>
          <p className="text-xs text-muted-foreground">اكتب أرقام التليفونات (كل رقم فى سطر أو مفصولة بفاصلة)، والنظام يبني جدول إيميل «اغلاق تفتيش هندسى» — انسخه بزر «نسخ الجدول» والصقه فى الإيميل.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={build} size="sm" className="gap-1" disabled={loading || !count}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} بناء الجدول</Button>
          <Button onClick={handleCopyTable} variant="outline" size="sm" className="gap-1 text-indigo-700 border-indigo-200" disabled={!rows.length} title="نسخ الجدول بحدود للصقه فى الإيميل مباشرة"><ClipboardCopy className="w-4 h-4" /> نسخ الجدول</Button>
          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1 text-green-700 border-green-200" disabled={!rows.length}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-sm font-medium">أرقام التليفونات</label>
          <textarea
            value={phonesText}
            onChange={(e) => setPhonesText(e.target.value)}
            placeholder={"2655477\n2657342\n..."}
            className="min-h-[110px] border rounded-md p-2 text-sm font-mono" dir="ltr"
          />
          <span className="text-xs text-muted-foreground">عدد الأرقام المكتوبة: <strong>{count}</strong></span>
        </div>
        <div className="grid gap-2 content-start">
          <div className="grid gap-1">
            <label className="text-sm font-medium">سبب رفع التفتيش</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="border rounded-md px-3 py-2 text-sm" dir="rtl">
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium">ايميل مرسل الطلب</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} className="text-sm" dir="ltr" />
          </div>
          <p className="text-xs text-muted-foreground">«تاريخ» = تاريخ اليوم تلقائياً، و«كود المحافظة» = 88.</p>
        </div>
      </div>

      <div className="rounded-md border max-h-[55vh] overflow-auto">
        <Table>
          <TableHeader><TableRow>{COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">اكتب الأرقام واضغط «بناء الجدول»</TableCell></TableRow>
            ) : rows.map((x, i) => (
              <TableRow key={i}>
                 {toRow(x).map((cell, j) => <TableCell key={j} className="whitespace-nowrap">{j === 2 ? <MobileValue mobile={mobileLookup[phoneLookupKey(x.phoneShort)]} /> : (cell || "-")}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

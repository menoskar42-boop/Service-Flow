import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, FileText, AlertTriangle, Wrench, X, Eye, User, Phone } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { useAuth } from "@/hooks/use-auth";
import { useIsSuperAdmin } from "@/lib/use-speed-tools";
import { ROLES } from "@shared/schema";
import { CLOSE_CODE_REASONS } from "@/lib/close-codes";
import { dispatchSpeedTool } from "@/lib/exec-queue";

// «الأعطال الحالية خارج الشاشة» — الأعطال اليدوية (زر «الخط به عطل») اللى لسه ماانتظمتش.
interface Row {
  id: number;
  fullPhone: string | null;
  phoneShort: string | null;
  accountNo: string | null;
  central: string | null;
  cabinNumber: string | null;
  boxNumber: string | null;
  msanCode: string | null;
  techName: string | null;
  flaggedAt: string;
  flaggedBy: string | null;
  // بيانات مُثراة (نفس الأعطال الحالية)
  frame: string | null; shelf: string | null; slot: string | null; portNumber: string | null;
  portType: string | null; voiceStatus: string | null; dataStatus: string | null; operator: string | null; onu: string | null;
  lineCurrentSpeed: string | null; lineMaxSpeed: string | null;
  lastMeasScore: number | null; lastMeasComplainNo: string | null; lastMeasTime: string | null;
  curMeasScore: number | null; curMeasCurrentSpeed: string | null; curMeasMaxSpeed: string | null; curMeasTime: string | null;
  lastPoRaiseAt: string | null; lastPoStopAt: string | null;
  mobile: string | null;
}

// تطبيع رقم المحمول للاتصال: أرقام فقط + إضافة صفر بادئ لو ناقص (1552… → 01552…)
const dialMobile = (raw: string | null): string => {
  const m = String(raw || "").replace(/\D/g, "");
  if (!m) return "";
  return m.startsWith("0") ? m : "0" + m;
};

const fmt = (iso: string | null) => {
  if (!iso) return "-";
  try { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; }
  catch { return iso; }
};

export function ManualCurrentFaultsReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // انتظام العطل — نفس منطق «بحث برقم التليفون» (سبب إغلاق + فنى للسوبر أدمن + قياس أوتوماتيك).
  const { user } = useAuth();
  const isSuper = useIsSuperAdmin();
  const canRegularize = isSuper || user?.role === ROLES.TECH;
  const { data: techList } = useQuery<{ workerCode: string; techName: string }[]>({
    queryKey: ["/api/technician-names"],
    queryFn: async () => { const r = await fetch("/api/technician-names", { credentials: "include" }); return r.ok ? r.json() : []; },
    enabled: isSuper,
    staleTime: 5 * 60 * 1000,
  });
  const techOptions = Array.from(new Set((techList ?? []).map((t) => (t.techName || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar"));
  const [regRow, setRegRow] = useState<Row | null>(null);
  const [regCode, setRegCode] = useState("");
  const [regTech, setRegTech] = useState("");
  const [regBusy, setRegBusy] = useState(false);
  // فلتر «أعطالى» — أعطال الفني نفسه (بالاسم فى «اسم الفنى» أو «سجّل العطل»)
  const [onlyMine, setOnlyMine] = useState(false);
  // أسمائى + أسماء الزملاء اللى لى تغطية عليهم (منح دائمة) — كلهم يظهروا فى «أعطالى»
  const myNames = [(user as any)?.techName, user?.username, ...(((user as any)?.coveredTechNames as string[]) ?? [])]
    .map((s) => String(s || "").trim().toLowerCase()).filter(Boolean);
  const isMine = (x: Row) => {
    const t = String(x.techName || "").trim().toLowerCase();
    const f = String(x.flaggedBy || "").trim().toLowerCase();
    return myNames.some((n) => n === t || n === f);
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/manual-faults/current", { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر التحميل");
      const d = await r.json();
      setRows(d.data ?? []);
    } catch (e: any) { setError(e.message || "خطأ"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // «معاينة»: يفتح تاب «بحث برقم التليفون» ويحط الرقم ويبحث (عبر sessionStorage + حدث للـ dashboard).
  const openLookup = (x: Row) => {
    const phone = (x.fullPhone || x.phoneShort || "").toString().replace(/\D/g, "");
    if (!phone) return;
    try { sessionStorage.setItem("sf_lookup_phone", phone); } catch {}
    window.dispatchEvent(new CustomEvent("sf-open-phone-lookup", { detail: phone }));
  };

  const submitRegularize = async () => {
    if (!regRow) return;
    if (!regCode) { alert("اختر سبب الإغلاق"); return; }
    if (isSuper && !regTech) { alert("اختر فنى الانتظام"); return; }
    setRegBusy(true);
    try {
      const body: any = { fullPhone: regRow.fullPhone || regRow.phoneShort, phoneShort: regRow.phoneShort || regRow.fullPhone, closeCode: regCode };
      if (isSuper && regTech) body.techName = regTech;
      const r = await fetch("/api/manual-faults/regularize", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) { alert(d?.message || "تعذّر تسجيل الانتظام"); return; }
      const acc = (regRow.accountNo ?? "").toString().trim();
      setRegRow(null); setRegCode(""); setRegTech("");
      await load();
      // قياس أوتوماتيك لو الخط ليه أكونت (نفس منطق بحث برقم التليفون)
      if (acc) { await dispatchSpeedTool("measure", [acc], isSuper); }
      else { alert("تم تسجيل الانتظام"); }
    } finally { setRegBusy(false); }
  };

  // ترتيب الأعمدة: بيانات الموقع (سنترال→الفريم) الأول، وبعدها بيانات الأكونت والقياس.
  // ملاحظة: عمود «رقم التليفون» لازم يفضل index 1 لأن أزرار المعاينة/تسجيل الانتظام
  // بتترسم جوّه الخلية دى (i === 1 فى الـ JSX تحت).
  const COLUMNS = [
    "تاريخ العطل", "رقم التليفون", "السنترال", "الكابينة", "البكس", "كود MSAN", "اسم الفنى", "الفريم",
    "رقم الأكونت", "السرعة الحالية", "أقصى سرعة", "الاسكور", "تاريخ آخر قياس", "القياس الحالى",
    "Shelf", "Slot", "Port", "Port Type", "voice", "data", "operator", "ONU",
    "آخر رفع سرعة", "آخر إيقاف PO", "سجّل العطل",
  ];
  const dash = (v: any) => (v == null || v === "" ? "-" : String(v));
  const toRow = (x: Row) => [
    fmt(x.flaggedAt), x.fullPhone || x.phoneShort || "-",
    dash(x.central), dash(x.cabinNumber), dash(x.boxNumber), dash(x.msanCode), dash(x.techName), dash(x.frame),
    dash(x.accountNo), dash(x.lineCurrentSpeed), dash(x.lineMaxSpeed), dash(x.lastMeasScore), fmt(x.lastMeasTime), dash(x.curMeasScore),
    dash(x.shelf), dash(x.slot), dash(x.portNumber), dash(x.portType),
    dash(x.voiceStatus), dash(x.dataStatus), dash(x.operator), dash(x.onu), fmt(x.lastPoRaiseAt), fmt(x.lastPoStopAt), dash(x.flaggedBy),
  ];

  const shown = onlyMine ? rows.filter(isMine) : rows;

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...shown.map(toRow)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أعطال حالية خارج الشاشة");
    XLSX.writeFile(wb, `manual-current-faults.xlsx`);
  };
  const handleExportPDF = () => printTablePDF({ title: "الأعطال الحالية خارج الشاشة", columns: COLUMNS, rows: shown.map(toRow) });

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-600" /> الأعطال الحالية خارج الشاشة</h2>
          <p className="text-xs text-muted-foreground">أعطال يدوية مسجّلة من زر «الخط به عطل» فى بحث برقم التليفون ولم تنتظم بعد.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} size="sm" className="gap-1" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
          <Button onClick={() => setOnlyMine((v) => !v)} size="sm" variant={onlyMine ? "default" : "outline"} className={`gap-1 ${onlyMine ? "bg-blue-600 hover:bg-blue-700" : "text-blue-700 border-blue-200"}`} title="عرض أعطالى فقط">
            <User className="w-4 h-4" /> {onlyMine ? "الكل" : "أعطالى"}
          </Button>
          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1 text-green-700 border-green-200" disabled={!shown.length}><FileSpreadsheet className="w-4 h-4" /> تصدير Excel</Button>
          <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1 text-red-700 border-red-200" disabled={!shown.length}><FileText className="w-4 h-4" /> تصدير PDF</Button>
        </div>
      </div>
      <div className="text-sm text-muted-foreground">إجمالى: <strong>{shown.length}</strong>{onlyMine && shown.length !== rows.length ? <> من {rows.length}</> : null} عطل مفتوح</div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="rounded-md border max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader><TableRow>{COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : shown.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">لا توجد أعطال حالية خارج الشاشة</TableCell></TableRow>
            ) : shown.map((x) => {
              const cells = toRow(x);
              return (
                <TableRow key={x.id}>
                  {cells.map((val, i) => (
                    <TableCell key={i} className="whitespace-nowrap">
                      {i === 1 ? (
                        <span className="inline-flex items-center gap-2 font-medium">
                          {val}
                          <button type="button" onClick={() => openLookup(x)}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50">
                            <Eye className="w-3.5 h-3.5" /> معاينة
                          </button>
                          {canRegularize && (
                            <button type="button" onClick={() => { setRegRow(x); setRegCode(""); setRegTech(""); }}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50">
                              <Wrench className="w-3.5 h-3.5" /> تسجيل الانتظام
                            </button>
                          )}
                          {dialMobile(x.mobile) && (
                            <a href={`tel:${dialMobile(x.mobile)}`}
                              className="md:hidden inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              title={`اتصال بالعميل: ${dialMobile(x.mobile)}`}>
                              <Phone className="w-3.5 h-3.5" /> اتصال
                            </a>
                          )}
                        </span>
                      ) : (val || "-")}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* نافذة تسجيل الانتظام — نفس منطق بحث برقم التليفون */}
      {regRow && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={() => setRegRow(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold">تسجيل الانتظام — {regRow.fullPhone || regRow.phoneShort}</h3>
              <button onClick={() => setRegRow(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">سبب الإغلاق *</label>
              <select value={regCode} onChange={(e) => setRegCode(e.target.value)} className="border rounded-md px-3 py-2 text-sm" dir="rtl">
                <option value="">اختر سبب الإغلاق</option>
                {Object.entries(CLOSE_CODE_REASONS).map(([code, reason]) => <option key={code} value={code}>{code} - {reason}</option>)}
              </select>
            </div>
            {isSuper && (
              <div className="grid gap-1">
                <label className="text-sm text-muted-foreground">فنى الانتظام *</label>
                <select value={regTech} onChange={(e) => setRegTech(e.target.value)} className="border rounded-md px-3 py-2 text-sm" dir="rtl">
                  <option value="">اختر الفنى</option>
                  {techOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">بعد التسجيل هيتقاس الخط أوتوماتيك لو ليه رقم أكونت.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setRegRow(null)}>إلغاء</Button>
              <Button size="sm" onClick={submitRegularize} disabled={regBusy} className="bg-green-600 hover:bg-green-700 gap-1">
                {regBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} تسجيل الانتظام
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

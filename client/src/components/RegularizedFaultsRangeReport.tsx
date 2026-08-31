import { useState } from "react";
import { useSpeedToolsVisible, useIsSuperAdmin } from "@/lib/use-speed-tools";
import { useSpeedToolSource } from "@/hooks/use-speed-tool-source";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer, Repeat, Radar, Gauge, EyeOff, Phone } from "lucide-react";
import { openProfileOptimization } from "@/lib/profile-optimization";
import { dispatchSpeedTool } from "@/lib/exec-queue";
import { Measurement138Button, type Measurement138 } from "@/components/Measurement138Button";
import { closeReason } from "@/lib/close-codes";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";
interface RegularizedFault extends Measurement138 {
  ticketId: string | null;
  centralName: string | null;
  phoneShort: string | null;
  mobile: string | null;
  repeatStatus: string;
  statusCode: string | null;
  closeCode: string | null;
  msanCode: string | null;
  frame: string | null;
  cabinetNo: string | null;
  boxNo: string | null;
  dpTerminal: string | null;
  complainTime: string | null;
  complainTypeName: string | null;
  regStatus: string | null;
  closeDate: string | null;
  firstCloseDate: string | null;
  lastCloseDate: string | null;
  onu: string | null;
  workerCode: string | null;
  techName: string | null;
  hayaKarima: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  shelf: string | null;
  slot: string | null;
  portNumber: string | null;
  centralCode: string | null;
  lastPoRaiseAt: string | null;
  lastPoStopAt: string | null;
  dataSource: "تفاصيل" | "متبقى";
}

// الأوقات من ملف TicketQueue مخزَّنة كـ UTC — تُعرض كما هى دون إزاحة المتصفح.
const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

// تطبيع رقم المحمول للاتصال: أرقام فقط + إضافة صفر بادئ لو ناقص (1552… → 01552…)
const dialMobile = (raw: string | null): string => {
  const mobile = String(raw || "").replace(/\D/g, "");
  if (!mobile) return "";
  return mobile.startsWith("0") ? mobile : `0${mobile}`;
};

// يختصر الـ status code: "DSL-هوائية-160160" → "DSL-160"
// (يشيل كلمة "هوائية" ويصغّر الكود المضاعف 160160→160) لتصغير عرض العمود.
const shortStatusCode = (s: string | null) => {
  if (!s) return s;
  // كود السنترال: رقم مضاعف (160160→160) أو أول رقم 3 خانات (مثل 173 فى "Re-open TTS 173").
  const doubled = s.match(/(\d{3})\1/);
  const three = s.match(/\b(\d{3})\b/);
  const code = doubled ? doubled[1] : three ? three[1] : "";
  if (code) return `DSL-${code}`;
  // fallback: شيل "هوائية" وصغّر أى كود مضاعف.
  return s
    .split("-")
    .map((p) => p.trim())
    .filter((p) => p && p !== "هوائية")
    .map((p) =>
      /^\d+$/.test(p) && p.length % 2 === 0 && p.slice(0, p.length / 2) === p.slice(p.length / 2)
        ? p.slice(0, p.length / 2)
        : p,
    )
    .join("-");
};

// رابط بوابة DZS expresse — يُفتح في تاب جديد ويُمرَّر أرقام الأكونت فى الـ hash.
const DZS_URL = "https://10.42.187.101:8080/expresse/";

// sf_accounts = أرقام الأكونت (lineIds)، sf_meta = أكونت~شكوى~تليفون~تليفون-كامل
// ليكتبها الـ Tampermonkey فى الشيت بنفس ترتيب 138.
type DZSItem = { account: string; complaint?: string | null; short?: string | null; full?: string | null };
const buildDZSUrl = (items: DZSItem[]) => {
  const accounts = items.map((it) => it.account);
  return `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;
};

export function RegularizedFaultsRangeReport() {
  const showSpeedTools = useSpeedToolsVisible();
  const isSuper = useIsSuperAdmin();
  const { user } = useAuth();
  const isTechnician = user?.role === ROLES.TECH;
  useSpeedToolSource("الأعطال المنتظمة (مدى)");
  const [central, setCentral] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    return `${today.slice(0, 8)}01`;
  });
  const [dateTo, setDateTo] = useState(() => {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  });
  const [measuredBefore, setMeasuredBefore] = useState("");
  const [repeatedOnly, setRepeatedOnly] = useState(false);
  const [closeReasonF, setCloseReasonF] = useState(""); // فلتر سبب الإغلاق (مثال: عطل يخص راوتر العميل)
  // استبعاد أرقام الأكونت الموجودة فى أى باتش قياس/رفع سرعة/إيقاف ما زال فى الطابور
  const [excludeQueued, setExcludeQueued] = useState(false);

  // المصدر: complaint_details (شيت التفاصيل من ملف 430D) مفلتراً بـ close_time.
  const { data: faults = [], isFetching } = useQuery<RegularizedFault[]>({
    queryKey: ["/api/reports/regularized-faults-range", central, q, dateFrom, dateTo, measuredBefore, excludeQueued, isTechnician],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (central) p.set("central", central);
      if (q) p.set("q", q);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      if (measuredBefore) p.set("measuredBefore", measuredBefore);
      if (excludeQueued) p.set("excludeQueued", "1");
      const res = await fetch(`/api/reports/regularized-faults-range?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const rangeLabel = dateFrom || dateTo
    ? `من ${dateFrom || "البداية"} إلى ${dateTo || "النهاية"}`
    : "كل الفترات";

  // قائمة أسباب الإغلاق الموجودة فعلاً فى النتيجة (للدروب‌ليست)
  const reasonOptions = Array.from(new Set(faults.map((f) => closeReason(f.closeCode)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ar"));

  // عند تفعيل زر "المكرر فقط" نعرض/نصدّر الأعطال المكررة فقط + فلتر سبب الإغلاق لو متحدّد.
  const displayed = (repeatedOnly ? faults.filter((f) => f.repeatStatus === "مكرر") : faults)
    .filter((f) => !closeReasonF || closeReason(f.closeCode) === closeReasonF);
  const mobileLookup = useMobileLookup(displayed.map((f) => f.phoneShort));

  // يجمع أرقام الأكونت من الأعطال المعروضة (يحذف المكرر ويتجاهل اللى مالهاش
  // أكونت) ويفتح تاب DZS واحد يمرّر الأرقام فى الـ hash ليقيسها الـ Tampermonkey.
  const toItem = (f: RegularizedFault): DZSItem => ({
    account: (f.accountNo ?? "").toString().trim(),
    complaint: f.ticketId ?? "",
    short: f.phoneShort ?? "",
    full: f.phoneShort ? "88" + f.phoneShort : "",
  });

  const handleMeasureDZS = async () => {
    const seen = new Set<string>();
    const items = displayed
      .map(toItem)
      .filter((it) => it.account && !seen.has(it.account) && seen.add(it.account));
    if (items.length === 0) {
      alert("لا توجد أرقام أكونت فى الأعطال المعروضة — لا شىء للقياس");
      return;
    }
    if (await dispatchSpeedTool("measure", items.map((i) => i.account), isSuper)) return;
    window.open(buildDZSUrl(items), "dzs_measure");
  };

  // رفع السرعة / إيقاف PO لأرقام الأعطال المعروضة.
  const handleRaisePO = async (kind: "raise" | "stop") => {
    const seen = new Set<string>();
    const accounts = displayed
      .map((f) => (f.accountNo ?? "").toString().trim())
      .filter((a) => a && !seen.has(a) && seen.add(a));
    if (accounts.length === 0) { alert("لا توجد أرقام أكونت فى الأعطال المعروضة"); return; }
    if (await dispatchSpeedTool(kind === "stop" ? "stop" : "raise", accounts, isSuper)) return;
    const afterStop = kind === "raise"
      ? window.confirm("رفع السرعة والإيقاف؟\n\nموافق = رفع السرعة لكل الأرقام ثم إيقاف الـ Nightly الناتج لكلهم\nإلغاء = رفع السرعة فقط")
      : false;
    openProfileOptimization(accounts, kind === "stop" ? { stopOnly: true } : { afterStop });
  };

  // يفتح تاب DZS لخط واحد (الزر بجوار كل خط).
  const openDZSSingle = async (f: RegularizedFault) => {
    if (await dispatchSpeedTool("measure", [toItem(f).account], isSuper)) return;
    window.open(buildDZSUrl([toItem(f)]), "dzs_measure");
  };

  const handleExportExcel = () => {
    const rows = displayed.map((f, i) => ({
      "#": i + 1,
      "المصدر": f.dataSource === "متبقى" ? "تحت الفحص" : "مؤرشفة",
      "Field1": f.centralName,
      "رقم التلفون": f.phoneShort,
      "رقم الموبايل": f.mobile,
      "رقم الأكونت": f.accountNo,
      "القياس الحالى (نفس الشكوى)": f.curMeasScore,
      "آخر قياس للرقم": f.lastMeasScore,
      "موقف التكرار": f.repeatStatus,
      "Status Code": f.statusCode,
      "سبب الإغلاق": closeReason(f.closeCode),
      "MSAN Code": f.msanCode,
      "Frame": f.frame,
      "رقم كابينه نهائى": f.cabinetNo,
      "رقم البكس نهائى": f.boxNo,
      "ترمنال": f.dpTerminal,
      "وقت الشكوي": fmtDt(f.complainTime),
      "ComplainTypeName": f.complainTypeName,
      "السرعة الحالية": f.lineCurrentSpeed,
      "أقصى سرعة": f.lineMaxSpeed,
      "الاسكور": f.lastMeasScore,
      "تاريخ آخر قياس": fmtDt(f.lastMeasTime ?? null),
      "حالة الانتظام": f.regStatus,
      "أول إغلاق": fmtDt(f.firstCloseDate),
      "آخر إغلاق": fmtDt(f.lastCloseDate),
      "Onu": f.onu,
      "كود العامل": f.workerCode,
      "اسم الفنى": f.techName,
      "حياة كريمة ام لا": f.hayaKarima,
      "LastOfVoice Status": f.voiceStatus,
      "LastOfData Status": f.dataStatus,
      "LastOfShelf": f.shelf,
      "LastOfSlot": f.slot,
      "LastOfPort number": f.portNumber,
      "كود السنترال": f.centralCode,
      "آخر رفع سرعة": fmtDt(f.lastPoRaiseAt),
      "آخر إيقاف PO": fmtDt(f.lastPoStopAt),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الاعطال المنتظمة بفترة");
    XLSX.writeFile(wb, `regularized-faults-range-${dateFrom || "all"}_${dateTo || "all"}.xlsx`);
  };

  const handleExportPDF = () => {
    const title = `تقرير الأعطال المنتظمة (${rangeLabel})`;
    const esc = (v: any) =>
      String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 10;
    const totalPages = Math.max(1, Math.ceil(displayed.length / ROWS_PER_PAGE));
    const headRow = `<tr>
       <th>#</th><th>المصدر</th><th>السنترال</th><th>التليفون</th><th>رقم الموبايل</th><th>الأكونت</th><th>قياس حالى</th><th>آخر قياس</th><th>تكرار</th><th>Status</th><th>سبب الإغلاق</th>
      <th>MSAN</th><th>Frame</th>
      <th>الكابينه</th><th>البكس</th><th>ترمنال</th><th>وقت الشكوى</th><th>نوع الشكوى</th>
      <th>السرعة الحالية</th><th>أقصى سرعة</th><th>الاسكور</th><th>تاريخ آخر قياس</th>
      <th>حالة الانتظام</th><th>أول إغلاق</th><th>آخر إغلاق</th><th>كود العامل</th><th>اسم الفنى</th><th>Voice</th><th>Data</th>
    </tr>`;
    let pages = "";
    for (let p = 0; p < totalPages; p++) {
      const chunk = displayed.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const body = chunk.map((f, ci) => `
        <tr class="green">
          <td>${p * ROWS_PER_PAGE + ci + 1}</td>
          <td style="font-size:9px;color:${f.dataSource === 'متبقى' ? '#92400e' : '#166534'}">${esc(f.dataSource === 'متبقى' ? 'تحت الفحص' : 'مؤرشفة')}</td>
          <td>${esc(f.centralName)}</td>
          <td>${esc(f.phoneShort)}</td>
           <td>${esc(f.mobile)}</td>
          <td>${esc(f.accountNo)}</td>
          <td>${esc(f.curMeasScore)}</td>
          <td>${esc(f.lastMeasScore)}</td>
          <td>${esc(f.repeatStatus)}</td>
          <td style="font-size:9px">${esc(f.statusCode)}</td>
          <td style="font-size:9px">${esc(closeReason(f.closeCode))}</td>
          <td style="font-size:9px">${esc(f.msanCode)}</td>
          <td>${esc(f.frame)}</td>
          <td>${esc(f.cabinetNo)}</td>
          <td>${esc(f.boxNo)}</td>
          <td>${esc(f.dpTerminal)}</td>
          <td style="font-size:9px">${esc(fmtDt(f.complainTime))}</td>
          <td style="font-size:9px">${esc(f.complainTypeName)}</td>
           <td>${esc(f.lineCurrentSpeed)}</td>
           <td>${esc(f.lineMaxSpeed)}</td>
           <td>${esc(f.lastMeasScore)}</td>
           <td style="font-size:9px">${esc(fmtDt(f.lastMeasTime ?? null))}</td>
          <td>${esc(f.regStatus)}</td>
          <td style="font-size:9px">${esc(fmtDt(f.firstCloseDate))}</td>
          <td style="font-size:9px">${esc(fmtDt(f.lastCloseDate))}</td>
          <td>${esc(f.workerCode)}</td>
          <td>${esc(f.techName)}</td>
          <td>${esc(f.voiceStatus)}</td>
          <td>${esc(f.dataStatus)}</td>
        </tr>`).join("");
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          <div class="pageno">صفحة ${p + 1} من ${totalPages} — إجمالي: ${displayed.length} عطل</div>
          <table><thead>${headRow}</thead><tbody>${body}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(title)}</title>
      <style>
        body { font-family: Arial, "Segoe UI", sans-serif; font-size: 10px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 13px; margin: 0 0 3px; }
        .pageno { text-align: center; font-size: 9px; color: #64748b; margin-bottom: 6px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
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
        <button onclick="try{window.close()}catch(e){};setTimeout(function(){history.length>1?history.back():location.href='/'},150)" style="padding:6px 14px;background:#475569;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;margin-left:8px">↩ رجوع</button><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>في نافذة الطباعة اختر &quot;حفظ بصيغة PDF&quot; كوجهة الطباعة.</span>
      </div>
      ${pages}
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">من</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            disabled={isTechnician}
            className="text-sm w-auto"
            dir="ltr"
            title={isTechnician ? "التاريخ مثبت للفني على الشهر الحالي" : undefined}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">إلى</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            disabled={isTechnician}
            className="text-sm w-auto"
            dir="ltr"
            title={isTechnician ? "التاريخ مثبت للفني على الشهر الحالي" : undefined}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">استبعد القياس بعد:</span>
          <Input
            type="datetime-local"
            value={measuredBefore}
            onChange={(e) => setMeasuredBefore(e.target.value)}
            className="text-sm w-auto"
            dir="ltr"
            title="يستبعد الخطوط التي تم قياسها بعد هذا التاريخ والوقت، ويُبقي الخطوط التي لم تُقَس أو قِيسَت قبله"
          />
          {measuredBefore && (
            <button
              type="button"
              onClick={() => setMeasuredBefore("")}
              className="text-muted-foreground hover:text-foreground"
              title="مسح فلتر القياس"
            >
              ×
            </button>
          )}
        </div>
        {isTechnician && (
          <span className="text-xs text-muted-foreground bg-slate-100 rounded px-2 py-1">
            التاريخ: الشهر الحالي فقط
          </span>
        )}
        <select
          value={central}
          onChange={(e) => setCentral(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm w-full sm:w-auto"
          dir="rtl"
        >
          <option value="">كل السنترالات</option>
          {CENTRALS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={closeReasonF}
          onChange={(e) => setCloseReasonF(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm w-full sm:w-auto"
          dir="rtl"
          title="فلتر حسب سبب الإغلاق"
        >
          <option value="">كل أسباب الإغلاق</option>
          {reasonOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <Input
          placeholder="بحث برقم التليفون / الكابينه / البكس / status"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:max-w-xs text-sm"
          dir="rtl"
        />
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <Button
          variant={repeatedOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setRepeatedOnly((v) => !v)}
          className={`gap-1 ${repeatedOnly ? "bg-orange-600 hover:bg-orange-700 text-white" : "text-orange-700 border-orange-200"}`}
        >
          <Repeat className="w-4 h-4" /> {repeatedOnly ? "عرض الكل" : "المكرر فقط"}
        </Button>
        <Button
          variant={excludeQueued ? "default" : "outline"}
          size="sm"
          onClick={() => setExcludeQueued((v) => !v)}
          className={`gap-1 ${excludeQueued ? "bg-amber-600 hover:bg-amber-700 text-white" : "text-amber-700 border-amber-300"}`}
          title="استبعاد كل أرقام الأكونت الموجودة حالياً فى طابور القياس أو رفع السرعة أو الإيقاف"
        >
          <EyeOff className="w-4 h-4" />
          {excludeQueued ? "الطابور مستبعَد ✓" : "استبعاد اللى فى الطابور"}
        </Button>
        <span className="text-sm text-muted-foreground">إجمالي: <strong>{displayed.length}</strong> عطل</span>
        {showSpeedTools && (<>
        <Button
          variant="outline" size="sm"
          onClick={handleMeasureDZS}
          disabled={displayed.filter((f) => (f.accountNo ?? "").toString().trim() !== "").length === 0}
          className="text-blue-700 border-blue-200 gap-1"
          title="فتح DZS وقياس أرقام الأكونت المعروضة"
        >
          <Radar className="w-4 h-4" /> قياس DZS
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleRaisePO("raise")} className="text-emerald-700 border-emerald-200 gap-1" title="رفع السرعة (Profile Optimization) لأرقام الأعطال المعروضة">
          <Gauge className="w-4 h-4" /> رفع سرعة
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleRaisePO("stop")} className="text-orange-700 border-orange-200 gap-1" title="إيقاف الـ Nightly PO فقط لأرقام الأعطال المعروضة">
          <Gauge className="w-4 h-4" /> إيقاف PO
        </Button>
        </>)}
        <Button
          variant="outline" size="sm"
          onClick={handleExportExcel}
          disabled={displayed.length === 0}
          className="text-green-700 border-green-200 gap-1"
        >
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={handleExportPDF}
          disabled={displayed.length === 0}
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
                <TableHead className="text-right font-bold text-white">المصدر</TableHead>
                <TableHead className="text-right font-bold text-white">السنترال</TableHead>
                 <TableHead className="text-right font-bold text-white">التليفون</TableHead>
                 <TableHead className="text-right font-bold text-white whitespace-nowrap">رقم الموبايل</TableHead>
                 <TableHead className="text-right font-bold text-white">تكرار</TableHead>
                <TableHead className="text-right font-bold text-white">Status Code</TableHead>
                <TableHead className="text-right font-bold text-white">سبب الإغلاق</TableHead>
                <TableHead className="text-right font-bold text-white">MSAN</TableHead>
                <TableHead className="text-right font-bold text-white">Frame</TableHead>
                <TableHead className="text-right font-bold text-white">الكابينه</TableHead>
                <TableHead className="text-right font-bold text-white">البكس</TableHead>
                <TableHead className="text-right font-bold text-white">ترمنال</TableHead>
                <TableHead className="text-right font-bold text-white">وقت الشكوى</TableHead>
                <TableHead className="text-right font-bold text-white">نوع الشكوى</TableHead>
                 <TableHead className="text-right font-bold text-white">السرعة الحالية</TableHead>
                 <TableHead className="text-right font-bold text-white">أقصى سرعة</TableHead>
                 <TableHead className="text-right font-bold text-white">الاسكور</TableHead>
                 <TableHead className="text-right font-bold text-white whitespace-nowrap">تاريخ آخر قياس</TableHead>
                <TableHead className="text-right font-bold text-white">حالة الانتظام</TableHead>
                <TableHead className="text-right font-bold text-white">أول إغلاق</TableHead>
                <TableHead className="text-right font-bold text-white">آخر إغلاق</TableHead>
                <TableHead className="text-right font-bold text-white">ONU</TableHead>
                <TableHead className="text-right font-bold text-white">كود العامل</TableHead>
                <TableHead className="text-right font-bold text-white">اسم الفنى</TableHead>
                <TableHead className="text-right font-bold text-white">رقم الأكونت</TableHead>
                <TableHead className="text-right font-bold text-white">قياس</TableHead>
                <TableHead className="text-right font-bold text-white">حياة كريمة</TableHead>
                <TableHead className="text-right font-bold text-white">Voice</TableHead>
                <TableHead className="text-right font-bold text-white">Data</TableHead>
                <TableHead className="text-right font-bold text-white">Shelf</TableHead>
                <TableHead className="text-right font-bold text-white">Slot</TableHead>
                <TableHead className="text-right font-bold text-white">Port</TableHead>
                <TableHead className="text-right font-bold text-white">كود السنترال</TableHead>
                <TableHead className="text-right font-bold text-white whitespace-nowrap">آخر رفع سرعة</TableHead>
                <TableHead className="text-right font-bold text-white whitespace-nowrap">آخر إيقاف PO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={36} className="text-center py-16 text-muted-foreground">
                    {isFetching
                      ? "جاري التحميل..."
                      : repeatedOnly
                        ? "لا توجد أعطال مكررة في هذه الفترة"
                        : "لا توجد أعطال منتظمة في هذه الفترة — حدد التواريخ وتأكد من رفع ملفات شكاوى DSL"}
                  </TableCell>
                </TableRow>
              ) : displayed.map((f, i) => (
                <TableRow key={i} className="bg-green-50 hover:bg-green-100">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      f.dataSource === "متبقى"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-green-100 text-green-800"
                    }`}>
                      {f.dataSource === "متبقى" ? "تحت الفحص" : "مؤرشفة"}
                    </span>
                  </TableCell>
                  <TableCell>{f.centralName || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left font-mono">{f.phoneShort || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                       <MobileValue mobile={mobileLookup[phoneLookupKey(f.phoneShort)] ?? f.mobile} />
                    </span>
                  </TableCell>
                  <TableCell>
                    {f.repeatStatus === "مكرر" ? (
                      <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">مكرر</span>
                    ) : ""}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate">{shortStatusCode(f.statusCode) || "-"}</TableCell>
                  <TableCell className="max-w-[150px] truncate text-xs" title={closeReason(f.closeCode)}>{closeReason(f.closeCode) || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left">{f.msanCode || "-"}</TableCell>
                  <TableCell>{f.frame || "-"}</TableCell>
                  <TableCell>{f.cabinetNo || "-"}</TableCell>
                  <TableCell>{f.boxNo || "-"}</TableCell>
                  <TableCell>{f.dpTerminal || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(f.complainTime)}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{f.complainTypeName || "-"}</TableCell>
                   <TableCell className="font-mono">{f.lineCurrentSpeed || "-"}</TableCell>
                   <TableCell className="font-mono">{f.lineMaxSpeed || "-"}</TableCell>
                   <TableCell>{f.lastMeasScore ?? "-"}</TableCell>
                   <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(f.lastMeasTime ?? null)}</TableCell>
                  <TableCell>
                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-800">
                      {f.regStatus || "-"}
                    </span>
                  </TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(f.firstCloseDate)}</TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(f.lastCloseDate)}</TableCell>
                  <TableCell>{f.onu || "-"}</TableCell>
                  <TableCell>{f.workerCode || "-"}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{f.techName || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left font-mono">
                    {f.accountNo ? (
                      <span className="inline-flex items-center gap-1">
                        {f.accountNo}
                        <button
                          type="button"
                          onClick={() => openDZSSingle(f)}
                          title="فتح DZS وقياس هذا الرقم"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Radar className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ) : "-"}
                  </TableCell>
                  <TableCell><Measurement138Button m={f} /></TableCell>
                  <TableCell className="max-w-[100px] truncate">{f.hayaKarima || "-"}</TableCell>
                  <TableCell className="text-xs">{f.voiceStatus || "-"}</TableCell>
                  <TableCell className="text-xs">{f.dataStatus || "-"}</TableCell>
                  <TableCell>{f.shelf || "-"}</TableCell>
                  <TableCell>{f.slot || "-"}</TableCell>
                  <TableCell>{f.portNumber || "-"}</TableCell>
                  <TableCell>{f.centralCode || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap text-emerald-700">{fmtDt(f.lastPoRaiseAt)}</TableCell>
                  <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap text-orange-700">{fmtDt(f.lastPoStopAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

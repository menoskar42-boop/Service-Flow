import { useState, useRef, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, FileSpreadsheet, Printer, Phone, Radar, IdCard, RefreshCw, UserSearch, AlertTriangle, Wrench, History, X, ArrowLeftRight, Ban } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { CLOSE_CODE_REASONS, closeReason } from "@/lib/close-codes";
import { openCustomer360 } from "@/lib/customer360";
import { openProfileOptimization } from "@/lib/profile-optimization";
import { enqueueIfExecutorActive, latestMeasureAt, latestPoEventAt, sleep, recordOpIntent, canRunLocalExecutor, dispatchSpeedTool, openOpSite, PHONE_LOOKUP_SOURCE } from "@/lib/exec-queue";
import { useSpeedToolSource } from "@/hooks/use-speed-tool-source";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { Gauge } from "lucide-react";
import { maintStatusBadge, boxCoords, type MaintRow } from "@/components/MaintenanceComprehensiveReport";

// بوابة DZS expresse — تُفتح فى تاب جديد ويُمرَّر رقم الأكونت فى الـ hash ليقيسه
// الـ Tampermonkey script (dzs-expresse-v10.user.js) ويرفع النتيجة لشيت 138.
const DZS_URL = "https://10.42.187.101:8080/expresse/";
const buildDZSUrl = (accounts: string[]) =>
  `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;

interface LineData {
  telNo: string;
  central: string;
  cabinNumber: string | null;
  boxNumber: string | null;
  frame: string | null;
  msanCode: string | null;
  techName: string | null;
  iduNo: string | null;
  oduNo: string | null;
  primaryBlockNo: string | null;
  cabinetIn: string | null;
  secBlockNo: string | null;
  cabinetOut: string | null;
  dpTerminal: string | null;
  port: string | null;
  len: string | null;
  fiberBlock: string | null;
  fiberOut: string | null;
  fullPhone: string;
  accountNo: string | null;
  /** الخط اتفحص واتعلّم «بدون أكونت» من مسئول البيانات = صوت بس مش داتا */
  markedNoAccount?: boolean | null;
  noAccountBy?: string | null;
  noAccountAt?: string | null;
  currentSpeed: string | null;
  maxSpeed: string | null;
  score: number | null;
  lastMeasTime: string | null;
  measuredBy: string | null;
  lastPoRaiseAt: string | null;
  raisedBy: string | null;
  lastPoStopAt: string | null;
  stoppedBy: string | null;
  lastComplaintAt: string | null;
  portType: string | null;
  rowNo: string | null;
  columnNo: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  operator: string | null;
  shelf: string | null;
  slot: string | null;
  mobile: string | null;
  mobileManual: boolean | null;
  subName: string | null;
  subAdd: string | null;
  workOrdDate: string | null;
  workOrdNo: string | null;
  ownedByMe: boolean | null;
}

const dash = (v: unknown) =>
  v === null || v === undefined || String(v).trim() === "" ? "-" : String(v);

const fmtDate = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

// يعرض التاريخ + مين عمل العملية (لو معروف): «… — بواسطة فلان»
const withBy = (dateStr: string, by: string | null): ReactNode =>
  by && dateStr !== "-"
    ? <span>{dateStr} <span className="text-xs text-muted-foreground">— بواسطة {by}</span></span>
    : dateStr;

const scoreBadge = (v: number | null) => {
  if (v == null) return <span className="text-gray-400">-</span>;
  const n = Number(v);
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-sm px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

// الحقول الفنية الباقية تُعرض كامل العرض (صف لكل حقل) بعد الصفوف المزدوجة (زى عمود الإكسيل اليمين)
const FULL_WIDTH_FIELDS = new Set<string>([
  "رقم التليفون الكامل", "رقم التليفون", "إحداثيات البكس",
  "operator", "shelf", "slot", "Port", "IDU", "ODU",
  "Primary Block", "Cabinet In", "Sec Block", "Cabinet Out", "Fiber Block", "Fiber Out",
]);

export function PhoneLookupReport() {
  const { user } = useAuth();
  // السوبر أدمن هو مشغّل النظام — يقدر ينفّذ محلياً حتى لو مفيش جهاز تنفيذ مفعّل.
  // باقى المستخدمين لازم يكون فيه جهاز تنفيذ مفعّل، وإلا تظهر رسالة عدم الإتاحة.
  const isSuper = user?.role === ROLES.SUPER_ADMIN;
  useSpeedToolSource(PHONE_LOOKUP_SOURCE);
  const NO_EXECUTOR_MSG = "غير متاح حالياً — لا توجد أجهزة مفعّلة للتنفيذ. فعّل «جهاز التنفيذ» على متصفح السوبر أدمن أولاً.";
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState("");
  // عدّاد يتزايد مع كل ضغطة «بحث» — يدخل فى queryKey لإجبار إعادة التحميل حتى لو الرقم
  // نفسه لم يتغيّر (مثلاً بعد جلب الأكونت من Customer360 فى تاب تانى نرجع ونبحث فيتحدّث).
  const [searchSeq, setSearchSeq] = useState(0);

  const { data, isFetching, error } = useQuery({
    queryKey: ["/api/phone-lines/lookup", phone, searchSeq],
    queryFn: async () => {
      const res = await fetch(`/api/phone-lines/lookup?phone=${encodeURIComponent(phone)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("فشل البحث");
      return res.json() as Promise<{ found: boolean; line?: LineData }>;
    },
    enabled: !!phone,
    staleTime: 0,
  });

  const line = data?.found ? (data.line as LineData) : null;
  const search = () => { setPhone(input.trim()); setSearchSeq((s) => s + 1); };

  // زر «معاينة» من تقرير «الأعطال خارج الشاشة»: يفتح هنا بالرقم ويبحث تلقائياً.
  useEffect(() => {
    const doLookup = (p: any) => {
      const v = String(p || "").replace(/\D/g, "").trim();
      if (!v) return;
      setInput(v); setPhone(v); setSearchSeq((s) => s + 1);
    };
    try { const p = sessionStorage.getItem("sf_lookup_phone"); if (p) { sessionStorage.removeItem("sf_lookup_phone"); doLookup(p); } } catch {}
    const handler = (e: any) => {
      let p = e?.detail;
      try { if (!p) p = sessionStorage.getItem("sf_lookup_phone"); sessionStorage.removeItem("sf_lookup_phone"); } catch {}
      doLookup(p);
    };
    window.addEventListener("sf-open-phone-lookup", handler);
    return () => window.removeEventListener("sf-open-phone-lookup", handler);
  }, []);

  // أزرار القياس/رفع السرعة/الإيقاف:
  //  - السوبر أدمن + الأدمن (ومنه مدير السنترال=admin) + الشئون الخارجية (ومنها مهندس الكوابل=external)
  //    يعملوا على أى خط.
  //  - الفنى: خطوط منطقته فقط (حسب كود كابينة المسان — ownedByMe).
  //  - غير كده (الخط مش تابع لفنى معروف) → مايتسمحش.
  const canUseTools =
    isSuper ||
    user?.role === ROLES.ADMIN ||
    user?.role === ROLES.EXTERNAL ||
    !!line?.ownedByMe;

  // بعد إرسال قياس لجهاز التنفيذ: نستنّى لحد ما وقت آخر قياس للرقم يتحدّث على السيرفر
  // ثم نعيد البحث تلقائياً عشان تظهر النتيجة الجديدة من غير ما المستخدم يعمل حاجة.
  // الانتظار **قابل للإلغاء**: لو القياس وقف لأى سبب، المستخدم يدوس على الزر يلغى الانتظار
  //  ومايفضلش عالق أبداً (وكمان بيلغى تلقائياً بعد المهلة القصوى).
  // awaitingOp: نوع العملية اللى بنستنّاها (قياس/رفع/إيقاف) أو null لو مفيش انتظار.
  const [awaitingOp, setAwaitingOp] = useState<null | "measure" | "raise" | "stop">(null);
  const opCancel = useRef(false);
  const cancelOpWait = () => { opCancel.current = true; setAwaitingOp(null); };
  // بنقرا القيمة قبل الإرسال، ونفضل نسأل السيرفر لحد ما تتحدّث (اتنفّذت) ثم نعيد البحث.
  const readAt = (op: "measure" | "raise" | "stop", account: string) =>
    op === "measure" ? latestMeasureAt(account) : latestPoEventAt(account, op);
  const waitForOpThenRefresh = async (op: "measure" | "raise" | "stop", account: string) => {
    const before = await readAt(op, account);
    opCancel.current = false;
    setAwaitingOp(op);
    const deadline = Date.now() + 8 * 60 * 1000; // نستنّى لحد 8 دقائق (ممكن يكون قدامه مهام فى الطابور)
    try {
      while (Date.now() < deadline) {
        await sleep(5000);
        if (opCancel.current) return; // المستخدم ألغى الانتظار
        const now = await readAt(op, account);
        if (now > before) break; // اتنفّذت العملية فعلاً
      }
    } finally {
      const wasCancelled = opCancel.current;
      setAwaitingOp(null);
      if (!wasCancelled) setSearchSeq((s) => s + 1); // إعادة البحث لعرض النتيجة المحدّثة (مش لو اتلغى)
    }
  };

  // ── رقم الموبايل: عرض + إضافة/تعديل يدوى (يُحفظ فى جدول line_mobiles) ──
  const [editingMobile, setEditingMobile] = useState(false);
  const [mobileInput, setMobileInput] = useState("");
  const [savingMobile, setSavingMobile] = useState(false);
  const saveMobile = async () => {
    if (!line) return;
    setSavingMobile(true);
    try {
      const res = await fetch("/api/line-mobiles", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullPhone: line.fullPhone, mobile: mobileInput.trim() }),
      });
      if (!res.ok) throw new Error();
      setEditingMobile(false);
      setSearchSeq((s) => s + 1); // إعادة البحث ليظهر الموبايل المحدّث
    } catch { alert("تعذّر حفظ رقم الموبايل"); }
    finally { setSavingMobile(false); }
  };
  const mobileCell: ReactNode = !line ? <span className="text-gray-400">-</span>
    : editingMobile
      ? (
        <span className="inline-flex items-center gap-1">
          <input value={mobileInput} onChange={(e) => setMobileInput(e.target.value)} placeholder="رقم الموبايل"
            className="border rounded px-2 py-0.5 text-sm w-36" dir="ltr" />
          <button onClick={saveMobile} disabled={savingMobile}
            className="text-[11px] text-white bg-emerald-600 hover:bg-emerald-700 rounded px-2 py-0.5 disabled:opacity-50">
            {savingMobile ? "..." : "حفظ"}
          </button>
          <button onClick={() => setEditingMobile(false)} className="text-[11px] text-gray-500 px-1">إلغاء</button>
        </span>
      )
      : (
        <span className="inline-flex items-center gap-2">
          <span className="font-semibold" dir="ltr">{line.mobile || "-"}</span>
          {(() => { const d = String(line.mobile || "").replace(/\D/g, ""); const dial = d ? (d.startsWith("0") ? d : "0" + d) : ""; return dial ? (
            <a href={`tel:${dial}`} title={`اتصال بالعميل: ${dial}`}
              className="md:hidden inline-flex items-center gap-1 text-[11px] text-emerald-700 border border-emerald-300 rounded px-1.5 py-0.5 hover:bg-emerald-50">
              <Phone className="w-3 h-3" /> اتصال
            </a>
          ) : null; })()}
          <button onClick={() => { setMobileInput(line.mobile ?? ""); setEditingMobile(true); }}
            className="text-[11px] text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-50">
            {line.mobile ? "تعديل" : "＋ إضافة"}
          </button>
        </span>
      );

  // حالة صيانة البكس من تقرير الصيانة الشامل (تطابق بالسنترال + الكابينة + البكس، الأحدث)
  const { data: boxMaint, isFetching: maintLoading } = useQuery({
    queryKey: ["/api/proxy/maintenance-comprehensive", line?.cabinNumber, line?.boxNumber, line?.central],
    enabled: !!line?.boxNumber,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (line?.cabinNumber) p.set("cabin", String(line.cabinNumber));
      if (line?.boxNumber) p.set("box", String(line.boxNumber));
      const res = await fetch(`/api/proxy/maintenance-comprehensive?${p}`, { credentials: "include" });
      if (!res.ok) return null;
      const j = await res.json();
      const rows: MaintRow[] = Array.isArray(j?.data) ? j.data : [];
      const bx = String(line?.boxNumber ?? "").trim();
      const cb = String(line?.cabinNumber ?? "").trim();
      const cn = String(line?.central ?? "").trim();
      const matches = rows.filter((r) =>
        String(r.box_number).trim() === bx &&
        (!cb || String(r.cabin_number).trim() === cb) &&
        (!cn || (r.central || "").includes(cn) || cn.includes(r.central || "")),
      );
      matches.sort((a, b) => String(b.inspection_date || "").localeCompare(String(a.inspection_date || "")));
      return matches[0] || null;
    },
  });
  const boxMaintCell: ReactNode = line?.boxNumber
    ? (boxMaint ? maintStatusBadge(boxMaint.maintenance_status, boxMaint.maintenance_status_ar)
                : (maintLoading ? <span className="text-gray-400">…</span> : <span className="text-gray-400">لا يوجد</span>))
    : <span className="text-gray-400">-</span>;

  // هل البكس له تذكرة عطل شبكة أرضية (CFM) مفتوحة؟
  const { data: boxGround, isFetching: groundLoading } = useQuery({
    queryKey: ["/api/proxy/box-ground-ticket", line?.central, line?.cabinNumber, line?.boxNumber],
    enabled: !!line?.boxNumber,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (line?.central) p.set("central", String(line.central));
      if (line?.cabinNumber) p.set("cabin", String(line.cabinNumber));
      if (line?.boxNumber) p.set("box", String(line.boxNumber));
      const res = await fetch(`/api/proxy/box-ground-ticket?${p}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ hasOpenTicket: boolean }>;
    },
  });
  const groundCell: ReactNode = line?.boxNumber
    ? (groundLoading && !boxGround ? <span className="text-gray-400">…</span>
       : boxGround?.hasOpenTicket
         ? <span className="text-sm px-2 py-0.5 rounded font-semibold bg-red-100 text-red-800">نعم</span>
         : <span className="text-sm px-2 py-0.5 rounded font-semibold bg-green-100 text-green-800">لا</span>)
    : <span className="text-gray-400">-</span>;

  // إحداثيات البكس من بيانات الصيانة (لو رقم البكس معروف)
  const coords = boxMaint ? boxCoords(boxMaint as any) : { text: "" };
  const coordsCell: ReactNode = !line?.boxNumber
    ? <span className="text-gray-400">-</span>
    : (coords.text
        ? ((coords.url || (coords.lat && coords.lng))
            ? <a className="text-blue-600 underline text-sm" href={coords.url || `https://www.google.com/maps?q=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">{coords.text} 📍</a>
            : <span className="text-sm">{coords.text}</span>)
        : (maintLoading ? <span className="text-gray-400">…</span> : <span className="text-gray-400">-</span>));

  // فتح بوابة DZS وقياس رقم الأكونت الخاص بالخط
  // لو فيه جهاز تنفيذ مفعّل على متصفح تانى → نبعت المهمة للطابور بدل التنفيذ محلياً
  const measureDZS = async () => {
    const acc = (line?.accountNo ?? "").toString().trim();
    if (!acc) { alert("لا يوجد رقم أكونت لهذا الخط — لا يمكن القياس"); return; }
    void recordOpIntent("measure", [acc]);
    if (await enqueueIfExecutorActive("measure", [acc])) {
      alert("تم إضافة الرقم لطابور القياس — هيتنفّذ على جهاز التنفيذ، والصفحة هتتحدّث تلقائياً بعد ظهور النتيجة");
      void waitForOpThenRefresh("measure", acc);
      return;
    }
    if (!isSuper || !canRunLocalExecutor()) { alert(NO_EXECUTOR_MSG); return; }
    // قياس من بحث برقم التليفون → اختار «A recent fix (past 24h)» فى شاشة DZS
    window.open(buildDZSUrl([acc]) + "&sf_fix=recent", "dzs_measure"); // نفس النافذة الثابتة — الجديد يحلّ محل القديم
  };

  // غيّر البورت فى Provisioning (MSAN Replacement) — سوبر أدمن فقط.
  // يفتح Provisioning Portal بماركر مستقل تماماً (sf_msan) — مش زر البورتات (sf_ports) ولا تحديث
  // الملفات ولا التحديث كل نص ساعة. Old Cabin = MSAN الخط تلقائياً؛ New Cabin يُكتب فى نافذة؛
  // PortType/speed ثابتة (SV/WE30). السكربت المدمج بيملأ الفورم ويسيب الـ Submit ليك يدوياً.
  // على «نفس الكابينة» الكود القديم افتراضى = 11-2-76-01 (كابينة مختلفة عن الحالية).
  // لو الكابينة الحالية نفسها = 11-2-76-01 (فيحصل تطابق) نبدّل الـ 76 بـ 26 → 11-2-26-01.
  const SAME_CAB_DEFAULT_OLD = "11-2-76-01";
  const defaultOldFor = (cur: string) => (cur === SAME_CAB_DEFAULT_OLD ? "11-2-26-01" : SAME_CAB_DEFAULT_OLD);

  // يفتح نافذة «غيّر البورت» بقيم افتراضية (نفس الكابينة: New = الحالية، Old = الافتراضى).
  const openChangePort = () => {
    const cur = (line?.msanCode ?? "").toString().trim();
    setMsanMode("same");
    setMsanNew(cur);                  // نفس الكابينة: الوجهة = الحالية
    setMsanOld(defaultOldFor(cur));   // القديم = افتراضى (كابينة مختلفة)
    setMsanPt("SV");                  // مبدئى — هيتظبط تلقائياً على الأكتر فاضى
    ptTouchedFor.current = "";
    setMsanOpen(true);
  };
  // تبديل نوع العملية وملء الحقول: البورتال بيرفض تطابق Old و New.
  //   نفس الكابينة → New = الحالية، Old = افتراضى مختلف.   كابينة أخرى → Old = الحالية، New = الجديدة (تُكتب).
  const setMsanModeAndFill = (mode: "same" | "other") => {
    const cur = (line?.msanCode ?? "").toString().trim();
    setMsanMode(mode);
    ptTouchedFor.current = "";  // كابينة الوجهة اتغيّرت → الاختيار التلقائى يشتغل تانى
    if (mode === "same") { setMsanNew(cur); setMsanOld(defaultOldFor(cur)); }
    else { setMsanOld(cur); setMsanNew(""); }
  };
  const submitChangePort = async () => {
    const phoneShort = (line?.telNo ?? "").toString().replace(/\D/g, "").replace(/^88/, "");
    const oldC = msanOld.trim(), newC = msanNew.trim();
    if (!phoneShort) { alert("لا يوجد رقم تليفون صالح لهذا الخط"); return; }
    if (!oldC || !newC) { alert("املأ كود الكابينة القديم والجديد"); return; }
    if (oldC === newC) { alert("الكود القديم لازم يختلف عن الجديد (البورتال بيرفض تطابقهما)"); return; }
    if (!msanPt) { alert("اختر نوع البورت"); return; }
    setMsanOpen(false);
    // الطابور: بوابة البروفيجن مسار واحد — تغيير البورت وتحديث البورت وتحديث ملف البورتات
    // مايفتحوش مع بعض أبداً. لو مفيش جهاز تنفيذ والمستخدم سوبر أدمن → يفتح محلياً زى الأول.
    const params = { old: oldC, new: newC, pt: msanPt, sp: "WE30" };
    if (await dispatchSpeedTool("portchange", [phoneShort], isSuper, { params })) return;
    openOpSite("portchange", phoneShort, params);
  };

  // «تحديث البورت» (يدوى) — يفتح Provisioning Portal بماركر sf_pcheck (نافذة مستقلة) فيفتح
  // Search For My Requests مرة واحدة، يطابق الرقم، ولو COMPLETED يجيب البورت الجديد ويحدّث بيان
  // البورت فى Service-Flow. بديل المتابعة التلقائية القديمة كل نص ساعة — دلوقتى يدوى بالكامل.
  const refreshPort = async () => {
    const phoneShort = (line?.telNo ?? "").toString().replace(/\D/g, "").replace(/^88/, "");
    if (!phoneShort) { alert("لا يوجد رقم تليفون صالح لهذا الخط"); return; }
    const params = { old: (line?.msanCode ?? "").toString().trim(), pt: "SV" };
    if (await dispatchSpeedTool("portcheck", [phoneShort], isSuper, { params })) return;
    openOpSite("portcheck", phoneShort, params);
  };

  // ===== الأعطال «خارج الشاشة» (اليدوية): زر «الخط به عطل» + انتظام =====
  // زر «مراجعة» (جلب اسم/عنوان العميل من FCC): متاح للفنيين والشئون الخارجية (ومنها مهندس
  // الكوابل) والأدمن (ومنه مدير السنترال) والسوبر أدمن ومسئول البيانات — يعنى الكل ما عدا المبيعات.
  const canReview = ([ROLES.TECH, ROLES.EXTERNAL, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.DATA_MANAGER] as string[])
    .includes(user?.role ?? "");
  const [reviewBusy, setReviewBusy] = useState(false);
  // بيدخل طابور التنفيذ زى القياس/رفع السرعة/الإيقاف — جهاز التنفيذ هو اللى بيفتح FCC ويجيبها،
  // فالمستخدم مايحتاجش يكون على جهاز فيه وصول لـ FCC ولا يستنى التاب مفتوح.
  const reviewSubInfo = async () => {
    const p = String(line?.fullPhone || phone || "").trim();
    if (!p) return;
    setReviewBusy(true);
    try { await dispatchSpeedTool("subinfo", [p], isSuper); }
    finally { setReviewBusy(false); }
  };

  // «إلغاء مهمة WFM»: يفتح Dispatcher ومعاه الرقم فى الهاش، وسكربت التامبر منكى
  // (wfm-dispatcher-reassign.user.js) بيكمّل: بحث بالـ Service Id ← سطر Started/Assigned
  // ← Cancel من قائمة السطر. نافذة باسم ثابت للرقم عشان مايتفتحش تابات متكررة.
  const canFlagFault = isSuper || user?.role === ROLES.ADMIN || user?.role === ROLES.EXTERNAL;
  const canRegularize = isSuper || user?.role === ROLES.TECH;

  // حالة العطل المفتوح + آخر انتظام (يقارن اليدوى بـ 430D ويرجّع الأحدث)
  const { data: mfData, refetch: refetchMf } = useQuery({
    queryKey: ["/api/manual-faults/for-line", phone, searchSeq],
    queryFn: async () => {
      const r = await fetch(`/api/manual-faults/for-line?phone=${encodeURIComponent(phone)}`, { credentials: "include" });
      return (r.ok ? r.json() : { hasOpenFault: false, lastRegularization: null }) as Promise<{ hasOpenFault: boolean; lastRegularization: { at: string; closeCode: string; source: string } | null }>;
    },
    enabled: !!phone,
    staleTime: 0,
  });
  const hasOpenFault = !!mfData?.hasOpenFault;
  const lastReg = mfData?.lastRegularization || null;

  // قائمة الفنيين (للسوبر أدمن عند الانتظام)
  const { data: techList, isLoading: techListLoading, isError: techListError,
          refetch: refetchTechList } = useQuery<{ workerCode: string; techName: string }[]>({
    queryKey: ["/api/technician-names"],
    // لازم نرمى الخطأ مش نرجّع [] — الرد الفاشل كان بيتخزّن كنجاح بقائمة فاضية
    // فالدروب ليست تفضل فاضية من غير إعادة محاولة (retry: false عام).
    queryFn: async () => {
      const r = await fetch("/api/technician-names", { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر تحميل قائمة الفنيين");
      return r.json();
    },
    retry: 3, retryDelay: (n: number) => Math.min(1000 * 2 ** n, 8000),
    // نفس شروط ظهور زر «إلغاء الاسناد» (canCancelWfm بيتعرّف بعدين فى الملف):
    // القائمة كانت للسوبر أدمن بس، فالأدمن/الشئون الخارجية/الفنى كانوا بيلاقوا
    // دروب ليست الفنيين فاضية والإسناد مستحيل.
    enabled: isSuper || user?.role === ROLES.ADMIN || user?.role === ROLES.EXTERNAL ||
      (user?.role === ROLES.TECH && !!line?.ownedByMe),
    staleTime: 5 * 60 * 1000,
  });
  const techOptions = Array.from(new Set((techList ?? []).map((t) => (t.techName || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar"));

  // «إلغاء الاسناد»: بنختار الفنى اللى هتتسند عليه المهمة **قبل** ما نفتح WFM. السبب إن
  // WFM بيرفض إلغاء مهمة حالتها Started («Task already started»)، وساعتها السكربت بيعمل
  // Re-assign بدل Cancel — وده محتاج كود العامل. الدروب ليست بتعرض اسم الفنى واحنا
  // بنبعت كود العامل بتاعه للسكربت أوتوماتيك.
  // مين يقدر يعمل «إلغاء الاسناد»:
  //   • السوبر أدمن + الأدمن (ومنه مدير السنترال) + الشئون الخارجية (ومنها مهندس
  //     الكوابل) → على أى خط.
  //   • الفنى → على خطوطه هو بس (ownedByMe = خط فى كباينه، أو خط زميل هو قائم
  //     بالعمل مكانه وعليه عطل مفتوح — نفس تعريف باقى أزرار الأدوات).
  const canCancelWfm =
    isSuper ||
    user?.role === ROLES.ADMIN ||
    user?.role === ROLES.EXTERNAL ||
    (user?.role === ROLES.TECH && !!line?.ownedByMe);

  const [wfmOpen, setWfmOpen] = useState(false);
  const [wfmMode, setWfmMode] = useState<"cancel" | "reassign">("cancel");
  const [wfmTech, setWfmTech] = useState("");
  const techByName = new Map((techList ?? []).map((t) => [(t.techName || "").trim(), (t.workerCode || "").trim()]));
  const openCancelWfm = () => {
    const sid = String(line?.telNo || phone || "").replace(/\D/g, "").replace(/^88/, "");
    if (!sid) { alert("مفيش رقم للمتابعة"); return; }
    setWfmMode("cancel");
    // الافتراضى للإسناد: فنى الخط نفسه لو معروف
    const cur = (line?.techName || "").trim();
    setWfmTech(techByName.has(cur) ? cur : "");
    setWfmOpen(true);
  };
  const submitCancelWfm = async () => {
    const sid = String(line?.telNo || phone || "").replace(/\D/g, "").replace(/^88/, "");
    const worker = (techByName.get(wfmTech) || "").trim();
    if (wfmMode === "reassign") {
      if (!wfmTech) {
        alert(techListError
          ? "قائمة الفنيين ماتحمّلتش — اضغط «إعادة المحاولة» جنب القائمة الأول"
          : "اختر الفنى اللى هتتسند عليه المهمة");
        return;
      }
      if (!worker) { alert(`الفنى «${wfmTech}» مالوش كود عامل مسجّل — حدّثه من إدارة البيانات الفنية أولاً`); return; }
    }
    setWfmOpen(false);
    // mode بيحدّد البند اللى السكربت هيضغطه فى قائمة السطر: Cancel أو Re-assign — مباشرةً،
    // من غير ما يعمل الاتنين.
    const params = wfmMode === "reassign" ? { mode: "reassign", worker, workerName: wfmTech } : { mode: "cancel" };
    // مسار wfm.te.eg واحد: إلغاء الإسناد وتقارير WFM وتحديث ملف أوامر الشغل مايفتحوش مع بعض.
    if (await dispatchSpeedTool("wfmcancel", [sid], isSuper, { params })) return;
    openOpSite("wfmcancel", sid, params);
  };


  const [regOpen, setRegOpen] = useState(false);
  const [regCode, setRegCode] = useState("");
  const [regTech, setRegTech] = useState("");
  const [regBusy, setRegBusy] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [histRows, setHistRows] = useState<any[] | null>(null);
  // نافذة «غيّر البورت» (MSAN Replacement)
  const [msanOpen, setMsanOpen] = useState(false);
  const [msanMode, setMsanMode] = useState<"same" | "other">("same");
  const [msanOld, setMsanOld] = useState("");
  const [msanNew, setMsanNew] = useState("");
  const [msanPt, setMsanPt] = useState("SV");
  // لو المستخدم غيّر نوع البورت بإيده مانرجعش نختار له تلقائى — إلا لما كابينة
  // الوجهة نفسها تتغيّر (ساعتها الاختيار القديم بقى مالوش معنى).
  const ptTouchedFor = useRef<string>("");

  // ── الفاضى فى كابينة الوجهة مقسّم على نوع البورت ─────────────────────────
  // الغرض: اللى بينقل خط يشوف قدّامه أنهى نوع بورت لسه فيه مكان، ونختار له
  // الأكتر فاضى تلقائياً بدل ما يخمّن ويكتشف إن الكارت مليان بعد ما يبعت الطلب.
  const msanNewKey = msanNew.trim();
  const { data: cabFree, isFetching: cabFreeLoading } = useQuery({
    queryKey: ["/api/phone-ports/cabinet-free", msanNewKey],
    enabled: msanOpen && msanNewKey.length >= 6,
    queryFn: async () => {
      const r = await fetch(`/api/phone-ports/cabinet-free?msan=${encodeURIComponent(msanNewKey)}`,
        { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "تعذّر التحميل");
      return r.json() as Promise<{
        msan: string;
        data: { portType: string; cards: number; capacity: number; working: number; free: number }[];
        total: { cards: number; capacity: number; working: number; free: number };
      }>;
    },
    retry: 1,
  });
  // أنواع البورت المعتمدة فى البورتال — دول بس اللى يتبعتوا فى ملف الـ CSV.
  // أى نوع تانى ممكن يطلع من ملف البورتات (كتابة مختلفة/نوع غريب) مايبقاش اختيار.
  const PORT_TYPES = ["SV", "VDSL", "ADSL", "ESL"];
  // تجميع الفاضى على الأنواع الأربعة (مطابقة بدون حساسية لحالة الحروف)
  const freeMap = new Map<string, { cards: number; capacity: number; working: number; free: number }>();
  for (const g of cabFree?.data ?? []) {
    const key = PORT_TYPES.find((p) => p === String(g.portType || "").trim().toUpperCase());
    if (!key) continue;
    const cur = freeMap.get(key) || { cards: 0, capacity: 0, working: 0, free: 0 };
    freeMap.set(key, {
      cards: cur.cards + g.cards, capacity: cur.capacity + g.capacity,
      working: cur.working + g.working, free: cur.free + g.free,
    });
  }
  const freeOfPt = (pt: string) => freeMap.get(pt)?.free;
  // أكتر نوع فيه فاضى من الأنواع المعتمدة
  const bestPt = PORT_TYPES
    .filter((p) => (freeMap.get(p)?.free ?? 0) > 0)
    .sort((a, b) => (freeMap.get(b)!.free) - (freeMap.get(a)!.free))[0] || "";

  useEffect(() => {
    if (!msanOpen || !bestPt || !msanNewKey) return;
    if (ptTouchedFor.current === msanNewKey) return;   // المستخدم اختار بإيده لنفس الكابينة
    setMsanPt(bestPt);
  }, [msanOpen, msanNewKey, bestPt]);

  // تسجيل عطل يدوى (يمنع التكرار)
  const flagFault = async () => {
    if (!phone) return;
    const body = {
      fullPhone: line?.fullPhone || phone, phoneShort: line?.telNo || phone,
      accountNo: line?.accountNo || "", central: line?.central || "", cabinNumber: line?.cabinNumber || "",
      boxNumber: line?.boxNumber || "", msanCode: line?.msanCode || "", techName: line?.techName || "",
    };
    const r = await fetch("/api/manual-faults/flag", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (d?.duplicate) { alert(d.message || "الخط ده فيه عطل مسجّل بالفعل"); return; }
    if (!d?.ok) { alert(d?.message || "تعذّر تسجيل العطل"); return; }
    refetchMf();
    // قياس أوتوماتيك بعد تسجيل العطل لو الخط ليه رقم أكونت (زى الانتظام). measureDZS بيدّى التنبيه المناسب.
    const acc = (line?.accountNo ?? "").toString().trim();
    if (acc) { await measureDZS(); }
    else { alert("تم تسجيل العطل — الخط بقى فى «الأعطال الحالية خارج الشاشة» (لا يوجد رقم أكونت للقياس)"); }
  };

  // انتظام العطل (+ قياس أوتوماتيك لو الخط ليه رقم أكونت)
  const submitRegularize = async () => {
    if (!regCode) { alert("اختر سبب الإغلاق"); return; }
    if (isSuper && !regTech) { alert("اختر فنى الانتظام"); return; }
    setRegBusy(true);
    try {
      const body: any = { fullPhone: line?.fullPhone || phone, phoneShort: line?.telNo || phone, closeCode: regCode };
      if (isSuper && regTech) body.techName = regTech;
      const r = await fetch("/api/manual-faults/regularize", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) { alert(d?.message || "تعذّر تسجيل الانتظام"); return; }
      setRegOpen(false); setRegCode(""); setRegTech("");
      refetchMf();
      // قياس أوتوماتيك لو الخط ليه رقم أكونت
      const acc = (line?.accountNo ?? "").toString().trim();
      if (acc) { await measureDZS(); } else { alert("تم تسجيل الانتظام"); }
    } finally { setRegBusy(false); }
  };

  // فتح تاريخ أعطال الخط
  const openHistory = async () => {
    setHistOpen(true); setHistRows(null);
    try {
      const r = await fetch(`/api/line-fault-history?phone=${encodeURIComponent(line?.fullPhone || phone)}`, { credentials: "include" });
      const d = await r.json();
      setHistRows(d.history || []);
    } catch { setHistRows([]); }
  };

  // رقم الأكونت: بنفرّق بين حالتين كانوا بيبانوا نفس الشكل («-»):
  //   • الخط لسه **ماتفحصش** → «-» عادى (يمكن يكون ليه أكونت ولسه ماتسجّلش).
  //   • الخط **اتفحص** ومسئول البيانات علّمه «بدون أكونت» → يعنى صوت بس مش داتا.
  const accountCell: ReactNode = line?.accountNo
    ? dash(line.accountNo)
    : line?.markedNoAccount
      ? (
        <span className="inline-flex flex-col items-start gap-0.5">
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold text-xs">
            صوت فقط — مافيش داتا
          </span>
          <span className="text-[11px] text-muted-foreground">
            اتفحص واتشال من «بدون أكونت»
            {line.noAccountBy ? ` — ${line.noAccountBy}` : ""}
            {line.noAccountAt ? ` · ${fmtDate(line.noAccountAt)}` : ""}
          </span>
        </span>
      )
      : <span className="text-muted-foreground">— لسه ماتفحصش</span>;

  // الترتيب مطابق للإكسيل: الشبكة RTL تملأ الخلية اليمنى ثم اليسرى فى كل صف —
  // فالمصفوفة مرتّبة: (يمين1, شمال1, يمين2, شمال2 …) للصفوف 1–12، ثم الحقول الفنية الباقية كامل العرض (صف لكل حقل).
  const fields: [string, ReactNode][] = line
    ? [
        // صف1: اسم العميل يمين | رقم الموبايل شمال — وتحت الاسم مباشرةً (نفس العمود) عنوان العميل
        ["اسم العميل", dash(line.subName)],             ["رقم الموبايل", mobileCell],
        ["عنوان العميل", dash(line.subAdd)],            ["السنترال", dash(line.central)],
        ["اسم الفنى", dash(line.techName)],             ["رقم الكابينة", dash(line.cabinNumber)],
        ["رقم الأكونت", accountCell],                   ["رقم البكس", dash(line.boxNumber)],
        ["السرعة الحالية", dash(line.currentSpeed)],    ["DP Terminal", dash(line.dpTerminal)],
        ["أقصى سرعة", dash(line.maxSpeed)],             ["كود الكابينة (MSAN)", dash(line.msanCode)],
        ["الاسكور", scoreBadge(line.score)],            ["رقم الفريم", dash(line.frame)],
        ["تاريخ آخر قياس", withBy(fmtDate(line.lastMeasTime), line.measuredBy)], ["Port Type", dash(line.portType)],
        ["آخر رفع سرعة", withBy(fmtDate(line.lastPoRaiseAt), line.raisedBy)],  ["voice status", dash(line.voiceStatus)],
        ["آخر إيقاف PO", withBy(fmtDate(line.lastPoStopAt), line.stoppedBy)],   ["data status", dash(line.dataStatus)],
        ["تاريخ آخر شكوى", fmtDate(line.lastComplaintAt)], ["Row", dash(line.rowNo)],
        ["حالة صيانة البكس", boxMaintCell],             ["Column", dash(line.columnNo)],
        ["هل البكس له تكت أرضية", groundCell],
        // الحقول الفنية الباقية — كامل العرض (صف لكل حقل).
        ["رقم التليفون الكامل", dash(line.fullPhone)],
        ["إحداثيات البكس", coordsCell],
        ["operator", dash(line.operator)],
        ["shelf", dash(line.shelf)],
        ["slot", dash(line.slot)],
        ["Port", dash(line.port)],
        ["IDU", dash(line.iduNo)],
        ["ODU", dash(line.oduNo)],
        ["Primary Block", dash(line.primaryBlockNo)],
        ["Cabinet In", dash(line.cabinetIn)],
        ["Sec Block", dash(line.secBlockNo)],
        ["Cabinet Out", dash(line.cabinetOut)],
        ["Fiber Block", dash(line.fiberBlock)],
        ["Fiber Out", dash(line.fiberOut)],
        ["رقم التليفون", dash(line.telNo)],   // القصير — آخر خانة
      ]
    : [];

  // ترتيب مخصّص للموبايل (عمود واحد) — مستقل عن ترتيب الديسكتوب (عمودين)
  const MOBILE_ORDER = [
    "اسم العميل", "عنوان العميل", "رقم الموبايل", "اسم الفنى", "السنترال", "رقم الكابينة", "رقم البكس",
    "DP Terminal", "كود الكابينة (MSAN)", "رقم الفريم", "رقم الأكونت", "السرعة الحالية", "أقصى سرعة",
    "الاسكور", "تاريخ آخر قياس", "آخر رفع سرعة", "آخر إيقاف PO", "تاريخ آخر شكوى", "إحداثيات البكس",
    "Port Type", "voice status", "data status", "Row", "Column", "operator",
    "حالة صيانة البكس", "هل البكس له تكت أرضية", "shelf", "slot", "Port", "IDU", "ODU",
    "Primary Block", "Cabinet In", "Sec Block", "Cabinet Out", "Fiber Block", "Fiber Out",
    "رقم التليفون الكامل", "رقم التليفون",
  ];
  const byLabel = new Map(fields.map((f) => [f[0], f]));
  const mobileFields = MOBILE_ORDER.map((l) => byLabel.get(l)).filter(Boolean) as [string, ReactNode][];

  const handleExportExcel = () => {
    if (!line) return;
    const row = {
      "رقم التليفون الكامل": line.fullPhone,
      "رقم التليفون": line.telNo,
      "اسم العميل": line.subName ?? "",
      "عنوان العميل": line.subAdd ?? "",
      "السنترال": line.central,
      "اسم الفنى": line.techName ?? "",
      "رقم الكابينة": line.cabinNumber ?? "",
      "رقم الأكونت": line.accountNo
        || (line.markedNoAccount
            ? `صوت فقط — مافيش داتا (اتفحص${line.noAccountBy ? " — " + line.noAccountBy : ""})`
            : "لسه ماتفحصش"),
      "رقم الموبايل": line.mobile ?? "",
      "رقم البكس": line.boxNumber ?? "",
      "السرعة الحالية": line.currentSpeed ?? "",
      "DP Terminal": line.dpTerminal ?? "",
      "أقصى سرعة": line.maxSpeed ?? "",
      "كود الكابينة (MSAN)": line.msanCode ?? "",
      "الاسكور": line.score ?? "",
      "رقم الفريم": line.frame ?? "",
      "تاريخ آخر قياس": fmtDate(line.lastMeasTime),
      "Port Type": line.portType ?? "",
      "آخر رفع سرعة": fmtDate(line.lastPoRaiseAt),
      "Row": line.rowNo ?? "",
      "آخر إيقاف PO": fmtDate(line.lastPoStopAt),
      "Column": line.columnNo ?? "",
      "تاريخ آخر شكوى": fmtDate(line.lastComplaintAt),
      "voice status": line.voiceStatus ?? "",
      "حالة صيانة البكس": boxMaint?.maintenance_status_ar ?? "",
      "data status": line.dataStatus ?? "",
      "هل البكس له تكت أرضية": line.boxNumber ? (boxGround?.hasOpenTicket ? "نعم" : "لا") : "",
      "operator": line.operator ?? "",
      "shelf": line.shelf ?? "",
      "slot": line.slot ?? "",
      "Port": line.port ?? "",
      "IDU": line.iduNo ?? "",
      "ODU": line.oduNo ?? "",
      "Primary Block": line.primaryBlockNo ?? "",
      "Cabinet In": line.cabinetIn ?? "",
      "Sec Block": line.secBlockNo ?? "",
      "Cabinet Out": line.cabinetOut ?? "",
      "Fiber Block": line.fiberBlock ?? "",
      "Fiber Out": line.fiberOut ?? "",
      "LEN": line.len ?? "",
    };
    const ws = XLSX.utils.json_to_sheet([row]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيانات الخط");
    XLSX.writeFile(wb, `line_${line.fullPhone}.xlsx`);
  };

  const handleExportPDF = () => {
    if (!line) return;
    printTablePDF({
      title: `بيانات الخط ${line.fullPhone}`,
      columns: ["السنترال", "الكابينة", "البكس", "حالة صيانة البكس", "تكت أرضية", "كود MSAN", "اسم الفنى", "الفريم", "الأكونت", "سرعة حالية", "أقصى سرعة", "الاسكور", "آخر قياس", "Port Type", "Row", "Column", "voice", "data", "operator", "shelf", "slot", "IDU", "ODU", "Primary Block", "Cabinet In", "Sec Block", "Cabinet Out", "DP Terminal", "Port", "LEN", "Fiber Block", "Fiber Out", "آخر رفع سرعة", "آخر إيقاف PO", "آخر شكوى"],
      rows: [[
        line.central, line.cabinNumber ?? "-", line.boxNumber ?? "-", boxMaint?.maintenance_status_ar ?? "-", line.boxNumber ? (boxGround?.hasOpenTicket ? "نعم" : "لا") : "-", line.msanCode ?? "-", line.techName ?? "-", line.frame ?? "-", line.accountNo ?? "-",
        line.currentSpeed ?? "-", line.maxSpeed ?? "-", line.score ?? "-", fmtDate(line.lastMeasTime),
        line.portType ?? "-", line.rowNo ?? "-", line.columnNo ?? "-", line.voiceStatus ?? "-", line.dataStatus ?? "-", line.operator ?? "-", line.shelf ?? "-", line.slot ?? "-",
        line.iduNo ?? "-", line.oduNo ?? "-", line.primaryBlockNo ?? "-", line.cabinetIn ?? "-", line.secBlockNo ?? "-",
        line.cabinetOut ?? "-", line.dpTerminal ?? "-", line.port ?? "-", line.len ?? "-", line.fiberBlock ?? "-", line.fiberOut ?? "-",
        fmtDate(line.lastPoRaiseAt), fmtDate(line.lastPoStopAt), fmtDate(line.lastComplaintAt),
      ]],
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Phone className="w-4 h-4 text-blue-600" />
            بحث برقم التليفون
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            اكتب رقم التليفون (كامل 88… أو القصير) لعرض بياناته الفنية وآخر قياس
          </p>
        </div>

        <div className="p-4 flex flex-wrap items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder="رقم التليفون…"
            className="w-full sm:w-64 text-sm"
            inputMode="numeric"
          />
          <Button onClick={search} disabled={!input.trim() || isFetching} className="gap-2">
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            بحث
          </Button>
          <Button
            variant="outline"
            onClick={() => setSearchSeq((s) => s + 1)}
            disabled={!phone || isFetching}
            className="gap-2"
            title="إعادة تحميل بيانات هذا الرقم من السيرفر (بعد جلب الأكونت أو قياس جديد)"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            تحديث
          </Button>
          {line && canReview && (
            <Button
              variant="outline"
              onClick={reviewSubInfo}
              disabled={reviewBusy}
              className="gap-2 text-fuchsia-700 border-fuchsia-200 hover:bg-fuchsia-50"
              title="جلب اسم وعنوان هذا الرقم من FCC — بيتضاف لطابور التنفيذ زى القياس ورفع السرعة"
            >
              {reviewBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserSearch className="w-4 h-4" />}
              مراجعة البيان الفنى
            </Button>
          )}
          {line && canFlagFault && (
            <Button
              variant="outline"
              onClick={flagFault}
              disabled={hasOpenFault}
              className="gap-2 text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-60"
              title={hasOpenFault ? "الخط ده فيه عطل مسجّل بالفعل (لم ينتظم بعد)" : "تسجيل عطل يدوى لهذا الخط (خارج الشاشة)"}
            >
              <AlertTriangle className="w-4 h-4" />
              {hasOpenFault ? "به عطل مسجّل" : "الخط به عطل"}
            </Button>
          )}
          {line && canRegularize && hasOpenFault && (
            <Button
              variant="outline"
              onClick={() => { setRegCode(""); setRegTech(""); setRegOpen(true); }}
              className="gap-2 text-green-700 border-green-300 hover:bg-green-50"
              title="تسجيل انتظام العطل (اختيار سبب الإغلاق) ثم قياس الخط أوتوماتيك"
            >
              <Wrench className="w-4 h-4" />
              انتظام
            </Button>
          )}
          {line && (
            <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
              {line.accountNo ? (
                canUseTools ? (
                <>
                  <Button
                    variant="outline"
                    onClick={awaitingOp === "measure" ? cancelOpWait : measureDZS}
                    className="bg-white gap-2 text-blue-700 border-blue-200"
                    title={awaitingOp === "measure" ? "اضغط لإلغاء انتظار نتيجة القياس" : "فتح DZS وقياس هذا الرقم"}
                  >
                    {awaitingOp === "measure"
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Radar className="w-4 h-4" />}
                    {awaitingOp === "measure" ? "فى انتظار القياس… (اضغط للإلغاء)" : "قياس DZS"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (awaitingOp === "raise") { cancelOpWait(); return; }
                      const acc = line.accountNo;
                      if (!acc) { alert("لا يوجد رقم أكونت لهذا الخط"); return; }
                      // رفع السرعة: موافق = رفع ثم إيقاف الـ Nightly الناتج (فى **تشغيلة PO واحدة**)،
                      // إلغاء = رفع السرعة فقط. مهمة واحدة فى الطابور (مفيش تداخل).
                      const afterStop = window.confirm("رفع السرعة والإيقاف؟\n\nموافق = رفع السرعة ثم إيقاف الـ Nightly الناتج (فى تشغيلة واحدة)\nإلغاء = رفع السرعة فقط");
                      void recordOpIntent("raise", [acc]);
                      if (afterStop) void recordOpIntent("stop", [acc]);
                      // علامة «+إيقاف» فى الـ note بتخلّى جهاز التنفيذ يشغّل رفع+إيقاف فى تشغيلة PO واحدة.
                      const note = afterStop ? `${PHONE_LOOKUP_SOURCE} +إيقاف` : PHONE_LOOKUP_SOURCE;
                      if (await enqueueIfExecutorActive("raise", [acc], note)) {
                        alert(afterStop
                          ? "تم إضافة (رفع السرعة + الإيقاف) للطابور — هيتنفّذوا فى تشغيلة واحدة على جهاز التنفيذ، والصفحة هتتحدّث تلقائياً"
                          : "تم إضافة الرقم لطابور رفع السرعة — هيتنفّذ على جهاز التنفيذ، والصفحة هتتحدّث تلقائياً");
                        void waitForOpThenRefresh(afterStop ? "stop" : "raise", String(acc));
                        return;
                      }
                      if (!isSuper || !canRunLocalExecutor()) { alert(NO_EXECUTOR_MSG); return; }
                      openProfileOptimization([acc], { afterStop });
                    }}
                    className="bg-white gap-2 text-emerald-700 border-emerald-200"
                    title={awaitingOp === "raise" ? "اضغط لإلغاء انتظار رفع السرعة" : "تشغيل Profile Optimization (رفع السرعة) لهذا الرقم"}
                  >
                    {awaitingOp === "raise" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}
                    {awaitingOp === "raise" ? "فى انتظار رفع السرعة… (اضغط للإلغاء)" : "رفع سرعة"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (awaitingOp === "stop") { cancelOpWait(); return; }
                      void recordOpIntent("stop", [line.accountNo]);
                      if (await enqueueIfExecutorActive("stop", [line.accountNo])) {
                        alert("تم إضافة الرقم لطابور إيقاف PO — هيتنفّذ على جهاز التنفيذ، والصفحة هتتحدّث تلقائياً بعد التنفيذ");
                        void waitForOpThenRefresh("stop", String(line.accountNo));
                        return;
                      }
                      if (!isSuper || !canRunLocalExecutor()) { alert(NO_EXECUTOR_MSG); return; }
                      openProfileOptimization([line.accountNo], { stopOnly: true });
                    }}
                    className="bg-white gap-2 text-orange-700 border-orange-200"
                    title={awaitingOp === "stop" ? "اضغط لإلغاء انتظار إيقاف PO" : "إيقاف الـ Nightly PO فقط (يرجّع الحالة Not Started) لهذا الرقم"}
                  >
                    {awaitingOp === "stop" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}
                    {awaitingOp === "stop" ? "فى انتظار إيقاف PO… (اضغط للإلغاء)" : "إيقاف PO"}
                  </Button>
                </>
                ) : (
                  <span className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    القياس ورفع السرعة والإيقاف متاحة فقط لفنى المنطقة
                    {line.techName ? ` — الخط تابع للفنى: ${line.techName}` : " — الخط غير مُسنَد لفنى معروف"}
                    <span className="block mt-1 text-[11px] opacity-90">
                      لو انت مغطّى للفنى ده: الصلاحية بتفتح على خطوطه اللى عليها عطل مفتوح أو عطل اتنظّم النهاردة بس.
                    </span>
                  </span>
                )
              ) : isSuper ? (
                <Button
                  variant="outline"
                  onClick={() => { void openCustomer360([line.fullPhone]); }}
                  className="bg-white gap-2 text-purple-700 border-purple-200"
                  title="لا يوجد رقم أكونت — فتح Customer360 لجلب رقم الأكونت تلقائياً"
                >
                  <IdCard className="w-4 h-4" />
                  جلب الأكونت من Customer360
                </Button>
              ) : null}
              {isSuper && (
                <Button
                  variant="outline"
                  onClick={openChangePort}
                  className="bg-white gap-2 text-cyan-700 border-cyan-300 hover:bg-cyan-50"
                  title="فتح Provisioning Portal (MSAN Replacement) وملء الفورم لتغيير بورت هذا الرقم — للسوبر أدمن"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  غيّر البورت (بروفيجن)
                </Button>
              )}
              {isSuper && (
                <Button
                  variant="outline"
                  onClick={refreshPort}
                  className="bg-white gap-2 text-teal-700 border-teal-300 hover:bg-teal-50"
                  title="متابعة نتيجة تغيير البورت يدوياً: يفتح Search For My Requests ولو الطلب COMPLETED يحدّث بيان البورت الجديد — للسوبر أدمن"
                >
                  <RefreshCw className="w-4 h-4" />
                  تحديث البورت
                </Button>
              )}
              {canCancelWfm && (
                <Button
                  variant="outline"
                  onClick={openCancelWfm}
                  className="bg-white gap-2 text-rose-700 border-rose-300 hover:bg-rose-50"
                  title="إلغاء إسناد المهمة على WFM — تختار الفنى الأول، ولو WFM رفض الإلغاء (Task already started) السكربت يعمل Re-assign عليه"
                >
                  <Ban className="w-4 h-4" />
                  إلغاء الاسناد
                </Button>
              )}
              <Button variant="outline" onClick={handleExportExcel} className="bg-white gap-2">
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                Excel
              </Button>
              <Button variant="outline" onClick={handleExportPDF} className="bg-white gap-2">
                <Printer className="w-4 h-4 text-red-600" />
                PDF
              </Button>
            </div>
          )}
        </div>
      </Card>

      {error && (
        <Card className="p-4 text-sm text-red-600 border-0 shadow-sm">حدث خطأ أثناء البحث</Card>
      )}

      {phone && !isFetching && data && !data.found && (
        <Card className="p-6 text-center text-muted-foreground border-0 shadow-sm">
          لا يوجد خط بالرقم <span className="font-semibold">{phone}</span>
        </Card>
      )}

      {line && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          {/* آخر انتظام (الأحدث من اليدوى/430D) + زر تاريخ الأعطال */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-indigo-50 border-b text-sm">
            <span className="text-muted-foreground">آخر انتظام:</span>
            {lastReg ? (
              <span className="font-semibold">
                {fmtDate(lastReg.at)}
                {lastReg.closeCode ? ` — ${closeReason(lastReg.closeCode) || lastReg.closeCode}` : ""}
                <span className="text-xs text-muted-foreground mr-1">({lastReg.source === "manual" ? "خارج الشاشة" : "430D"})</span>
              </span>
            ) : (
              <span className="text-muted-foreground">لا يوجد</span>
            )}
            <Button variant="outline" size="sm" onClick={openHistory} className="gap-1 mr-auto text-indigo-700 border-indigo-200">
              <History className="w-4 h-4" /> تاريخ الأعطال
            </Button>
          </div>
          {/* الديسكتوب: عمودين بالترتيب المطابق للإكسيل */}
          <div className="hidden sm:grid grid-cols-2 gap-px bg-gray-100">
            {fields.map(([label, value]) => {
              const fullWidth = FULL_WIDTH_FIELDS.has(label as string);
              return (
                <div
                  key={label}
                  className={`flex items-center justify-between gap-3 bg-white px-4 py-3 ${fullWidth ? "col-span-2" : ""}`}
                >
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-sm font-semibold text-left">{value}</span>
                </div>
              );
            })}
          </div>
          {/* الموبايل: عمود واحد بترتيب مخصّص */}
          <div className="grid sm:hidden grid-cols-1 gap-px bg-gray-100">
            {mobileFields.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 bg-white px-4 py-3">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-semibold text-left">{value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* مودال تسجيل الانتظام (سبب الإغلاق + فنى الانتظام للسوبر أدمن) */}
      {regOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={() => setRegOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold">تسجيل انتظام العطل</h3>
              <button onClick={() => setRegOpen(false)}><X className="w-5 h-5" /></button>
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
              <Button variant="outline" size="sm" onClick={() => setRegOpen(false)}>إلغاء</Button>
              <Button size="sm" onClick={submitRegularize} disabled={regBusy} className="bg-green-600 hover:bg-green-700 gap-1">
                {regBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} OK — تسجيل الانتظام
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة «غيّر البورت» (MSAN Replacement) — سوبر أدمن */}
      {msanOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={() => setMsanOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-cyan-700" /> غيّر البورت — {line?.telNo || phone}</h3>
              <button onClick={() => setMsanOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">نوع العملية</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={msanMode === "same"} onChange={() => setMsanModeAndFill("same")} /> نفس الكابينة</label>
                <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={msanMode === "other"} onChange={() => setMsanModeAndFill("other")} /> نقل لكابينة أخرى</label>
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">الكود القديم (Old Cabin Code) *</label>
              <Input value={msanOld} onChange={(e) => setMsanOld(e.target.value)} placeholder="مثال: 11-2-26-05" dir="ltr" className="text-left text-sm" />
            </div>
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">الكود الجديد (New Cabin Code) *</label>
              <Input value={msanNew} onChange={(e) => setMsanNew(e.target.value)} placeholder="كود الكابينة" dir="ltr" className="text-left text-sm" />
            </div>
            {/* الفاضى فى كابينة الوجهة لكل نوع بورت — عشان تختار نوع لسه فيه مكان */}
            <div className="rounded-md border bg-muted/30 p-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">الفاضى فى كابينة الوجهة ({msanNewKey || "—"})</span>
                {cabFreeLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              </div>
              {msanNewKey.length < 6 ? (
                <p className="text-[11px] text-muted-foreground">اكتب كود الكابينة الجديدة الأول</p>
              ) : cabFreeLoading ? (
                <p className="text-[11px] text-muted-foreground">جارٍ الحساب…</p>
              ) : !cabFree?.data?.length ? (
                <p className="text-[11px] text-red-600">مفيش بورتات مسجّلة للكابينة دى فى ملف البورتات</p>
              ) : (
                <>
                  {/* الأنواع الأربعة المعتمدة بس — دى اللى البورتال بيقبلها */}
                  <div className="flex flex-wrap gap-1.5">
                    {PORT_TYPES.map((pt) => {
                      const g = freeMap.get(pt);
                      return (
                        <button key={pt} type="button"
                          onClick={() => { ptTouchedFor.current = msanNewKey; setMsanPt(pt); }}
                          title={g ? `${g.cards} كارت · سعة ${g.capacity} · شغّال ${g.working}`
                                   : "مافيش كروت من النوع ده فى الكابينة"}
                          className={`px-2 py-1 rounded text-xs border transition
                            ${msanPt === pt ? "bg-cyan-600 text-white border-cyan-600" : "bg-white hover:bg-muted"}
                            ${!g?.free ? "opacity-60" : ""}`}>
                          {/* dir=ltr + فاصل: من غيرهم كان بيتقرا «SV24» كأنه اسم نوع البورت */}
                          <span dir="ltr" className="inline-flex items-center gap-1">
                            <span className="font-mono">{pt}</span>
                            <span className="opacity-50">·</span>
                            <span className={`font-bold ${g?.free ? (msanPt === pt ? "" : "text-green-700") : "text-red-600"}`}>
                              {g ? g.free : "—"}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    الرقم جنب النوع = عدد البورتات الفاضية.
                    إجمالى الفاضى فى الكابينة <b>{cabFree.total.free}</b> من سعة {cabFree.total.capacity}.
                    {bestPt && <> الأكتر فاضى <b>{bestPt}</b> (اتحدد تلقائياً — تقدر تغيّره).</>}
                  </p>
                </>
              )}
            </div>
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">نوع البورت (PortType) *</label>
              <select value={msanPt}
                onChange={(e) => { ptTouchedFor.current = msanNewKey; setMsanPt(e.target.value); }}
                className="border rounded-md px-3 py-2 text-sm" dir="ltr">
                {/* الأنواع الأربعة المعتمدة **فقط** — مفيش أى نوع تانى يتبعت للبورتال */}
                {PORT_TYPES.map((pt) => {
                  const f = freeOfPt(pt);
                  return (
                    <option key={pt} value={pt}>
                      {pt}{f === undefined ? "" : ` — فاضى ${f}`}
                    </option>
                  );
                })}
              </select>
              {msanNewKey.length >= 6 && !cabFreeLoading && freeOfPt(msanPt) === 0 && (
                <p className="text-[11px] text-red-600 font-semibold">
                  ⚠️ كروت {msanPt} فى الكابينة دى مليانة — اختر نوع تانى فيه فاضى.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">speed = <b>WE30</b> (ثابت). الكود القديم لازم يختلف عن الجديد (البورتال بيرفض تطابقهما). السكربت بيملأ الفورم ويحقن الملف <b>ويضغط Submit تلقائياً</b> فى البورتال.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setMsanOpen(false)}>إلغاء</Button>
              <Button size="sm" onClick={submitChangePort} className="bg-cyan-600 hover:bg-cyan-700 gap-1">
                <ArrowLeftRight className="w-4 h-4" /> افتح البروفيزيونال
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* مودال «إلغاء الاسناد» — اختيار الفنى (وكود العامل بيتبعت للسكربت أوتوماتيك) */}
      {wfmOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={() => setWfmOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2"><Ban className="w-5 h-5 text-rose-700" /> مهمة WFM — {line?.telNo || phone}</h3>
              <button onClick={() => setWfmOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">المطلوب</label>
              <div className="flex flex-col gap-1 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={wfmMode === "cancel"} onChange={() => setWfmMode("cancel")} />
                  إلغاء الاسناد <span className="text-xs text-muted-foreground">(Cancel مباشرةً)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={wfmMode === "reassign"} onChange={() => setWfmMode("reassign")} />
                  اسناد لفنى آخر <span className="text-xs text-muted-foreground">(Re-assign مباشرةً)</span>
                </label>
              </div>
            </div>
            {wfmMode === "reassign" && (
              <>
                <div className="grid gap-1">
                  <label className="text-sm text-muted-foreground">الفنى اللى هتتسند عليه المهمة *</label>
                  <select value={wfmTech} onChange={(e) => setWfmTech(e.target.value)}
                    disabled={techListLoading || techListError}
                    className="border rounded-md px-3 py-2 text-sm disabled:bg-muted">
                    <option value="">
                      {techListLoading ? "— جارٍ تحميل قائمة الفنيين… —"
                        : techListError ? "— تعذّر تحميل القائمة —"
                        : techOptions.length === 0 ? "— مفيش فنيين مسجّلين —"
                        : "— اختر الفنى —"}
                    </option>
                    {techOptions.map((t) => (
                      <option key={t} value={t}>{t}{techByName.get(t) ? ` (${techByName.get(t)})` : " — بدون كود عامل"}</option>
                    ))}
                  </select>
                  {/* القائمة كانت بتفضل فاضية من غير أى تفسير لو الطلب فشل (نت ضعيف /
                      السيرفر مشغول بجهاز التنفيذ) — دلوقتى بيبان السبب مع زر إعادة محاولة. */}
                  {techListError && (
                    <div className="flex items-center gap-2 text-xs text-red-700">
                      <span>تعذّر تحميل قائمة الفنيين (النت أو السيرفر مشغول).</span>
                      <button type="button" onClick={() => refetchTechList()}
                        className="underline hover:text-red-900">إعادة المحاولة</button>
                    </div>
                  )}
                  {!techListError && !techListLoading && techOptions.length === 0 && (
                    <p className="text-xs text-amber-700">مفيش فنيين مسجّلين — ارفع ملف «أسماء الفنيين» من إدارة البيانات الفنية.</p>
                  )}
                </div>
                {wfmTech && <p className="text-xs">كود العامل: <b dir="ltr">{techByName.get(wfmTech) || "غير مسجّل"}</b></p>}
                <p className="text-xs text-muted-foreground">
                  السكربت هيضغط <b>Re-assign</b> على السطر، ويتأكد إن التاريخ تاريخ النهاردة وإن كود العامل
                  هو المختار (ولو غلط بيدوّر عليه بالمكبّر ← Search ← OK) ثم يضغط <b>Assign</b>.
                </p>
              </>
            )}
            {wfmMode === "cancel" && (
              <p className="text-xs text-muted-foreground">
                السكربت هيضغط <b>Cancel</b> على السطر مباشرةً. ملحوظة: WFM بيرفض إلغاء مهمة حالتها
                <span dir="ltr"> Started</span> — ساعتها استخدم «اسناد لفنى آخر».
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setWfmOpen(false)}>إلغاء</Button>
              <Button size="sm" onClick={submitCancelWfm} className="bg-rose-700 hover:bg-rose-800 gap-1">
                <Ban className="w-4 h-4" /> ابدأ على WFM
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* مودال تاريخ أعطال الخط (يدوى + 430D) */}
      {histOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={() => setHistOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-4 space-y-3 max-h-[80vh] overflow-auto" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold">تاريخ أعطال الخط {line?.telNo || phone}</h3>
              <button onClick={() => setHistOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            {histRows == null ? (
              <div className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
            ) : histRows.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">لا يوجد تاريخ أعطال</div>
            ) : (
              <table className="w-full text-sm border">
                <thead><tr className="bg-gray-100"><th className="border px-2 py-1">تاريخ الانتظام</th><th className="border px-2 py-1">سبب الإغلاق</th><th className="border px-2 py-1">المصدر</th></tr></thead>
                <tbody>
                  {histRows.map((h, i) => (
                    <tr key={i} className="odd:bg-gray-50">
                      <td className="border px-2 py-1 whitespace-nowrap text-center">{fmtDate(h.date)}</td>
                      <td className="border px-2 py-1">{closeReason(h.closeCode) || h.closeCode || "-"}</td>
                      <td className="border px-2 py-1 text-center">{h.source === "manual" ? "خارج الشاشة" : "430D"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

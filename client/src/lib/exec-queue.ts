// ============================================================================
// client/src/lib/exec-queue.ts
// طابور التنفيذ المركزى: رفع السرعة/القياس/الإيقاف يتنفّذ على «جهاز التنفيذ»
// (براوزر سوبر أدمن مفعّل الزر). أى جهاز تانى يضيف المهمة للطابور بدل ما ينفّذ عنده.
// ============================================================================
import { openProfileOptimization } from "./profile-optimization";

// أنواع المهام. «الأرقام» فى raise/stop/measure أرقام أكونت، وفى الباقى أرقام تليفون.
//   subinfo    = مراجعة البيان الفنى (اسم/عنوان العميل من FCC)
//   c360       = جلب رقم الأكونت من Customer360
//   portchange = غيّر البورت (MSAN Replacement) على Provisioning Portal
//   portcheck  = تحديث البورت (Search For My Requests) على Provisioning Portal
//   ports      = تحديث ملف البورتات كله (نفس البوابة)
//   wfmcancel  = إلغاء الإسناد على WFM Dispatcher
//   wfmreport  = تقارير WFM الخام
//   fccdaily/wfmdaily/ossdaily/weoas = تحديث الملفات اليومية (كل واحد على موقعه)
export type ExecJobType =
  | "raise" | "stop" | "measure" | "subinfo" | "c360"
  | "portchange" | "portcheck" | "ports"
  | "wfmcancel" | "wfmreport"
  | "fccdaily" | "wfmdaily" | "ossdaily" | "weoas";
export interface ExecJobParams {
  old?: string; new?: string; pt?: string; sp?: string;
  /** مهمة WFM: "cancel" = إلغاء الاسناد | "reassign" = إسناد لفنى آخر */
  mode?: string;
  /** كود العامل للفنى المختار (لـ Re-assign) + اسمه للعرض فى السجل */
  worker?: string; workerName?: string;
}
export interface ExecJob { id: number; type: ExecJobType; accounts: string[]; requestedBy?: string | null; note?: string | null; site?: string | null; params?: ExecJobParams | null; }

// مصدر «بحث برقم التليفون» — القياس اللى بييجى منه بيختار «A recent fix (past 24h)» فى شاشة DZS.
export const PHONE_LOOKUP_SOURCE = "بحث برقم التليفون";

const DZS_URL = "https://10.42.187.101:8080/expresse/";
const FCC_URL = "https://fcc.te.eg/TroubleTicket/faces/security/pages/Login.jsf";
const C360_URL = "https://customer360.te.eg/Authentication/Login";
const PROV_URL = "https://provisioningportal.te.eg/provisioningPortal/";
// إلغاء الإسناد بيبدأ من WFM العادى (WorkOrder/faces/Home) — السكربت بيفتح قائمة المربعات
// أعلى اليسار ويختار «Assignment and Dispatch» فيوصل Dispatcher/faces/Home ومنه Tasks Queue.
// (الدخول المباشر على Dispatcher/faces/UIShell كان بيفتح صفحة بيضا.)
const WFM_HOME_URL = "https://wfm.te.eg/WorkOrder/faces/Home";
const WFM_REPORTS_URL = "https://wfm.te.eg/WfmReports/#/login";
const WFM_LOGIN_URL = "https://wfm.te.eg/WorkOrder/faces/security/pages/Login.jsf";
const OSS_URL = "https://oss.te.eg:15201/om";
const WEOAS_URL = "https://we-oas.te.eg/bi-security-login/login.jsp?msi=false&mt=false&profileMust=true&redirect=L2R2L3VpL2hvbWUuanNwP3BhZ2VpZD1ob21lJmhhc2g9aTRPeDNTVkNPXzVLUUswc2lHUThxUTFNQVp6MGRTLVg5aXgzRGQ5RmlHUVJKd3M5cnNZcGQyaURJRjZUZEZWZQ==";

// اسم تاب ثابت لكل **دومين**: الطابور أصلاً بينفّذ مهمة واحدة لكل دومين فى نفس الوقت،
// والاسم الثابت بيمنع تراكم التابات لو حصل فتح متتالى على نفس الموقع.
// (subinfo استثناء: سكربت FCC بيقرأ الرقم من اسم النافذة نفسه.)
const PROV_TAB = "sf_prov", WFM_TAB = "sf_wfm", C360_TAB = "sf_c360";

// سكربت FCC بيقرا الرقم المطلوب من اسم النافذة (window.name = "sf_subinfo_one:<رقم>")،
// والهاش للتوضيح بس. نفس اللى بيعمله زر «مراجعة» لما بينفّذ محلياً.
export function openSubInfo(phone: string): Window | null {
  const p = String(phone ?? "").trim();
  if (!p) return null;
  return window.open(`${FCC_URL}#sf_si=one:${encodeURIComponent(p)}`, "sf_subinfo_one:" + p);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// اسم ثابت لنافذة القياس — كل قياس جديد يفتح بنفس الاسم فيتعاد استخدام **نفس** النافذة/التاب
// (الجديد يحلّ محل القديم بدل ما يتراكموا)، حتى لو close() فشل على النوافذ المنبثقة.
const DZS_MEASURE_TARGET = "dzs_measure";

// فتح موقع العملية للأنواع «الجديدة» (كل واحدة على دومينها). بترجّع التاب عشان جهاز التنفيذ
// يعرف إنه اتقفل (= خلص) — القفل هو الإشارة الأساسية، والأثر فى قاعدة البيانات إشارة إضافية.
export function openOpSite(type: ExecJobType, key: string, params?: ExecJobParams | null): Window | null {
  const k = String(key ?? "").trim();
  const short = k.replace(/\D/g, "").replace(/^88/, ""); // الرقم القصير (بدون 88) للبوابات
  switch (type) {
    case "c360":
      // الأرقام بتتبعت كلها فى الهاش — السكربت بيلفّ عليها جوّه نفس التاب (تسجيل دخول واحد).
      return window.open(`${C360_URL}#sf_phones=${encodeURIComponent(k)}`, C360_TAB);
    case "portchange": {
      const qs = new URLSearchParams({
        sf_msan: "1", old: String(params?.old || ""), new: String(params?.new || ""),
        phone: short, area: "88", pt: String(params?.pt || "SV"), sp: String(params?.sp || "WE30"),
      });
      return window.open(`${PROV_URL}?${qs.toString()}#/login`, PROV_TAB);
    }
    case "portcheck": {
      const qs = new URLSearchParams({ sf_pcheck: "1", phone: short, old: String(params?.old || ""), pt: String(params?.pt || "SV") });
      return window.open(`${PROV_URL}?${qs.toString()}#/login`, PROV_TAB);
    }
    case "ports":
      return window.open(`${PROV_URL}?sf_ports=1#/login`, PROV_TAB);
    case "wfmcancel": {
      // من WFM العادى: السكربت بيدخل Dispatcher ← Tasks Queue ← يبحث بالرقم.
      // sf_mode بيحدّد البند: cancel أو reassign، وsf_worker كود العامل للإسناد.
      const mode = String(params?.mode || "cancel");
      const w = String(params?.worker || "").trim();
      const extra = "&sf_mode=" + encodeURIComponent(mode) + (w ? "&sf_worker=" + encodeURIComponent(w) : "");
      return window.open(`${WFM_HOME_URL}#sf_cancel=${encodeURIComponent(short)}${extra}`, WFM_TAB);
    }
    case "wfmreport":  return window.open(WFM_REPORTS_URL, WFM_TAB);
    case "wfmdaily":   return window.open(WFM_LOGIN_URL, WFM_TAB);
    case "fccdaily":   return window.open(FCC_URL, "fcc_daily");
    case "ossdaily":   return window.open(OSS_URL, "oss_daily");
    case "weoas":      return window.open(WEOAS_URL, "weoas_430d");
    default: return null;
  }
}

// تنفيذ **خط واحد** (رقم أكونت واحد) — عشان جهاز التنفيذ يباعد بينهم بمهلة ويمنع التداخل.
// بيرجّع نافذة القياس (لو measure) بنفس الاسم الثابت فيتعاد استخدامها للقياس اللى بعده.
export function executeSingle(type: ExecJobType, account: string | number, opts?: { fixRecent?: boolean }): Window | null {
  const acc = String(account ?? "").trim();
  if (!acc) return null;
  if (type === "subinfo") return openSubInfo(acc);
  if (type === "raise") { openProfileOptimization([acc]); return null; }
  if (type === "stop") { openProfileOptimization([acc], { stopOnly: true }); return null; }
  if (type !== "measure") return openOpSite(type, acc);
  const fix = opts?.fixRecent ? "&sf_fix=recent" : "";
  return window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(acc)}${fix}`, DZS_MEASURE_TARGET);
}

// تنفيذ **مجموعة أرقام دفعة واحدة** — نبعتها كلها للسكربت (DZS/PO) اللى بيلفّ عليها بنفسه
// (زى ما لو ضغطنا عليها والزر مطفى: 6/185…). كده مايفتحش صفحة منفصلة لكل رقم.
export function executeBatch(type: ExecJobType, accounts: (string | number)[], opts?: { fixRecent?: boolean; afterStop?: boolean; params?: ExecJobParams | null }): Window | null {
  const accs = accounts.map((a) => String(a ?? "").trim()).filter(Boolean);
  if (!accs.length) return null;
  // العمليات الجديدة: c360 بياخد كل الأرقام مرة واحدة، والباقى رقم واحد لكل مهمة.
  if (type === "c360") return openOpSite("c360", accs.join(","));
  if (type !== "measure" && type !== "raise" && type !== "stop" && type !== "subinfo") {
    return openOpSite(type, accs[0], opts?.params);
  }
  // المراجعة بتتعمل رقم-رقم (سكربت FCC بياخد رقم واحد فى النافذة)، والطابور أصلاً بيقسّم
  // كل طلب لمهمة لكل رقم، فالمصفوفة هنا بتبقى رقم واحد.
  if (type === "subinfo") return openSubInfo(accs[0]);
  // afterStop: يرفع السرعة ثم يوقف الـ nightly الناتج فى **نفس تشغيلة PO** (مهمة واحدة، مفيش تداخل).
  if (type === "raise") { openProfileOptimization(accs, opts?.afterStop ? { afterStop: true } : {}); return null; }
  if (type === "stop") { openProfileOptimization(accs, { stopOnly: true }); return null; }
  const fix = opts?.fixRecent ? "&sf_fix=recent" : "";
  return window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(accs.join(","))}${fix}`, DZS_MEASURE_TARGET);
}

// آخر وقت قياس لرقم أكونت (للتأكد إن القياس اتحدّث) — millis أو 0
export async function latestMeasureAt(account: string | number): Promise<number> {
  try {
    const r = await fetch(`/api/exec-queue/measure-check?account=${encodeURIComponent(String(account).trim())}`, { credentials: "include" });
    const d = await r.json();
    return d?.at ? new Date(d.at).getTime() : 0;
  } catch { return 0; }
}

// آخر وقت مراجعة (جلب اسم/عنوان من FCC) لرقم تليفون — millis أو 0
export async function latestSubInfoAt(phone: string | number): Promise<number> {
  try {
    const r = await fetch(`/api/exec-queue/subinfo-check?phone=${encodeURIComponent(String(phone).trim())}`, { credentials: "include" });
    const d = await r.json();
    return d?.at ? new Date(d.at).getTime() : 0;
  } catch { return 0; }
}

// آخر وقت رفع سرعة/إيقاف PO لرقم أكونت (للتأكد إن العملية اتنفّذت) — millis أو 0
export async function latestPoEventAt(account: string | number, event: "raise" | "stop"): Promise<number> {
  try {
    const r = await fetch(`/api/exec-queue/po-check?account=${encodeURIComponent(String(account).trim())}&event=${event}`, { credentials: "include" });
    const d = await r.json();
    return d?.at ? new Date(d.at).getTime() : 0;
  } catch { return 0; }
}

// آخر أثر لعملية من العمليات الجديدة على رقم (جلب أكونت/تغيير أو تحديث بورت/إلغاء إسناد/
// تحديث ملف البورتات) — millis أو 0. الأنواع اللى مالهاش أثر فى قاعدة البيانات بترجّع 0،
// وساعتها جهاز التنفيذ بيعتمد على قفل التاب وحده.
export async function latestOpAt(type: ExecJobType, key?: string | number): Promise<number> {
  try {
    const r = await fetch(`/api/exec-queue/op-check?type=${encodeURIComponent(type)}&key=${encodeURIComponent(String(key ?? "").trim())}`, { credentials: "include" });
    const d = await r.json();
    return d?.at ? new Date(d.at).getTime() : 0;
  } catch { return 0; }
}

// ── هوية جهاز التنفيذ ──────────────────────────────────────────────────────
// الرقابة محتاجة تعرف الطلب اتنفّذ من أى جهاز/متصفح. بنركّب اسم مميّز من:
//   المتصفح/النظام (من userAgent) + معرّف ثابت للجهاز محفوظ فى localStorage.
// المعرّف بيتولّد مرة واحدة على الجهاز ويفضل ثابت، فلو نفس المستخدم فتح من
// كمبيوترين مختلفين نقدر نفرّق بينهم.
const DEVICE_KEY = "sf_exec_device_id";
export function execDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch { return "unknown"; }
}

export function execDeviceLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : "متصفح";
  const os =
    /Windows NT 10/.test(ua) ? "Windows 10/11"
    : /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : "نظام غير معروف";
  return `${browser} · ${os} · ${execDeviceId()}`;
}

// هل فيه جهاز تنفيذ مفعّل حالياً؟
export async function isExecutorActive(): Promise<boolean> {
  try {
    const r = await fetch("/api/exec-queue/status", { credentials: "include" });
    if (!r.ok) return false;
    const d = await r.json();
    return !!d.active;
  } catch { return false; }
}

// تتبّع الباتش فى الطابور: نبعت حدث للـ watcher العام (ExecQueueWatcher) اللى بيعرض «تم X من N»
// ويحدّثه كل ما يتنفّذ خط. بيتنادى تلقائياً من enqueueJob بعد نجاح الإضافة (كل الطلب = batch واحد).
export function trackQueueJob(batchId: string, type: ExecJobType, count = 1): void {
  try { window.dispatchEvent(new CustomEvent("sf-exec-track", { detail: { batchId, type, count } })); } catch { /* SSR/بيئة بدون window */ }
}

// تقدّم باتش كامل (كل مهامه ليها نفس batch_id)
export interface BatchProgress { found: boolean; total?: number; done?: number; active?: number; canceled?: number; running?: number; }
export async function fetchBatchProgress(batchId: string): Promise<BatchProgress> {
  try {
    const r = await fetch(`/api/exec-queue/batch-progress?batchId=${encodeURIComponent(batchId)}`, { credentials: "include" });
    return await r.json();
  } catch { return { found: false }; }
}

// ترتيب مهمة معيّنة فى الطابور الآن (للـ watcher) + تقدّم المهمة نفسها والمهمة الجارية
export interface QueuePosition {
  found: boolean;
  status?: string;
  canceled?: boolean; // اتلغت لأن جهاز التنفيذ اتقفل (stale) — مش اتنفّذت
  result?: string;    // نتيجة القياس: done | tab_closed | timeout | stopped
  position?: number;
  total?: number;
  jobDone?: number;   // كام رقم اتنفّذ من مهمة المستخدم
  jobTotal?: number;  // إجمالى أرقام مهمة المستخدم
  active?: { type: ExecJobType; done: number; total: number } | null; // تقدّم المهمة الجارية دلوقتى
}
export async function fetchQueuePosition(id: number): Promise<QueuePosition> {
  try {
    const r = await fetch(`/api/exec-queue/position?id=${id}`, { credentials: "include" });
    return await r.json();
  } catch { return { found: false }; }
}

// مصدر العملية (اسم التقرير اللى اتطلب منه القياس/الرفع/الإيقاف) — كل تقرير يضبطه عند فتحه
// (useSpeedToolSource)، وenqueueJob بيسجّله فى note عشان يظهر فى تقرير معاملات التنفيذ.
let currentSource = "";
export function setSpeedToolSource(s: string): void { currentSource = s || ""; }

// إضافة مهمة للطابور
export async function enqueueJob(type: ExecJobType, accounts: (string | number)[], note?: string, params?: ExecJobParams | null): Promise<{ ok: boolean; id?: number; count?: number; message?: string; batchId?: string }> {
  try {
    const accs = [...new Set(accounts.map((a) => String(a ?? "").trim()).filter(Boolean))];
    const r = await fetch("/api/exec-queue/enqueue", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, accounts: accs, note: note || currentSource || null, params: params || null }),
    });
    const data = await r.json();
    // نبدأ نتتبّع الباتش كامل تلقائياً (يظهر للمستخدم اللى طلبه: تم X من N)
    if (data?.ok && data?.batchId) trackQueueJob(String(data.batchId), type, data.count ?? accs.length);
    return data;
  } catch (e: any) { return { ok: false, message: e?.message }; }
}

// لو فيه جهاز تنفيذ مفعّل → أضف للطابور وارجع true؛ غير كده ارجع false (نفّذ محلياً).
export async function enqueueIfExecutorActive(type: ExecJobType, accounts: (string | number)[], note?: string): Promise<boolean> {
  if (!(await isExecutorActive())) return false;
  const res = await enqueueJob(type, accounts, note);
  return !!res.ok;
}

// سجّل «نيّة» العملية (مين طلبها) — يُختم بعدها فى النتيجة (measured_by / last_raise_by / last_stop_by).
export async function recordOpIntent(type: ExecJobType, accounts: (string | number)[]): Promise<void> {
  const accs = accounts.map((a) => String(a ?? "").trim()).filter(Boolean);
  if (!accs.length) return;
  try {
    await fetch("/api/op-intent", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, accounts: accs }),
    });
  } catch { /* تسجيل النيّة إضافى — لو فشل نكمّل عادى */ }
}

export const NO_EXECUTOR_MSG = "غير متاح حالياً — لا توجد أجهزة مفعّلة للتنفيذ. فعّل «جهاز التنفيذ» على متصفح السوبر أدمن أولاً.";

// التنفيذ المحلى (فتح بوابة DZS/PO الداخلية) بيشتغل على متصفح كمبيوتر مكتب فقط — الموبايل مايقدرش
// يوصل بوابة DZS الداخلية، فبيفتح تاب فاضى بلا فايدة. لذلك لو مفيش جهاز تنفيذ مفعّل والجهاز موبايل،
// حتى السوبر أدمن ياخد رسالة «لا توجد أجهزة» بدل التشغيل المحلى.
export function canRunLocalExecutor(): boolean {
  try {
    const ua = navigator.userAgent || "";
    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua) ||
      ((navigator as any).maxTouchPoints > 1 && !/Windows/i.test(ua)); // iPad الحديث بيتقدّم كـ Mac
    return !isMobile;
  } catch {
    return true;
  }
}
export const QUEUE_LABEL: Record<ExecJobType, string> = {
  measure: "القياس", raise: "رفع السرعة", stop: "إيقاف PO",
  subinfo: "مراجعة البيان الفنى", c360: "جلب الأكونت من Customer360",
  portchange: "تغيير البورت", portcheck: "تحديث البورت", ports: "تحديث ملف البورتات",
  wfmcancel: "إلغاء الاسناد", wfmreport: "تقارير WFM",
  fccdaily: "تحديث ملف FCC", wfmdaily: "تحديث ملف أوامر الشغل",
  ossdaily: "تحديث ملف OSS", weoas: "تحديث 430D",
};

// منطق موحّد لأزرار القياس/رفع السرعة/الإيقاف فى كل التقارير (نفس بحث برقم التليفون):
//  - جهاز التنفيذ مفعّل → أضف للطابور ورجّع true (اتعامل معاها).
//  - مش مفعّل + مش سوبر أدمن → رسالة عدم الإتاحة ورجّع true (اتعامل معاها).
//  - مش مفعّل + سوبر أدمن → رجّع false عشان المُنادِى ينفّذ محلياً عادى.
export async function dispatchSpeedTool(
  type: ExecJobType,
  accounts: (string | number)[],
  isSuper: boolean,
  opts?: { params?: ExecJobParams | null; silent?: boolean },
): Promise<boolean> {
  const accs = accounts.map((a) => String(a ?? "").trim()).filter(Boolean);
  const say = (m: string) => { if (!opts?.silent) alert(m); };
  if (!accs.length) { say(type === "measure" || type === "raise" || type === "stop" ? "لا توجد أرقام أكونت" : "لا يوجد رقم"); return true; }
  // «مين عمل إيه»: بنسجّل نيّة العملية قبل التنفيذ، والنتيجة اللى بتوصل من السكربت بتُختم بيها
  // (measured_by / last_raise_by / requested_by …). العمليات على مستوى الموقع كله مالهاش رقم.
  if (!SITE_WIDE_TYPES.has(type)) void recordOpIntent(type, accs);
  if (await isExecutorActive()) {
    const res = await enqueueJob(type, accs, undefined, opts?.params);
    say(res.ok ? `تم إضافة ${accs.length} رقم لطابور ${QUEUE_LABEL[type]} — هيتنفّذ على جهاز التنفيذ` : (res.message || "تعذّر الإضافة للطابور"));
    return true;
  }
  if (!isSuper || !canRunLocalExecutor()) { say(NO_EXECUTOR_MSG); return true; }
  return false; // سوبر أدمن على كمبيوتر مكتب ومفيش جهاز تنفيذ → نفّذ محلياً
}

// عمليات على مستوى الموقع كله (مش رقم بعينه) — مالهاش نيّة ولا مفتاح رقم.
const SITE_WIDE_TYPES = new Set<ExecJobType>(["ports", "wfmreport", "fccdaily", "wfmdaily", "ossdaily", "weoas"]);
export const SITE_WIDE_KEY = "-"; // مفتاح صورى: الطابور بيرفض المهام بدون أرقام

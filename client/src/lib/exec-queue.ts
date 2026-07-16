// ============================================================================
// client/src/lib/exec-queue.ts
// طابور التنفيذ المركزى: رفع السرعة/القياس/الإيقاف يتنفّذ على «جهاز التنفيذ»
// (براوزر سوبر أدمن مفعّل الزر). أى جهاز تانى يضيف المهمة للطابور بدل ما ينفّذ عنده.
// ============================================================================
import { openProfileOptimization } from "./profile-optimization";

export type ExecJobType = "raise" | "stop" | "measure";
export interface ExecJob { id: number; type: ExecJobType; accounts: string[]; requestedBy?: string | null; }

const DZS_URL = "https://10.42.187.101:8080/expresse/";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// تنفيذ **خط واحد** (رقم أكونت واحد) — عشان جهاز التنفيذ يباعد بينهم بمهلة ويمنع التداخل.
// بيرجّع نافذة القياس (لو measure) عشان جهاز التنفيذ يقدر يقفل تاب القياس السابق أول ما يفتح
// الجديد — كده يفضل تاب واحد بس مفتوح (الأخير)، ولو جه قياس جديد يفتح ويقفل القديم.
export function executeSingle(type: ExecJobType, account: string | number): Window | null {
  const acc = String(account ?? "").trim();
  if (!acc) return null;
  if (type === "raise") { openProfileOptimization([acc]); return null; }
  if (type === "stop") { openProfileOptimization([acc], { stopOnly: true }); return null; }
  return window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(acc)}`, "_blank");
}

// تنفيذ **مجموعة أرقام دفعة واحدة** — نبعتها كلها للسكربت (DZS/PO) اللى بيلفّ عليها بنفسه
// (زى ما لو ضغطنا عليها والزر مطفى: 6/185…). كده مايفتحش صفحة منفصلة لكل رقم.
export function executeBatch(type: ExecJobType, accounts: (string | number)[]): Window | null {
  const accs = accounts.map((a) => String(a ?? "").trim()).filter(Boolean);
  if (!accs.length) return null;
  if (type === "raise") { openProfileOptimization(accs); return null; }
  if (type === "stop") { openProfileOptimization(accs, { stopOnly: true }); return null; }
  return window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(accs.join(","))}`, "_blank");
}

// آخر وقت قياس لرقم أكونت (للتأكد إن القياس اتحدّث) — millis أو 0
export async function latestMeasureAt(account: string | number): Promise<number> {
  try {
    const r = await fetch(`/api/exec-queue/measure-check?account=${encodeURIComponent(String(account).trim())}`, { credentials: "include" });
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

// هل فيه جهاز تنفيذ مفعّل حالياً؟
export async function isExecutorActive(): Promise<boolean> {
  try {
    const r = await fetch("/api/exec-queue/status", { credentials: "include" });
    if (!r.ok) return false;
    const d = await r.json();
    return !!d.active;
  } catch { return false; }
}

// تتبّع ترتيب مهمة فى الطابور: نبعت حدث للـ watcher العام (ExecQueueWatcher) اللى بيعرض الترتيب
// ويحدّثه كل ما تتقدّم المهمة خطوة. بيتنادى تلقائياً من enqueueJob بعد نجاح الإضافة.
export function trackQueueJob(id: number, type: ExecJobType, count = 1): void {
  try { window.dispatchEvent(new CustomEvent("sf-exec-track", { detail: { id, type, count } })); } catch { /* SSR/بيئة بدون window */ }
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
export async function enqueueJob(type: ExecJobType, accounts: (string | number)[], note?: string): Promise<{ ok: boolean; id?: number; count?: number; message?: string }> {
  try {
    const accs = [...new Set(accounts.map((a) => String(a ?? "").trim()).filter(Boolean))];
    const r = await fetch("/api/exec-queue/enqueue", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, accounts: accs, note: note || currentSource || null }),
    });
    const data = await r.json();
    // نبدأ نتتبّع ترتيب المهمة فى الطابور تلقائياً (يظهر للمستخدم اللى طلبها)
    if (data?.ok && data?.id) trackQueueJob(Number(data.id), type, data.count ?? accs.length);
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
const QUEUE_LABEL: Record<ExecJobType, string> = { measure: "القياس", raise: "رفع السرعة", stop: "إيقاف PO" };

// منطق موحّد لأزرار القياس/رفع السرعة/الإيقاف فى كل التقارير (نفس بحث برقم التليفون):
//  - جهاز التنفيذ مفعّل → أضف للطابور ورجّع true (اتعامل معاها).
//  - مش مفعّل + مش سوبر أدمن → رسالة عدم الإتاحة ورجّع true (اتعامل معاها).
//  - مش مفعّل + سوبر أدمن → رجّع false عشان المُنادِى ينفّذ محلياً عادى.
export async function dispatchSpeedTool(type: ExecJobType, accounts: (string | number)[], isSuper: boolean): Promise<boolean> {
  const accs = accounts.map((a) => String(a ?? "").trim()).filter(Boolean);
  if (!accs.length) { alert("لا توجد أرقام أكونت"); return true; }
  void recordOpIntent(type, accs); // سجّل مين طلب العملية (للعرض بعدها: اتعمل بواسطة …)
  if (await isExecutorActive()) {
    const res = await enqueueJob(type, accs);
    alert(res.ok ? `تم إضافة ${accs.length} رقم لطابور ${QUEUE_LABEL[type]} — هيتنفّذ على جهاز التنفيذ` : (res.message || "تعذّر الإضافة للطابور"));
    return true;
  }
  if (!isSuper || !canRunLocalExecutor()) { alert(NO_EXECUTOR_MSG); return true; }
  return false; // سوبر أدمن على كمبيوتر مكتب ومفيش جهاز تنفيذ → نفّذ محلياً
}

// ============================================================================
// client/src/lib/daily-update.ts
// «حدّث التقارير اليومية»: يرسل FCC + WFM + OSS، وبورتال البورتات (بشرط تعدّى 7:45
// وإن البورتات ماتحدّثتش بعد 7:45 النهارده) إلى طابور التنفيذ لمنع تعارض نفس الدومين.
// التشغيل اليدوى يحجز التاب داخل ضغطة الزر، ثم يوجّهه جهاز التنفيذ عند سحب المهمة.
// ============================================================================
import { dispatchSpeedTool, openOpSite, reserveOpWindow, SITE_WIDE_KEY, type ExecJobType } from "./exec-queue";

const cairoDay = (d: string | number | Date) =>
  new Date(d).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const cairoMinOfDay = (d: string | number | Date) => {
  const s = new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Cairo", hour12: false, hour: "2-digit", minute: "2-digit" });
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// كل موقع بيدخل الطابور بمساره (الدومين بتاعه) عشان مايتعارضش مع أى زر تانى على نفس الموقع.
// لو مفيش جهاز تنفيذ، نستخدم التاب المحجوز ونفتح محلياً كحل احتياطى.
function localExecutorEnabled(): boolean {
  try { return localStorage.getItem("sf_exec_active") === "1"; } catch { return false; }
}
async function queueOrOpen(type: ExecJobType, manual = false): Promise<void> {
  const reserved = manual ? reserveOpWindow(type) : null;
  const localExecutor = manual && localExecutorEnabled();
  if (await dispatchSpeedTool(type, [SITE_WIDE_KEY], true, { silent: true })) {
    // لو جهاز التنفيذ على جهاز آخر، التاب المحجوز هنا لا يجب أن يظل فارغاً.
    if (!localExecutor) { try { if (reserved && !reserved.closed) reserved.close(); } catch {} }
    return;
  }
  openOpSite(type, "", undefined, reserved);
}

export function runManualSiteUpdate(type: ExecJobType): void {
  void queueOrOpen(type, true);
}

export function runDailyUpdate(
  uploadTimes: Record<string, string | null> | undefined,
  opts?: { manual?: boolean },
) {
  void queueOrOpen("fccdaily", !!opts?.manual);
  void queueOrOpen("wfmdaily", !!opts?.manual);
  void queueOrOpen("ossdaily", !!opts?.manual);
  void queueOrOpen("weoas", !!opts?.manual);
  // ابدأ تجهيز التصدير بعد حجز التابات داخل gesture الخاص بالزر.
  fetch("/api/fcc-export/arm", { method: "POST", credentials: "include" }).catch(() => {});

  // بورتال منافذ MSAN: مرة واحدة يومياً بعد 7:45 (المصدر بيتحدّث حوالى 8 إلا ربع)
  const today = cairoDay(new Date());
  const pt = uploadTimes || {};
  const queryLoaded = Object.keys(pt).length > 0;
  const PORTS_THRESHOLD_MIN = 7 * 60 + 45; // 7:45
  const updatedAfterThresholdToday = (iso?: string | null) =>
    !!iso && cairoDay(iso) === today && cairoMinOfDay(iso) >= PORTS_THRESHOLD_MIN;
  const portsDoneToday =
    updatedAfterThresholdToday(pt["ports_run_complete"]) ||
    updatedAfterThresholdToday(pt["/api/phone-ports/import"]);
  const nowAfterThreshold = cairoMinOfDay(new Date()) >= PORTS_THRESHOLD_MIN;
  if (queryLoaded && nowAfterThreshold && !portsDoneToday) {
    fetch("/api/ports-auto/arm", { method: "POST", credentials: "include" }).catch(() => {});
    void queueOrOpen("ports", !!opts?.manual);
  }
}

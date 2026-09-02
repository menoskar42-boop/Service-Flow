// ============================================================================
// client/src/lib/daily-update.ts
// «حدّث التقارير اليومية»: يفتح FCC + WFM + OSS، وبورتال البورتات (بشرط تعدّى 7:45
// وإن البورتات ماتحدّثتش بعد 7:45 النهارده). التشغيل اليدوى يفتح المواقع داخل ضغطة الزر
// حتى لا يمنع المتصفح النوافذ المنبثقة؛ المؤقّت الخلفى يستخدم الطابور على جهاز التنفيذ.
// ============================================================================
import { dispatchSpeedTool, openOpSite, SITE_WIDE_KEY, type ExecJobType } from "./exec-queue";

const cairoDay = (d: string | number | Date) =>
  new Date(d).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const cairoMinOfDay = (d: string | number | Date) => {
  const s = new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Cairo", hour12: false, hour: "2-digit", minute: "2-digit" });
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// كل موقع بيدخل الطابور بمساره (الدومين بتاعه) عشان مايتعارضش مع أى زر تانى على نفس الموقع
// (مثلاً تحديث ملف أوامر الشغل مع «إلغاء الاسناد» — الاتنين wfm.te.eg). لو مفيش جهاز تنفيذ
// مفعّل بيفتح محلياً زى الأول وبدون أى رسالة (silent) عشان التحديث اليومى مايقاطعش المستخدم.
async function queueOrOpen(type: ExecJobType): Promise<void> {
  if (await dispatchSpeedTool(type, [SITE_WIDE_KEY], true, { silent: true })) return;
  openOpSite(type, "");
}

export function runDailyUpdate(
  uploadTimes: Record<string, string | null> | undefined,
  opts?: { manual?: boolean },
) {
  // FCC + WFM + OSS — تابات بأسماء ثابتة تُعاد استخدامها (مفيش تكديس)
  fetch("/api/fcc-export/arm", { method: "POST", credentials: "include" }).catch(() => {});
  if (opts?.manual) {
    // لازم تكون الاستدعاءات متزامنة مع onClick؛ أى await قبل window.open يجعل Chrome/Edge يحجب التاب.
    openOpSite("fccdaily", "");
    openOpSite("wfmdaily", "");
    openOpSite("ossdaily", "");
    // 430D (WE OAS BI): نفس لينك زر «430D» بالظبط — سكربت Tampermonkey بيسجّل الدخول
    // ويشغّل التفاصيل + المتبقى ثم يقفل التاب.
    openOpSite("weoas", "");
  } else {
    void queueOrOpen("fccdaily");
    void queueOrOpen("wfmdaily");
    void queueOrOpen("ossdaily");
    void queueOrOpen("weoas");
  }

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
    if (opts?.manual) openOpSite("ports", "");
    else void queueOrOpen("ports");
  }
}

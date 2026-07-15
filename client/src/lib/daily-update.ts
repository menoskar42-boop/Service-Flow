// ============================================================================
// client/src/lib/daily-update.ts
// «حدّث التقارير اليومية»: يفتح FCC + WFM + OSS، وبورتال البورتات (بشرط تعدّى 7:45
// وإن البورتات ماتحدّثتش بعد 7:45 النهارده). يُستدعى من الزر اليدوى ومن المؤقّت الخلفى
// (DailyAutoRefresh) — نفس المنطق فى مكان واحد.
// ============================================================================
const cairoDay = (d: string | number | Date) =>
  new Date(d).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const cairoMinOfDay = (d: string | number | Date) => {
  const s = new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Cairo", hour12: false, hour: "2-digit", minute: "2-digit" });
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function runDailyUpdate(uploadTimes: Record<string, string | null> | undefined) {
  // FCC + WFM + OSS — تابات بأسماء ثابتة تُعاد استخدامها (مفيش تكديس)
  fetch("/api/fcc-export/arm", { method: "POST", credentials: "include" }).catch(() => {});
  window.open("https://fcc.te.eg/TroubleTicket/faces/security/pages/Login.jsf", "fcc_daily");
  window.open("https://wfm.te.eg/WorkOrder/faces/security/pages/Login.jsf", "wfm_daily");
  window.open("https://oss.te.eg:15201/om", "oss_daily");

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
    window.open("https://provisioningportal.te.eg/provisioningPortal/?sf_ports=1#/login", "sf_ports_auto");
  }
}

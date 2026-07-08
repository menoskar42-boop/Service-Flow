// فتح بوابة AXON Expresse لتشغيل Profile Optimization (رفع السرعة) لمجموعة أرقام أكونت.
// سكربت التامبر منكى (dzs-profile-optimization.user.js) بيقرأ الأرقام من الـ hash (#sf_po=)،
// يسجّل الدخول لو لزم، ويشغّل «Start Realtime PO» لكل رقم بالتتابع.
// منفصل تماماً عن تدفّق القياس (sf_accounts) — السكربتان لا يتعارضان (حارس PO_ACTIVE).
const PO_BASE = "https://10.42.187.101:8080/expresse/profileOptimization";

/**
 * يفتح تاب رفع السرعة ومعاه قائمة أرقام الأكونت فى الـ hash للسكربت يقراها.
 * stopOnly = true: وضع «إيقاف Nightly PO فقط» — يوقف الـ nightly لو شغّال ويرجّع الحالة Not Started
 * بدون تشغيل Start Realtime PO (ولو أصلاً Not Started مايعملش حاجة).
 */
export function openProfileOptimization(accounts: (string | number | null | undefined)[], stopOnly = false): void {
  const accs = [...new Set(accounts.map((a) => String(a ?? "").trim()).filter(Boolean))];
  if (accs.length === 0) {
    alert(stopOnly ? "لا توجد أرقام أكونت لإيقاف الـ Nightly PO" : "لا توجد أرقام أكونت لرفع السرعة");
    return;
  }
  const stop = stopOnly ? "&sf_stop=1" : "";
  const url = `${PO_BASE}?lineId=${encodeURIComponent(accs[0])}#sf_po=${encodeURIComponent(accs.join(","))}${stop}`;
  window.open(url, "_blank");
}

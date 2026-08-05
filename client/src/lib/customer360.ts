// فتح صفحة Customer360 لجلب أرقام الأكونت لمجموعة خطوط بدون أكونت.
// سكربت التامبر منكى (customer360-account-grabber.user.js) بيقرأ الأرقام من الـ hash،
// يستنى تسجيل الدخول + حل البازل، يقرأ رقم الأكونت ويحفظه فى الموقع تلقائياً.
const C360_LOGIN_URL = "https://customer360.te.eg/Authentication/Login";

/** يفتح Customer360 ومعاه قائمة أرقام التليفون الكاملة فى الـ hash للسكربت يقراها. */
// بيمرّ بطابور التنفيذ الأول: customer360.te.eg مسار مستقل، تاب واحد فى المرة (لكنه بيشتغل
// بالتوازى مع المواقع التانية). لو مفيش جهاز تنفيذ مفعّل بيفتح محلياً زى الأول. كل أزرار
// الجلب دى للسوبر أدمن فقط، فبنمرّر isSuper = true.
export async function openCustomer360(fullPhones: string[]): Promise<void> {
  const phones = [...new Set(fullPhones.map((p) => String(p ?? "").trim()).filter(Boolean))];
  if (phones.length === 0) {
    alert("لا توجد أرقام تليفون لجلب الأكونت لها");
    return;
  }
  const { dispatchSpeedTool } = await import("./exec-queue");
  if (await dispatchSpeedTool("c360", phones, true)) return;
  const url = `${C360_LOGIN_URL}#sf_phones=${encodeURIComponent(phones.join(","))}`;
  // noreferrer/noopener: نفتح كأننا افتحنا الرابط مباشرة (من غير referrer لموقعنا) — بوابة te.eg
  // بتعلّق (تفضل تحمّل) لو الطلب جالها referrer خارجى من الموقع. الـ hash بيوصل عادى للسكربت.
  window.open(url, "_blank", "noopener,noreferrer");
}

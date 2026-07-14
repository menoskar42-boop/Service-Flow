// ============================================================================
// client/src/lib/use-wake-lock.ts
// منع الكمبيوتر/الشاشة من الدخول فى وضع النوم طالما موقع Service-Flow مفتوح.
// بيستخدم Screen Wake Lock API + يعيد طلب القفل تلقائياً لو اترفع (مثلاً لما
// المستخدم يرجع للتاب). مهم بشكل خاص لما التحديث التلقائى كل نص ساعة أو جهاز
// التنفيذ مفعّلين — لازم المتصفح يفضل صاحى عشان المؤقتات تشتغل.
// ============================================================================
import { useEffect } from "react";

export function useWakeLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    // @ts-ignore — wakeLock مش معرّفة فى كل نسخ TS
    const wl = (navigator as any)?.wakeLock;
    if (!wl?.request) return; // المتصفح مايدعمش الـ API — نتجاهل بهدوء

    let sentinel: any = null;
    let released = false;

    const acquire = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        sentinel = await wl.request("screen");
        sentinel.addEventListener?.("release", () => {
          // اترفع (النظام أو تبديل تاب) — نحاول نرجّعه لو لسه مفعّل
          if (!released) setTimeout(acquire, 500);
        });
      } catch {
        /* ممكن يفشل لو التاب مش ظاهر — هنعيد المحاولة عند الرجوع */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      try { sentinel?.release?.(); } catch { /* ignore */ }
      sentinel = null;
    };
  }, [enabled]);
}

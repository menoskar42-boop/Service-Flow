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

    // ── fallback: فيديو مكتوم من canvas شغّال باستمرار ──
    // الـ Wake Lock بيتحرّر لما التاب يتخفّى، فلوحده مش كافى لمنع نوم الجهاز فى الخلفية
    // (زى ما حصل مع جهاز التنفيذ). تشغيل ميديا مستمر بيخلّى النظام يفضل صاحى حتى والتاب
    // فى الخلفية — نفس الحيلة المستخدمة فى سكربت القياس (DZS) اللى بتنفع فعلياً.
    let videoEl: HTMLVideoElement | null = null;
    let canvasTimer: any = null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2; canvas.height = 2;
      const ctx = canvas.getContext("2d");
      let f = 0;
      canvasTimer = setInterval(() => { f = (f + 3) % 255; if (ctx) { ctx.fillStyle = "rgb(" + f + ",0,0)"; ctx.fillRect(0, 0, 2, 2); } }, 1000);
      const stream = (canvas as any).captureStream ? (canvas as any).captureStream(2) : null;
      if (stream) {
        videoEl = document.createElement("video");
        videoEl.srcObject = stream;
        videoEl.muted = true;
        videoEl.setAttribute("playsinline", "");
        videoEl.setAttribute("autoplay", "");
        videoEl.loop = true;
        videoEl.style.cssText = "position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;";
        document.body.appendChild(videoEl);
        const play = () => videoEl && videoEl.play().catch(() => {});
        play();
        // لو الفيديو اتوقف لأى سبب رجّعه لما التاب يرجع للواجهة
        videoEl.addEventListener("pause", () => { if (!released) play(); });
      }
    } catch { /* المتصفح مايدعمش captureStream — نكتفى بالـ Wake Lock */ }

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      try { sentinel?.release?.(); } catch { /* ignore */ }
      sentinel = null;
      try { if (canvasTimer) clearInterval(canvasTimer); } catch { /* ignore */ }
      try { if (videoEl) { videoEl.pause(); (videoEl.srcObject as MediaStream | null)?.getTracks?.().forEach((t) => t.stop()); videoEl.srcObject = null; videoEl.remove(); } } catch { /* ignore */ }
      videoEl = null;
    };
  }, [enabled]);
}

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

    // ── AudioContext صامت شغّال باستمرار ──
    // ده الأضمن لمنع المتصفح من تجميد/إبطاء التاب فى الخلفية — طول ما فيه AudioContext «running»
    // المؤقّتات (زى التحديث كل نص ساعة) بتفضل شغّالة حتى والتاب مش قدامك. محتاج تفاعل مستخدم
    // واحد عشان يبدأ (سياسة الأوتوبلاي)، فبنبدأه عند أول ضغطة + بنحاول نرجّعه عند الرجوع للتاب.
    let audioCtx: AudioContext | null = null;
    const startAudio = () => {
      try {
        if (!audioCtx) {
          const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (!AC) return;
          audioCtx = new AC();
          const osc = audioCtx!.createOscillator();
          const gain = audioCtx!.createGain();
          gain.gain.value = 0; // صامت تماماً
          osc.frequency.value = 440;
          osc.connect(gain); gain.connect(audioCtx!.destination);
          osc.start();
        }
        if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      } catch { /* ignore */ }
    };
    // ── صوت فعلى صامت المحتوى (غير مكتوم) شغّال باستمرار (loop) ──
    // ده أهم إضافة لمنع *نوم النظام* (مش الشاشة بس): AudioContext بـ gain=0 والفيديو المكتوم
    // النظام بيعتبرهم «مفيش صوت» فبينام. لكن عنصر <audio> بيشغّل ستريم صوت فعلى (محتواه صمت →
    // غير مسموع) وغير مكتوم → النظام بيشوف «جلسة صوت نشطة» فيفضل صاحى (على Windows تحديداً).
    let keepAudio: HTMLAudioElement | null = null;
    let silentUrl = "";
    const makeSilentWavUrl = (seconds = 1, rate = 8000) => {
      const n = seconds * rate;
      const buf = new ArrayBuffer(44 + n);
      const v = new DataView(buf);
      const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ");
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true);
      v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
      for (let i = 0; i < n; i++) v.setUint8(44 + i, 128); // 128 = صمت لـ 8-bit unsigned
      return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    };
    const startKeepAudio = () => {
      try {
        if (!keepAudio) {
          silentUrl = makeSilentWavUrl(1, 8000);
          keepAudio = document.createElement("audio");
          keepAudio.src = silentUrl;
          keepAudio.loop = true;
          keepAudio.volume = 0.02; // منخفض جداً — والمحتوى صمت أصلاً فهو غير مسموع
          keepAudio.setAttribute("playsinline", "");
          keepAudio.style.cssText = "position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;";
          document.body.appendChild(keepAudio);
          keepAudio.addEventListener("pause", () => { if (!released) keepAudio?.play().catch(() => {}); });
        }
        keepAudio.play().catch(() => {});
      } catch { /* المتصفح رفض التشغيل قبل التفاعل — هيشتغل عند أول ضغطة */ }
    };

    const onGesture = () => { startAudio(); startKeepAudio(); };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { startAudio(); startKeepAudio(); } });
    startAudio(); startKeepAudio(); // محاولة فورية (قد تفشل قبل أى تفاعل — تشتغل عند أول ضغطة)

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      try { sentinel?.release?.(); } catch { /* ignore */ }
      sentinel = null;
      try { if (canvasTimer) clearInterval(canvasTimer); } catch { /* ignore */ }
      try { if (videoEl) { videoEl.pause(); (videoEl.srcObject as MediaStream | null)?.getTracks?.().forEach((t) => t.stop()); videoEl.srcObject = null; videoEl.remove(); } } catch { /* ignore */ }
      videoEl = null;
      try { audioCtx?.close(); } catch { /* ignore */ }
      audioCtx = null;
      try { if (keepAudio) { keepAudio.pause(); keepAudio.src = ""; keepAudio.remove(); } } catch { /* ignore */ }
      try { if (silentUrl) URL.revokeObjectURL(silentUrl); } catch { /* ignore */ }
      keepAudio = null;
    };
  }, [enabled]);
}

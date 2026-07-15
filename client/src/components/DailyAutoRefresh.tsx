import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { runDailyUpdate } from "@/lib/daily-update";

// مؤقّت «التحديث كل نص ساعة» فى الخلفية — مكوّن غير مرئى يتركّب دايماً فى الداشبورد.
// قبل كده كان المؤقّت جوّه قسم «رفع الملفات»، فماكانش بيشتغل إلا وإنت فاتح التاب ده،
// وكان بيخزّن التحديث ويطلّعه كله مرة واحدة أول ما تدوس على القسم. دلوقتى بيشتغل فى الخلفية
// على أى تاب طول ما الموقع مفتوح (سوبر أدمن فقط، ومُفعَّل بزر «كل نص ساعة»).
const AUTO_INTERVAL_MS = 30 * 60 * 1000;

export function DailyAutoRefresh() {
  const { user } = useAuth();
  const isSuper = user?.role === ROLES.SUPER_ADMIN;
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem("sf_hourly_auto") === "1"; } catch { return false; }
  });

  // زامن حالة التفعيل مع زر التبديل (نفس التاب: حدث مخصّص، تابات تانية: storage)
  useEffect(() => {
    const sync = () => { try { setActive(localStorage.getItem("sf_hourly_auto") === "1"); } catch {} };
    window.addEventListener("sf-hourly-toggle", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("sf-hourly-toggle", sync); window.removeEventListener("storage", sync); };
  }, []);

  const { data: uploadTimes = {} } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/upload-times"],
    queryFn: () => fetch("/api/upload-times", { credentials: "include" }).then((r) => r.json()),
    enabled: isSuper && active,
    refetchInterval: 5 * 60 * 1000,
  });
  const uploadTimesRef = useRef(uploadTimes);
  useEffect(() => { uploadTimesRef.current = uploadTimes; }, [uploadTimes]);

  useEffect(() => {
    if (!isSuper || !active) return;
    const readLast = () => { try { const v = localStorage.getItem("sf_hourly_last"); return v ? Number(v) : 0; } catch { return 0; } };
    const tick = () => {
      runDailyUpdate(uploadTimesRef.current);
      try { localStorage.setItem("sf_hourly_last", String(Date.now())); window.dispatchEvent(new Event("sf-hourly-ran")); } catch {}
    };
    // مفيش تشغيل فورى عند التركيب — بس فحص دورى كل 60ث؛ يشغّل أول ما يعدّى 30 دقيقة من آخر تشغيل.
    // كده ما بيطلعش الصفحات لمجرّد ما نفتح الموقع/نبدّل تاب، وبيلحق أى موعد فات خلال دقيقة.
    const check = () => { if (Date.now() - readLast() >= AUTO_INTERVAL_MS) tick(); };
    const id = setInterval(check, 60 * 1000);
    const onWake = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onWake); window.removeEventListener("focus", onWake); };
  }, [isSuper, active]);

  return null;
}

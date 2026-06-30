import { useEffect, useState } from "react";

// حالة "نشاط" مشتركة للتطبيق: نشط = التاب ظاهر + فيه تفاعل خلال آخر IDLE_MS.
// نستخدمها لقطع الـ WebSocket وإيقاف الـ polling لما المستخدم مش بيعمل حاجة (أو التاب في الخلفية)
// عشان السيرفر (Autoscale) يقدر ينام ويوفّر تكلفة — ويرجع فوراً أول ما يتحرك.
const IDLE_MS = 2 * 60 * 1000; // خامل بعد دقيقتين بدون تفاعل

let active = typeof document !== "undefined" ? !document.hidden : true;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<(v: boolean) => void>();

function emit(v: boolean) {
  if (active === v) return;
  active = v;
  subs.forEach((f) => f(v));
}

function onActivity() {
  if (idleTimer) clearTimeout(idleTimer);
  if (typeof document === "undefined" || !document.hidden) emit(true);
  idleTimer = setTimeout(() => emit(false), IDLE_MS);
}

function onVisibility() {
  if (document.hidden) emit(false);
  else onActivity();
}

if (typeof window !== "undefined") {
  ["mousemove", "mousedown", "keydown", "touchstart", "scroll"].forEach((e) =>
    window.addEventListener(e, onActivity, { passive: true }),
  );
  document.addEventListener("visibilitychange", onVisibility);
  onActivity(); // بداية
}

export function getAppActive() {
  return active;
}

// hook يرجّع حالة النشاط ويعيد الرندر عند تغيّرها (عشان React Query يقرأ refetchInterval الجديد).
export function useAppActive() {
  const [v, setV] = useState(active);
  useEffect(() => {
    subs.add(setV);
    setV(active);
    return () => {
      subs.delete(setV);
    };
  }, []);
  return v;
}

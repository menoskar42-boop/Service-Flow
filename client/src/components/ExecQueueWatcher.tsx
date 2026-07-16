import { useEffect, useRef, useState } from "react";
import { fetchBatchProgress, type ExecJobType } from "@/lib/exec-queue";
import { Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";

// لوحة عائمة بتتبّع **الباتش كامل** (كل الأرقام اللى اتطلبت مرة واحدة) وبتعرض «تم X من N» وبتحدّثه
// كل ~3ث لحد ما يخلص. الباتش بيتضاف تلقائياً عند نجاح enqueueJob (حدث sf-exec-track بالـ batchId).
type TrackedBatch = {
  batchId: string;
  type: ExecJobType;
  count: number;
  total: number | null;
  done: number;
  active: number | null;
  canceled: number;
  running: number;
  finished: boolean;
};

const LABEL: Record<string, string> = { measure: "القياس", raise: "رفع السرعة", stop: "إيقاف PO" };

export function ExecQueueWatcher() {
  const [batches, setBatches] = useState<TrackedBatch[]>([]);
  const ref = useRef<TrackedBatch[]>([]);
  ref.current = batches;
  const busy = useRef(false);

  useEffect(() => {
    const onTrack = (e: Event) => {
      const d = (e as CustomEvent).detail as { batchId: string; type: ExecJobType; count: number };
      if (!d?.batchId) return;
      setBatches((prev) =>
        prev.some((b) => b.batchId === d.batchId)
          ? prev
          : [...prev, { batchId: d.batchId, type: d.type, count: d.count || 1, total: d.count || 1, done: 0, active: null, canceled: 0, running: 0, finished: false }],
      );
    };
    window.addEventListener("sf-exec-track", onTrack as any);
    return () => window.removeEventListener("sf-exec-track", onTrack as any);
  }, []);

  useEffect(() => {
    const iv = setInterval(async () => {
      if (busy.current) return;
      const act = ref.current.filter((b) => !b.finished);
      if (!act.length) return;
      busy.current = true;
      try {
        for (const b of act) {
          const p = await fetchBatchProgress(b.batchId);
          setBatches((prev) =>
            prev.map((x) => {
              if (x.batchId !== b.batchId) return x;
              if (!p.found) {
                if (!x.finished) setTimeout(() => setBatches((q) => q.filter((y) => y.batchId !== b.batchId)), 6000);
                return { ...x, finished: true };
              }
              const active = p.active ?? 0;
              const finished = active === 0;
              if (finished && !x.finished) setTimeout(() => setBatches((q) => q.filter((y) => y.batchId !== b.batchId)), 8000);
              return { ...x, total: p.total ?? x.total, done: p.done ?? x.done, active, canceled: p.canceled ?? 0, running: p.running ?? 0, finished };
            }),
          );
        }
      } finally {
        busy.current = false;
      }
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  const dismiss = (id: string) => setBatches((prev) => prev.filter((b) => b.batchId !== id));
  if (!batches.length) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-2 max-w-[320px]" dir="rtl">
      {batches.map((b) => {
        const total = b.total ?? b.count;
        const allCanceled = b.finished && b.canceled >= total && b.done === 0;
        return (
          <div key={b.batchId} className="rounded-lg border bg-white dark:bg-gray-900 shadow-lg px-3 py-2 text-sm flex items-center gap-2">
            {b.finished ? (
              allCanceled ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                {LABEL[b.type] || b.type}
                {total > 1 ? ` (${total} خط)` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {b.finished
                  ? allCanceled
                    ? "⚠️ أُلغِيت"
                    : `✅ خلص — تم ${b.done} من ${total}${b.canceled ? ` (${b.canceled} أُلغِيت)` : ""}`
                  : `تم ${b.done} من ${total}${b.running ? " · قيد التنفيذ" : b.active ? " · فى الطابور" : ""}`}
              </div>
            </div>
            <button onClick={() => dismiss(b.batchId)} className="text-muted-foreground hover:text-foreground shrink-0" title="إخفاء">
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

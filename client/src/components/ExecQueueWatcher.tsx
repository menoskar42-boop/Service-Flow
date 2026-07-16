import { useEffect, useRef, useState } from "react";
import { fetchQueuePosition, type ExecJobType } from "@/lib/exec-queue";
import { Loader2, CheckCircle2, X } from "lucide-react";

// لوحة عائمة بتعرض ترتيب مهام القياس/رفع السرعة/الإيقاف اللى طلبها المستخدم فى الطابور،
// وبتحدّثه كل ~3ث. المهمة بتتضاف تلقائياً عند نجاح enqueueJob (حدث sf-exec-track).
type TrackedJob = {
  id: number;
  type: ExecJobType;
  count: number;
  position: number | null;
  total: number | null;
  status: string;
  done: boolean;
};

const LABEL: Record<string, string> = { measure: "القياس", raise: "رفع السرعة", stop: "إيقاف PO" };

export function ExecQueueWatcher() {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const jobsRef = useRef<TrackedJob[]>([]);
  jobsRef.current = jobs;
  const busyRef = useRef(false);

  // استقبال طلب تتبّع جديد
  useEffect(() => {
    const onTrack = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: number; type: ExecJobType; count: number };
      if (!d?.id) return;
      setJobs((prev) =>
        prev.some((j) => j.id === d.id)
          ? prev
          : [...prev, { id: d.id, type: d.type, count: d.count || 1, position: null, total: null, status: "pending", done: false }],
      );
    };
    window.addEventListener("sf-exec-track", onTrack as any);
    return () => window.removeEventListener("sf-exec-track", onTrack as any);
  }, []);

  // استطلاع الترتيب دورياً
  useEffect(() => {
    const iv = setInterval(async () => {
      if (busyRef.current) return;
      const active = jobsRef.current.filter((j) => !j.done);
      if (!active.length) return;
      busyRef.current = true;
      try {
        for (const j of active) {
          const p = await fetchQueuePosition(j.id);
          setJobs((prev) =>
            prev.map((x) => {
              if (x.id !== j.id) return x;
              if (!p.found || p.status === "done") {
                if (!x.done) setTimeout(() => setJobs((q) => q.filter((y) => y.id !== j.id)), 5000);
                return { ...x, done: true, status: "done" };
              }
              return { ...x, position: p.position ?? x.position, total: p.total ?? x.total, status: p.status || x.status };
            }),
          );
        }
      } finally {
        busyRef.current = false;
      }
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  const dismiss = (id: number) => setJobs((prev) => prev.filter((j) => j.id !== id));
  if (!jobs.length) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-2 max-w-[300px]" dir="rtl">
      {jobs.map((j) => (
        <div
          key={j.id}
          className="rounded-lg border bg-white dark:bg-gray-900 shadow-lg px-3 py-2 text-sm flex items-center gap-2"
        >
          {j.done ? (
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium">
              {LABEL[j.type] || j.type}
              {j.count > 1 ? ` (${j.count} رقم)` : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {j.done
                ? "✅ تم التنفيذ"
                : j.position == null
                  ? "جارٍ تحديد الترتيب…"
                  : j.position === 1
                    ? "قيد التنفيذ الآن…"
                    : `ترتيبك فى الطابور: ${j.position}${j.total ? " من " + j.total : ""}`}
            </div>
          </div>
          <button
            onClick={() => dismiss(j.id)}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="إخفاء"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

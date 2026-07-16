import { useEffect, useRef, useState } from "react";
import { fetchQueuePosition, type ExecJobType } from "@/lib/exec-queue";
import { Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";

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
  canceled: boolean;        // اتلغت لأن جهاز التنفيذ اتقفل
  result: string | null;    // نتيجة القياس: done | tab_closed | timeout
  jobDone: number | null;   // كام رقم اتنفّذ من مهمتى
  jobTotal: number | null;  // إجمالى أرقام مهمتى
  active: { type: ExecJobType; done: number; total: number } | null; // تقدّم المهمة الجارية دلوقتى
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
          : [...prev, { id: d.id, type: d.type, count: d.count || 1, position: null, total: null, status: "pending", done: false, canceled: false, result: null, jobDone: null, jobTotal: d.count || 1, active: null }],
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
              const canceled = p.canceled === true || p.status === "stale";
              if (!p.found || p.status === "done" || canceled) {
                if (!x.done) setTimeout(() => setJobs((q) => q.filter((y) => y.id !== j.id)), canceled ? 8000 : 6000);
                return { ...x, done: true, canceled, result: p.result ?? x.result, jobDone: p.jobDone ?? x.jobDone, jobTotal: p.jobTotal ?? x.jobTotal, status: p.status || "done" };
              }
              return {
                ...x,
                position: p.position ?? x.position,
                total: p.total ?? x.total,
                status: p.status || x.status,
                jobDone: p.jobDone ?? x.jobDone,
                jobTotal: p.jobTotal ?? x.jobTotal,
                active: p.active ?? null,
              };
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
          {(() => {
            const warn = j.canceled || j.result === "tab_closed" || j.result === "timeout" || j.result === "preempted";
            if (!j.done) return <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />;
            return warn
              ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              : <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />;
          })()}
          <div className="flex-1 min-w-0">
            <div className="font-medium">
              {LABEL[j.type] || j.type}
              {j.count > 1 ? ` (${j.count} رقم)` : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {j.done
                ? j.canceled
                  ? "⚠️ أُلغِيت — جهاز التنفيذ مقفول"
                  : j.result === "preempted"
                    ? `⏸ اتوقف مؤقتاً لطلب عاجل — الباقى هيتكمّل${(j.jobTotal ?? 1) > 1 ? ` (تم ${j.jobDone ?? 0} من ${j.jobTotal})` : ""}`
                    : j.result === "tab_closed"
                    ? `⚠️ اتقفل قبل ما يخلص${(j.jobTotal ?? 1) > 1 ? ` — تم ${j.jobDone ?? 0} من ${j.jobTotal}` : ""}`
                    : j.result === "timeout"
                      ? `⚠️ علّق قبل ما يخلص${(j.jobTotal ?? 1) > 1 ? ` — تم ${j.jobDone ?? 0} من ${j.jobTotal}` : ""}`
                      : `✅ تم${(j.jobTotal ?? 1) > 1 ? ` — ${j.jobDone ?? j.jobTotal} من ${j.jobTotal}` : " التنفيذ"}`
                : j.position == null
                  ? "جارٍ تحديد الترتيب…"
                  : j.position === 1
                    ? // مهمتى بتتنفّذ دلوقتى — لو أكثر من خط أعرض وصل لرقم كام
                      (j.jobTotal ?? 1) > 1
                      ? `قيد التنفيذ: تم ${j.jobDone ?? 0} من ${j.jobTotal}`
                      : "قيد التنفيذ الآن…"
                    : `ترتيبك فى الطابور: ${j.position}${j.total ? " من " + j.total : ""}`}
            </div>
            {/* لو أنا منتظر والمهمة الجارية دلوقتى فيها أكثر من خط — أعرض وصلت لفين */}
            {!j.done && (j.position ?? 0) > 1 && j.active && j.active.total > 1 && (
              <div className="text-[11px] text-blue-600 dark:text-blue-400">
                الجارى تنفيذها الآن ({LABEL[j.active.type] || j.active.type}): {j.active.done} من {j.active.total}
              </div>
            )}
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

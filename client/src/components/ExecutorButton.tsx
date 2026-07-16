import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Server, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { executeBatch, latestMeasureAt, latestPoEventAt, sleep, type ExecJob } from "@/lib/exec-queue";

// زر «جهاز التنفيذ» — للسوبر أدمن فقط. لما يتفعّل، البراوزر ده يبقى هو المنفّذ:
// يبعت نبضة كل 20ث، ويسحب المهام من الطابور كل 4ث وينفّذها (رفع سرعة/قياس/إيقاف).
// أى جهاز تانى يعمل رفع سرعة/قياس/إيقاف بيروح للطابور فينفّذه الجهاز ده.
export function ExecutorButton() {
  const { user } = useAuth();
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem("sf_exec_active") === "1"; } catch { return false; }
  });
  const [pending, setPending] = useState(0);
  const [current, setCurrent] = useState<string>("");
  const busy = useRef(false);
  const [clearing, setClearing] = useState(false);
  // تاب القياس الأخير — نقفله أول ما نفتح قياس جديد (يفضل تاب واحد بس مفتوح: الأخير)
  const lastMeasureWin = useRef<Window | null>(null);

  // استطلاع دائم لعدد المهام فى الطابور (للسوبر أدمن) — حتى لو الجهاز مش مفعّل — عشان يظهر زر المسح
  useEffect(() => {
    if (user?.role !== ROLES.SUPER_ADMIN) return;
    const load = () => fetch("/api/exec-queue/pending", { credentials: "include" })
      .then((r) => r.json()).then((d) => setPending(d?.pending ?? 0)).catch(() => {});
    load();
    const iv = setInterval(load, 10 * 1000);
    return () => clearInterval(iv);
  }, [user?.role]);

  // مسح الطابور يدوياً (يعلّم كل المهام النشطة stale)
  const clearQueue = async () => {
    if (!window.confirm("مسح كل المهام العالقة فى الطابور؟ (المهام غير المنفّذة هتتلغى)")) return;
    setClearing(true);
    try {
      const r = await fetch("/api/exec-queue/clear", { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      setPending(0);
      alert(d?.ok ? `تم مسح ${d.cleared ?? 0} مهمة من الطابور` : "تعذّر مسح الطابور");
    } catch { alert("تعذّر مسح الطابور"); } finally { setClearing(false); }
  };

  const toggle = () => {
    setActive((v) => {
      const nv = !v;
      try { localStorage.setItem("sf_exec_active", nv ? "1" : "0"); } catch {}
      // لما نقفل: امسح النبضة فوراً على السيرفر عشان /status يرجّع غير-مفعّل حالاً
      // (بدون ده تفضل النبضة الأخيرة «طازجة» لـ 45ث فتتضاف مهام لطابور مفيش حد بينفّذه).
      if (!nv) fetch("/api/exec-queue/offline", { method: "POST", credentials: "include" }).catch(() => {});
      return nv;
    });
  };

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    // عند تفعيل جهاز التنفيذ: أى مهمة «claimed» من جلسة سابقة اتقفل عليها الجهاز = يتيمة → علّمها stale
    // عشان متفضلش عالقة فى الطابور وتضخّم ترتيب المستخدمين. (بنعملها مرة عند بدء التفعيل قبل السحب.)
    fetch("/api/exec-queue/reset-orphaned", { method: "POST", credentials: "include" }).catch(() => {});

    const heartbeat = () => { fetch("/api/exec-queue/heartbeat", { method: "POST", credentials: "include" }).catch(() => {}); };

    // مهلة كل خط (بالمللى): قياس بحد أقصى ١.٨د، رفع سرعة بحد أقصى ٨د (لكن يعدّى أول ما يتأكد)، إيقاف ٣٠ث
    const MEASURE_MAX_MS = 1.8 * 60 * 1000, RAISE_MAX_MS = 8 * 60 * 1000, STOP_MS = 30 * 1000;

    const MAX_TOTAL_MS = 4 * 60 * 60 * 1000; // سقف إجمالى معقول للباتش الواحد (٤ ساعات)

    // ينفّذ **الجوب كله دفعة واحدة**: نبعت كل الأرقام للسكربت اللى بيلفّ عليها بنفسه (6/185…)
    // بدل ما نفتح صفحة لكل رقم. ننتظر لحد ما آخر رقم (السكربت بيمشى بالترتيب) يتأكد، أو سقف زمنى.
    // بترجّع نتيجة التنفيذ: "done" خلص فعلاً | "tab_closed" التاب اتقفل قبل ما يخلص |
    // "timeout" خلصت المهلة | "stopped" جهاز التنفيذ اتقفل يدوياً.
    const runBatch = async (type: ExecJob["type"], accs: string[]): Promise<string> => {
      const last = accs[accs.length - 1];
      if (type === "measure") {
        const before = await latestMeasureAt(last);
        try { if (lastMeasureWin.current && !lastMeasureWin.current.closed) lastMeasureWin.current.close(); } catch {}
        const win = executeBatch("measure", accs); // DZS يلفّ على كلهم فى run واحد
        lastMeasureWin.current = win;
        const closeWin = () => { try { if (win && !win.closed) win.close(); } catch {} };
        const deadline = Date.now() + Math.min(accs.length * MEASURE_MAX_MS, MAX_TOTAL_MS);
        while (!stopped && Date.now() < deadline) {
          await sleep(15 * 1000);
          // خلص: آخر رقم اتقاس (DZS بيمشى بالترتيب فآخر رقم اتقاس = عدّى على الكل) → نقفل التاب
          if ((await latestMeasureAt(last)) > before) { closeWin(); return "done"; }
          // التاب اتقفل (يدوياً/كراش) قبل ما آخر رقم يتقاس → اتقفل قبل ما يخلص
          if (win && win.closed) return "tab_closed";
        }
        closeWin();
        return stopped ? "stopped" : "timeout";
      }
      const ev = type === "stop" ? "stop" : "raise";
      const perMax = type === "stop" ? STOP_MS : RAISE_MAX_MS;
      const before = await latestPoEventAt(last, ev);
      executeBatch(type, accs); // PO يلفّ على كل الأرقام فى run واحد
      const deadline = Date.now() + Math.min(accs.length * perMax, MAX_TOTAL_MS);
      while (!stopped && Date.now() < deadline) {
        await sleep(15 * 1000);
        if ((await latestPoEventAt(last, ev)) > before) return "done"; // آخر رقم اتسجّل → الباتش خلص
      }
      return stopped ? "stopped" : "timeout";
    };

    const claimAndRun = async () => {
      if (busy.current || stopped) return;
      busy.current = true;
      try {
        const r = await fetch("/api/exec-queue/claim", { method: "POST", credentials: "include" });
        const job: ExecJob | null = r.ok ? await r.json() : null;
        if (job && job.id) {
          const accs = (job.accounts || []).map((a) => String(a).trim()).filter(Boolean);
          let result: string | null = null;
          if (accs.length && !stopped) {
            const label = job.type === "measure" ? "قياس" : job.type === "stop" ? "إيقاف" : "رفع سرعة";
            setCurrent(`${label} (${accs.length} رقم)`);
            result = await runBatch(job.type, accs); // الجوب كله دفعة واحدة
          }
          // نبعت نتيجة التنفيذ مع علامة الانتهاء عشان اللوحة تعرف: خلص ولا اتقفل قبل ما يخلص
          await fetch(`/api/exec-queue/${job.id}/done`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ result }),
          }).catch(() => {});
          setCurrent("");
        }
      } catch {} finally { busy.current = false; }
    };

    const refreshPending = () => {
      fetch("/api/exec-queue/pending", { credentials: "include" })
        .then((r) => r.json()).then((d) => setPending(d?.pending ?? 0)).catch(() => {});
    };

    heartbeat(); refreshPending();
    const hb = setInterval(heartbeat, 20 * 1000);
    const poll = setInterval(() => { claimAndRun(); refreshPending(); }, 4 * 1000);
    return () => {
      stopped = true; clearInterval(hb); clearInterval(poll);
      // امسح النبضة عند إيقاف التفعيل/مغادرة الصفحة عشان مايفضلش «مفعّل» بالغلط
      fetch("/api/exec-queue/offline", { method: "POST", credentials: "include" }).catch(() => {});
    };
  }, [active]);

  if (user?.role !== ROLES.SUPER_ADMIN) return null;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={active ? "default" : "outline"}
        size="sm"
        onClick={toggle}
        className={active ? "bg-indigo-600 hover:bg-indigo-700 gap-1" : "text-indigo-700 border-indigo-200 gap-1"}
        title="جهاز التنفيذ المركزى: لما يتفعّل، رفع السرعة/القياس/الإيقاف من أى جهاز بيتنفّذ هنا عبر طابور"
      >
        {active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
        {active
          ? (current ? `⏳ ${current}` : `جهاز التنفيذ: مُفعَّل${pending ? ` (${pending})` : ""}`)
          : "جهاز التنفيذ"}
      </Button>
      {/* زر مسح الطابور — يظهر للسوبر أدمن لما يكون فيه مهام عالقة */}
      {pending > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={clearQueue}
          disabled={clearing}
          className="text-red-700 border-red-200 gap-1"
          title="مسح كل المهام العالقة فى الطابور (المهام غير المنفّذة هتتلغى)"
        >
          {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          مسح الطابور ({pending})
        </Button>
      )}
    </div>
  );
}

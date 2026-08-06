import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Server, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { executeBatch, latestOpAt, latestPoEventAt, latestSubInfoAt, sleep, PHONE_LOOKUP_SOURCE, QUEUE_LABEL, type ExecJob, type ExecJobType } from "@/lib/exec-queue";

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
    const MEASURE_MAX_MS = 2.5 * 60 * 1000, RAISE_MAX_MS = 8 * 60 * 1000, STOP_MS = 30 * 1000;
    // المراجعة بتحتاج دخول FCC + بحث + قراءة البيانات — 3 دقايق سقف كريم للرقم الواحد
    const SUBINFO_MAX_MS = 3 * 60 * 1000;

    // سقف زمنى لكل عملية «تفتح موقع خارجى». وجود النوع هنا معناه إنه بيتنفّذ بالمسار العام
    // (فتح التاب ← انتظار الإشارة أو قفل التاب). غيّر البورت أطول لأن الـ Submit بيدوى.
    const OP_MAX_MS: Partial<Record<ExecJobType, number>> = {
      c360: 20 * 60 * 1000,        // بيلفّ على كل الأرقام جوّه نفس التاب (+ بازل تسجيل الدخول)
      portchange: 15 * 60 * 1000,  // المستخدم بيراجع ويضغط Submit بنفسه
      portcheck: 5 * 60 * 1000,
      ports: 30 * 60 * 1000,       // رفعة ملف البورتات كامل
      wfmcancel: 6 * 60 * 1000,
      wfmreport: 20 * 60 * 1000,
      fccdaily: 20 * 60 * 1000,
      wfmdaily: 20 * 60 * 1000,
      ossdaily: 20 * 60 * 1000,
      weoas: 30 * 60 * 1000,
    };

    const MAX_TOTAL_MS = 4 * 60 * 60 * 1000; // سقف إجمالى معقول للباتش الواحد (٤ ساعات)

    // ينفّذ **الجوب كله دفعة واحدة**: نبعت كل الأرقام للسكربت اللى بيلفّ عليها بنفسه (6/185…)
    // بدل ما نفتح صفحة لكل رقم. ننتظر لحد ما آخر رقم (السكربت بيمشى بالترتيب) يتأكد، أو سقف زمنى.
    // فحص المهمة الجارية: لسه شغّالة؟ فيه طلب عاجل يقطعها؟ اتقاس كام رقم؟
    const jobCheck = async (jobId: number): Promise<{ active: boolean; preempt: boolean; measured: number; total: number }> => {
      try {
        const r = await fetch(`/api/exec-queue/job-check?jobId=${jobId}`, { credentials: "include" });
        return await r.json();
      } catch { return { active: true, preempt: false, measured: 0, total: 0 }; }
    };

    // لو مفيش تقدّم فى القياس لمدة STALL_MS (DZS وقف على خط فيه إيرور مثلاً) نوقف بدل ما نعلّق ساعات.
    // أطول من أقصى وقت لخط واحد (١.٨د) بهامش، فمابنوقفش خط شغّال بطىء بالغلط.
    const STALL_MS = 2.5 * 60 * 1000;

    // بترجّع نتيجة التنفيذ: "done" خلص فعلاً | "tab_closed" التاب اتقفل قبل ما يخلص |
    // "timeout" علّق/وقف بدون تقدّم | "stopped" جهاز التنفيذ اتقفل | "canceled" اتمسح من الطابور يدوياً |
    // "preempted" اتقطع لصالح طلب عاجل.
    const runBatch = async (type: ExecJob["type"], accs: string[], jobId: number, note?: string | null, params?: any): Promise<string> => {
      const last = accs[accs.length - 1];
      const canPreempt = accs.length > 3; // الباتش الكبير بس هو اللى يتقطع
      // العمليات اللى بتفتح موقع خارجى وتخلص لوحدها (جلب أكونت/تغيير أو تحديث بورت/إلغاء إسناد/
      // تحديث ملفات يومية). الإشارة الأساسية إن التاب اتقفل (السكربت بيقفله لما يخلص، أو
      // المستخدم بيقفله لما يخلّص يدوى)، وأثر العملية فى قاعدة البيانات إشارة إضافية بتخلّينا
      // نعدّى أسرع من غير انتظار قفل التاب. الاتنين بيحرّروا مسار الدومين للمهمة اللى بعده.
      if (OP_MAX_MS[type] != null) {
        const key = type === "c360" ? accs.join(",") : accs[0];
        // الأنواع اللى على مستوى الموقع كله (ports) مفتاحها صورى — op-check بيتجاهله
        const sigKey = accs[0] === "-" ? "" : (type === "c360" ? accs[0] : key);
        const before = await latestOpAt(type, sigKey);
        const win = executeBatch(type, accs, { params });
        const closeWin = () => { try { if (win && !win.closed) win.close(); } catch {} };
        const deadline = Date.now() + OP_MAX_MS[type]!;
        // مهلة قصيرة قبل فحص «التاب اتقفل» — window.open ساعات بترجّع تاب لسه بيفتح
        await sleep(5 * 1000);
        while (!stopped && Date.now() < deadline) {
          const chk = await jobCheck(jobId);
          if (!chk.active) { closeWin(); return "canceled"; }
          if (before >= 0 && (await latestOpAt(type, sigKey)) > before) { closeWin(); return "done"; }
          if (win && win.closed) return "done"; // التاب اتقفل = العملية خلصت (يدوى أو بالسكربت)
          // مهمة أعلى أولوية مستنية على **نفس الدومين** (تحديث ملفات) → اقفل التاب وسيب المسار
          if (chk.preempt) { closeWin(); return "preempted"; }
          await sleep(5 * 1000);
        }
        closeWin();
        return stopped ? "stopped" : "timeout";
      }
      // مراجعة الاسم والعنوان من FCC — رقم واحد لكل مهمة (سكربت FCC بياخد الرقم من اسم النافذة).
      // بنستنى fetched_at يتحدّث فى line_subscriber_info كدليل إن المراجعة خلصت فعلاً.
      if (type === "subinfo") {
        const phone = accs[0];
        const before = await latestSubInfoAt(phone);
        const win = executeBatch("subinfo", accs);
        const closeWin = () => { try { if (win && !win.closed) win.close(); } catch {} };
        const deadline = Date.now() + SUBINFO_MAX_MS;
        while (!stopped && Date.now() < deadline) {
          await sleep(5 * 1000);
          const chk = await jobCheck(jobId);
          if (!chk.active) { closeWin(); return "canceled"; }
          if ((await latestSubInfoAt(phone)) > before) { closeWin(); return "done"; }
          if (win && win.closed) return "tab_closed";
          // تحديث ملفات FCC مستنى على نفس الدومين → اقفل صفحة المراجعة دلوقتى، والمراجعة
          // بترجع للطابور بنفس أولويتها فتكمّل أول ما التحديث يخلص.
          if (chk.preempt) { closeWin(); return "preempted"; }
        }
        closeWin();
        return stopped ? "stopped" : "timeout";
      }
      if (type === "measure") {
        try { if (lastMeasureWin.current && !lastMeasureWin.current.closed) lastMeasureWin.current.close(); } catch {}
        // القياس الجاى من «بحث برقم التليفون» يختار «A recent fix (past 24h)» فى شاشة DZS
        const fixRecent = String(note || "").includes(PHONE_LOOKUP_SOURCE);
        const win = executeBatch("measure", accs, { fixRecent }); // DZS يلفّ على كلهم فى run واحد
        lastMeasureWin.current = win;
        const closeWin = () => { try { if (win && !win.closed) win.close(); } catch {} };
        const deadline = Date.now() + Math.min(accs.length * MEASURE_MAX_MS, MAX_TOTAL_MS);
        let lastMeasured = 0, lastProgAt = Date.now();
        while (!stopped && Date.now() < deadline) {
          await sleep(5 * 1000);
          const chk = await jobCheck(jobId);
          if (!chk.active) { closeWin(); return "canceled"; } // اتمسح من الطابور يدوياً → وقف فوراً
          if (chk.measured > lastMeasured) { lastMeasured = chk.measured; lastProgAt = Date.now(); }
          if (chk.total > 0 && chk.measured >= chk.total) { closeWin(); return "done"; } // كل الأرقام اتقاست
          if (win && win.closed) return "tab_closed"; // التاب اتقفل قبل ما يخلص
          if (canPreempt && chk.preempt) { closeWin(); return "preempted"; } // طلب عاجل يقطع
          if (Date.now() - lastProgAt > STALL_MS) { closeWin(); return "timeout"; } // مافيش تقدّم = وقف
        }
        closeWin();
        return stopped ? "stopped" : "timeout";
      }
      // رفع السرعة المعلّم «+إيقاف» = رفع ثم إيقاف الـ nightly فى **نفس تشغيلة PO** (afterStop):
      // مهمة واحدة بدل مهمتين، ومنستنى حدث الإيقاف (آخر خطوة) قبل ما نعتبرها خلصت عشان مايبقاش تداخل.
      const raiseWithStop = type === "raise" && String(note || "").includes("+إيقاف");
      const ev: "raise" | "stop" = (type === "stop" || raiseWithStop) ? "stop" : "raise";
      const perMax = type === "stop" ? STOP_MS : (raiseWithStop ? RAISE_MAX_MS + STOP_MS : RAISE_MAX_MS);
      const before = await latestPoEventAt(last, ev);
      executeBatch(type, accs, raiseWithStop ? { afterStop: true } : undefined); // PO يلفّ على كل الأرقام فى run واحد
      const deadline = Date.now() + Math.min(accs.length * perMax, MAX_TOTAL_MS);
      while (!stopped && Date.now() < deadline) {
        await sleep(5 * 1000);
        const chk = await jobCheck(jobId);
        if (!chk.active) return "canceled"; // اتمسح من الطابور يدوياً → وقف فوراً
        if ((await latestPoEventAt(last, ev)) > before) return "done"; // آخر رقم اتسجّل → الباتش خلص
      }
      return stopped ? "stopped" : "timeout";
    };

    // الطابور بيشتغل بمسارات: مهمة واحدة لكل **موقع** فى نفس الوقت، ومواقع مختلفة بالتوازى
    // (السيرفر هو اللى بيضمن ده فى claim). هنا بنمنع بس إن أكتر من طلب claim يتبعت مع بعض،
    // وبعدها بنشغّل المهمة **من غير انتظار** عشان مسار تانى يقدر يبدأ.
    const running = new Map<string, string>();   // site → وصف المهمة الجارية
    const showRunning = () => setCurrent(Array.from(running.values()).join(" • "));

    // عدد المواقع المختلفة — سقف عدد المهام اللى ممكن تشتغل مع بعض (مسار لكل موقع).
    const MAX_LANES = 8;

    const claimAndRun = async () => {
      if (busy.current || stopped) return;
      busy.current = true;
      try {
        // بنفضل نسحب لحد ما السيرفر يقول «مفيش مهمة مؤهّلة» — كده كل المسارات
        // الفاضية بتشتغل فى نفس اللحظة بدل ما كل مسار يستنى دورة سحب (4 ثوانى).
        // السيرفر بيضمن مهمة واحدة بس لكل موقع، فالحلقة دى بتقف لوحدها.
        for (let lane = 0; lane < MAX_LANES && !stopped; lane++) {
        const r = await fetch("/api/exec-queue/claim", { method: "POST", credentials: "include" });
        const job: ExecJob | null = r.ok ? await r.json() : null;
        if (!job || !job.id) break;
        if (job && job.id) {
          const accs = (job.accounts || []).map((a) => String(a).trim()).filter(Boolean);
          const site = String((job as any).site || "10.42.187.101");
          const label = QUEUE_LABEL[job.type] || job.type;
          running.set(site, `${label} (${accs.length} رقم)`);
          showRunning();
          // بدون await — مسار الموقع ده بيشتغل لوحده، وحلقة السحب تقدر تجيب مهمة لموقع تانى
          void (async () => {
            let result: string | null = null;
            try {
              if (accs.length && !stopped) result = await runBatch(job.type, accs, job.id, job.note, job.params);
              if (result === "preempted") {
                // اتقطع لصالح طلب عاجل → السيرفر يعلّمها done ويرجّع الباقى كمهمة تكملة أولويتها 0
                await fetch(`/api/exec-queue/${job.id}/preempt`, { method: "POST", credentials: "include" }).catch(() => {});
              } else if (result === "canceled") {
                // اتمسحت من الطابور يدوياً (بقت stale أصلاً) → مانعملش حاجة
              } else {
                // نبعت نتيجة التنفيذ مع علامة الانتهاء عشان اللوحة تعرف: خلص ولا اتقفل قبل ما يخلص
                await fetch(`/api/exec-queue/${job.id}/done`, {
                  method: "POST", credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ result }),
                }).catch(() => {});
              }
            } catch {} finally {
              running.delete(site);
              showRunning();
            }
          })();
        }
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

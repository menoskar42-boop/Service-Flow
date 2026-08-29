import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Server, Loader2, Trash2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { execDeviceLabel, executeBatch, latestOpAt, latestPoEventAt, latestSubInfoAt, sleep, PHONE_LOOKUP_SOURCE, QUEUE_LABEL, type ExecJob, type ExecJobType } from "@/lib/exec-queue";

// ── إبقاء تاب جهاز التنفيذ صاحى ─────────────────────────────────────────────
// المشكلة اللى بتوقف الطابور: Edge/Chrome بيعملوا للتاب اللى فى الخلفية
//   (١) Timer throttling — الـ setInterval بيقلّ لمرة كل دقيقة بعد ٥ دقايق،
//   (٢) Sleeping tabs / Tab discarding — التاب بيتجمّد بالكامل بعد فترة خمول.
// النتيجة: النبضة بتقف فالسيرفر يقول «مفيش جهاز مفعّل»، وحلقة سحب المهام
// بتقف فالقياسات اللى فى الطابور تفضل مستنية لحد ما حد يعمل ريفريش يدوى.
//
// الحل: نخلّى التاب «بيشغّل صوت». التاب اللى بيشغّل صوت مستثنى من Sleeping
// tabs ومن الـ discarding ومن الـ throttling الشديد فى المتصفحين. الصوت
// نفسه سكوت تام (gain = 0) فمحدش بيسمع حاجة.
// AudioContext محتاج user gesture — واحنا بنشغّله من ضغطة زر «جهاز التنفيذ».
function startSilentKeepAlive(): () => void {
  let ctx: AudioContext | null = null;
  try {
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return () => {};
    ctx = new AC();
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    gain.gain.value = 0;                  // سكوت تام
    osc.connect(gain); gain.connect(ctx!.destination);
    osc.start();
    // بعض المتصفحات بتوقف الـ context لو اتفتح قبل الـ gesture — بنحاول نرجّعه
    const resume = () => { try { ctx && ctx.state === "suspended" && ctx.resume(); } catch {} };
    resume();
    document.addEventListener("visibilitychange", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      try { osc.stop(); } catch {}
      try { ctx && ctx.close(); } catch {}
    };
  } catch { return () => {}; }
}

// قفل الشاشة (لو المتصفح بيدعمه): بيمنع الجهاز من النوم طول ما التنفيذ مفعّل.
// بيتفكّ لوحده لما التاب يتخفى، فبنعيد طلبه عند الرجوع.
function startWakeLock(): () => void {
  const nav: any = navigator;
  if (!nav?.wakeLock?.request) return () => {};
  let lock: any = null;
  let killed = false;
  const acquire = async () => {
    if (killed || document.visibilityState !== "visible") return;
    try { lock = await nav.wakeLock.request("screen"); } catch {}
  };
  acquire();
  const onVis = () => { if (document.visibilityState === "visible") acquire(); };
  document.addEventListener("visibilitychange", onVis);
  return () => {
    killed = true;
    document.removeEventListener("visibilitychange", onVis);
    try { lock && lock.release(); } catch {}
  };
}

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
  // آخر خطأ فى سحب المهام — بيتعرض على الزر عشان التوقف مايبقاش صامت
  const [claimError, setClaimError] = useState<string | null>(null);
  // التاب فاق بعد تجميد/انقطاع — بيتعرض على الزر عشان التوقف مايبقاش صامت
  const [stale, setStale] = useState(false);
  const busy = useRef(false);
  const [clearing, setClearing] = useState(false);
  // تاب القياس الأخير — نقفله أول ما نفتح قياس جديد (يفضل تاب واحد بس مفتوح: الأخير)
  const lastMeasureWin = useRef<Window | null>(null);

  // استطلاع دائم لعدد المهام فى الطابور (للسوبر أدمن) — حتى لو الجهاز مش مفعّل — عشان يظهر زر المسح
  // + حالة جهاز التنفيذ: لو فيه مهام مستنية ومفيش جهاز شغّال، الطابور واقف فعلاً
  // ولازم ده يبان على طول من أى صفحة بدل ما يتكتشف بعد ساعات.
  const [execDown, setExecDown] = useState<{ lastSeenSec: number | null; who: string | null } | null>(null);
  const [autoReloading, setAutoReloading] = useState(false);
  const autoReloadBusy = useRef(false);

  // التاب المتجمّد لا يستطيع تنفيذ JavaScript أثناء التجميد نفسه، لذلك الصفحة
  // المفتوحة على جهاز آخر تراقب آخر نبضة وتطلب ريفرش صامتاً كل 5 ثوانٍ.
  // الطلب يظل محفوظاً على السيرفر، وأول ما تاب جهاز التنفيذ يفوق يقرأه وينفّذ
  // window.location.reload() من خلال النبضة التالية.
  const requestAutomaticReload = async () => {
    if (autoReloadBusy.current) return;
    autoReloadBusy.current = true;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch("/api/exec-queue/request-reload", {
        method: "POST",
        credentials: "include",
        signal: ctrl.signal,
      });
      if (r.ok) setAutoReloading(true);
    } catch {
      // المحاولة التالية بعد 5 ثوانٍ
    } finally {
      clearTimeout(timeout);
      autoReloadBusy.current = false;
    }
  };

  useEffect(() => {
    if (user?.role !== ROLES.SUPER_ADMIN) return;
    const load = async () => {
      try {
        const [p, st] = await Promise.all([
          fetch("/api/exec-queue/pending", { credentials: "include" }).then((r) => r.json()),
          fetch("/api/exec-queue/status", { credentials: "include" }).then((r) => r.json()),
        ]);
        setPending(p?.pending ?? 0);
        const lastSeenSec = typeof st?.lastSeenSec === "number" ? st.lastSeenSec : null;
        const knownExecutor = !!st?.lastExecutor;
        const heartbeatStalled = knownExecutor && lastSeenSec != null && lastSeenSec >= 45;
        setExecDown(st?.active ? null : { lastSeenSec, who: st?.lastExecutor ?? null });
        if (heartbeatStalled) {
          // لا ننتظر انتهاء نافذة active (150 ثانية)؛ نبدأ الريفريش
          // بعد فقدان أكثر من نبضتين، ثم نكرر المحاولة كل 5 ثوانٍ.
          void requestAutomaticReload();
        } else {
          setAutoReloading(false);
        }
      } catch {}
    };
    load();
    const iv = setInterval(load, 5 * 1000);
    return () => clearInterval(iv);
  }, [user?.role]);

  const agoText = (sec: number | null) =>
    sec == null ? "" : sec < 90 ? `${Math.round(sec)} ثانية`
    : sec < 3600 ? `${Math.round(sec / 60)} دقيقة` : `${Math.round(sec / 3600)} ساعة`;

  // طلب ريفريش لمتصفح **جهاز التنفيذ** من أى جهاز تانى (الموبايل مثلاً).
  // بيتنفّذ مع أول نبضة (~20 ثانية) — مش لازم أكون قاعد على الجهاز نفسه.
  const [reloading, setReloading] = useState(false);
  const requestReload = async () => {
    if (!confirm("عمل ريفريش لمتصفح جهاز التنفيذ؟\n(هيتنفّذ خلال حوالى 20 ثانية)")) return;
    setReloading(true);
    try {
      const r = await fetch("/api/exec-queue/request-reload", { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d?.message || "تعذّر إرسال الطلب"); return; }
      const ago = d?.lastSeenSec == null ? null
        : d.lastSeenSec < 90 ? `${Math.round(d.lastSeenSec)} ثانية`
        : d.lastSeenSec < 3600 ? `${Math.round(d.lastSeenSec / 60)} دقيقة`
        : `${Math.round(d.lastSeenSec / 3600)} ساعة`;
      alert(d?.active
        ? `تم إرسال طلب الريفريش لجهاز التنفيذ (${d.executor || "مفعّل"}) — هيتنفّذ خلال حوالى 20 ثانية.`
        : ago
          // مفيش نبضة حديثة لكن الجهاز معروف: غالباً التاب متجمّد (Sleeping tabs).
          // الطلب متسجّل — أول ما التاب يفوق (أو تفتحه بإيدك) هينفّذ الريفريش.
          ? `⚠️ آخر نبضة من جهاز التنفيذ (${d.executor || "?"}) من ${ago}.\nالتاب غالباً متجمّد فى المتصفح — الطلب اتسجّل وهينفّذ أول ما التاب يفوق.\nلو مستعجل: افتح تاب جهاز التنفيذ بإيدك.`
          : "⚠️ مفيش جهاز تنفيذ مفعّل دلوقتى — الطلب اتسجّل وهيتنفّذ أول ما جهاز يتفعّل.");
    } catch { alert("تعذّر إرسال الطلب"); } finally { setReloading(false); }
  };

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

    // بنبعت هوية الجهاز مع النبضة ومع كل سحب — عشان يتسجّل على المهمة نفسها
    // وتعرف الرقابة الطلب اتنفّذ من أى جهاز/متصفح.
    const device = execDeviceLabel();
    // رمز إعادة التحميل الجاى مع النبضة: أول قراءة بنسجّلها وبس، وأى **تغيير** بعدها
    // معناه إن سوبر أدمن طلب ريفريش لجهاز التنفيذ (من الموبايل مثلاً) → بنعمل reload.
    // بيتنفّذ خلال أقل من نبضة (~20 ثانية) ومن غير أى اتصال إضافى.
    // ⚠️ undefined = «لسه ماقريناش أى رمز»، null = «قرينا ومفيش طلب».
    // لازم نفرّق بينهم: لو استخدمنا null للاتنين، الجهاز اللى اتفعّل **قبل** أى طلب
    // ريفريش هيسجّل أول رمز حقيقى على إنه «القراءة الأولى» ويبلع الطلب من غير ما ينفّذه.
    let lastReloadToken: string | null | undefined = undefined;
    // آخر نبضة **نجحت** فعلاً — أساس الحارس اللى بيكتشف إن التاب كان متجمّد
    let lastBeatOk = Date.now();
    const heartbeat = () => {
      fetch("/api/exec-queue/heartbeat", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j) { lastBeatOk = Date.now(); setStale(false); }
          const tok = j && j.reload ? String(j.reload) : null;
          if (lastReloadToken === undefined) { lastReloadToken = tok; return; }  // أول قراءة
          if (tok && tok !== lastReloadToken) {
            lastReloadToken = tok;
            try { window.location.reload(); } catch (e) {}
          }
        })
        .catch(() => {});
    };

    // ── الحارس ─────────────────────────────────────────────────────────────
    // بيقيس **الوقت الحقيقى** اللى عدّى من غير نبضة ناجحة، مش عدد مرات الـ tick
    // (الـ tick نفسه بيتأخّر لما المتصفح يخنق التاب). لو التاب كان متجمّد
    // أو النت قطع، أول ما يفوق بيلاقى فجوة كبيرة فيتصرّف على طول:
    //   • فجوة > دقيقتين  → نبضة فورية + محاولة سحب فورية (استئناف الطابور)
    //   • فجوة > ١٠ دقايق → ريفريش تلقائى للصفحة (بداية نظيفة زى الريفريش اليدوى
    //     اللى المستخدم بيعمله بإيده) — من غيره التاب بيفوق بحالة داخلية بايظة.
    const WAKE_MS = 2 * 60 * 1000, HARD_RELOAD_MS = 10 * 60 * 1000;
    const watchdog = () => {
      const gap = Date.now() - lastBeatOk;
      if (gap < WAKE_MS) return;
      setStale(true);
      if (gap > HARD_RELOAD_MS) { try { window.location.reload(); } catch {} return; }
      busy.current = false;           // فكّ أى قفل سحب اتعلّق وقت التجميد
      heartbeat(); claimAndRun(); refreshPending();
    };
    // أى إشارة إن التاب رجع للحياة → افحص على طول من غير ما تستنى الـ tick
    const onWake = () => { if (document.visibilityState === "visible" || navigator.onLine) watchdog(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("resume", onWake as any);   // Page Lifecycle: التاب فكّ التجميد

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
      // بنمسك النافذة: سكربت PO بيقول «خلص كل الأرقام. تقدر تقفل التاب» ومابيقفلش نفسه،
      // فمن غير المرجع ده كان التاب يفضل مفتوح للأبد والمهمة «جارية» لحد المهلة الكاملة.
      const win = executeBatch(type, accs, raiseWithStop ? { afterStop: true } : undefined); // PO يلفّ على كل الأرقام فى run واحد
      const closeWin = () => { try { if (win && !win.closed) win.close(); } catch {} };
      const deadline = Date.now() + Math.min(accs.length * perMax, MAX_TOTAL_MS);
      // ⚠️ كشف التوقّف: من غيره كان الباتش الكبير (261 رقم مثلاً) اللى بيقف فى نصّه
      // يفضل «جارٍ التنفيذ» لحد المهلة الكلية (لحد 4 ساعات) — الشاشة واقفة على
      // «27 من 261» ومحدش يعرف إنها ماتت، والحل الوحيد إعادة تشغيل يدوى.
      // المهلة هنا **مش** STALL_MS بتاع القياس (2.5 دقيقة): تشغيلة PO للخط الواحد
      // بتاخد دقايق فعلاً (خطوة «First Realtime Data Collection» لوحدها اتقاست
      // 214 ثانية)، فلو قطعناها عند 2.5 دقيقة هنقطع خط لسه شغّال. القاعدة: الخط
      // لازم يخلّص (نجاح أو فشل) قبل ما نعدّيه — فبنستنى مهلة الخط الكاملة
      // (perMax) + دقيقتين هامش، وأى تقدّم بيصفّر العدّاد من أول وجديد.
      const poStallMs = perMax + 2 * 60 * 1000;
      let lastDone = 0, lastProgAt = Date.now();
      // مهلة صغيرة قبل فحص «التاب اتقفل» — window.open ساعات بترجّع تاب لسه بيفتح
      await sleep(5 * 1000);
      while (!stopped && Date.now() < deadline) {
        const chk = await jobCheck(jobId);
        if (!chk.active) { closeWin(); return "canceled"; } // اتمسح من الطابور يدوياً → وقف فوراً
        if (chk.measured > lastDone) { lastDone = chk.measured; lastProgAt = Date.now(); }
        if ((await latestPoEventAt(last, ev)) > before) { closeWin(); return "done"; } // آخر رقم اتسجّل → الباتش خلص
        if (chk.total > 0 && chk.measured >= chk.total) { closeWin(); return "done"; } // كل الأرقام اتسجّلت
        // التاب اتقفل (السكربت خلّص والمستخدم قفله، أو قفل نفسه) — مانستناش المهلة كاملة.
        // ده اللى كان ناقص: الخط ممكن يكون فشل (Critical error) فمفيش أثر فى قاعدة
        // البيانات أبداً، وكنا نفضل مستنيين 8 دقايق على الفاضى قبل ما نعدّى للى بعده.
        if (win && win.closed) return "tab_closed";
        if (canPreempt && chk.preempt) { closeWin(); return "preempted"; } // طلب أعلى أولوية على نفس الدومين
        if (Date.now() - lastProgAt > poStallMs) { closeWin(); return "timeout"; } // مافيش تقدّم = وقف
        await sleep(5 * 1000);
      }
      closeWin();
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
        // مهلة 20ث: طلب سحب معلّق (بروكسى واقف/جهاز نايم) كان بيسيب busy مقفول
        // للأبد — الجهاز يفضل يبعت نبضات «مفعّل» من غير ما يسحب أى مهمة تانى.
        const ctrl = new AbortController();
        const tmo = setTimeout(() => ctrl.abort(), 20 * 1000);
        const r = await fetch("/api/exec-queue/claim", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device }),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(tmo));
        // ⚠️ لازم نفرّق بين «مفيش مهمة مؤهّلة» و«الطلب فشل»: الاتنين كانوا بيتقروا
        // نفس القراءة (break صامت)، فأى خطأ فى السحب كان بيوقّف التنفيذ تماماً من
        // غير أى مؤشر — الموقع شغّال والقياسات واقفة ومحدش يعرف ليه.
        if (!r.ok) {
          const why = await r.text().catch(() => "");
          console.error("[exec] فشل سحب المهمة:", r.status, why.slice(0, 200));
          setClaimError(`تعذّر سحب المهام من الطابور (خطأ ${r.status}) — التنفيذ متوقف`);
          break;
        }
        setClaimError(null);
        const job: ExecJob | null = await r.json();
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
              if (result === null && stopped) {
                // الجهاز اتقفل قبل ما المهمة تشتغل أصلاً — ماتتعلّمش done وهى
                // ماتنفّذتش (كانت بتظهر «تمّت» كذباً). نسيبها claimed وآلية
                // المهام اليتيمة بترجّعها للطابور لوحدها.
                return;
              }
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

    // الصوت الصامت + قفل الشاشة: بيمنعوا المتصفح من تجميد التاب أو خنق مؤقتاته
    const stopAudio = startSilentKeepAlive();
    const stopWake = startWakeLock();

    heartbeat(); refreshPending();
    const hb = setInterval(heartbeat, 20 * 1000);
    const poll = setInterval(() => { claimAndRun(); refreshPending(); }, 4 * 1000);
    const wd = setInterval(watchdog, 30 * 1000);
    return () => {
      stopped = true; clearInterval(hb); clearInterval(poll); clearInterval(wd);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("resume", onWake as any);
      stopAudio(); stopWake();
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
        className={
          active && claimError ? "bg-red-600 hover:bg-red-700 gap-1"
          : active && stale ? "bg-amber-600 hover:bg-amber-700 gap-1"
          : active ? "bg-indigo-600 hover:bg-indigo-700 gap-1"
          : "text-indigo-700 border-indigo-200 gap-1"}
        title={claimError || "جهاز التنفيذ المركزى: لما يتفعّل، رفع السرعة/القياس/الإيقاف من أى جهاز بيتنفّذ هنا عبر طابور"}
      >
        {active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
        {/* لو السحب فاشل الزر بيبقى أحمر ومكتوب عليه السبب — بدل ما التنفيذ يقف بصمت */}
        {active
          ? (claimError ? "⚠️ التنفيذ متوقف — خطأ فى الطابور"
             : stale ? "⚠️ التاب كان متجمّد — جارى الاستئناف"
             : current ? `⏳ ${current}`
             : `جهاز التنفيذ: مُفعَّل${pending ? ` (${pending})` : ""}`)
          : "جهاز التنفيذ"}
      </Button>
      {/* ريفريش لجهاز التنفيذ عن بُعد — بيشتغل من أى جهاز (الموبايل) مش لازم الجهاز نفسه */}
      <Button
        variant="outline"
        size="sm"
        onClick={requestReload}
        disabled={reloading}
        className="text-sky-700 border-sky-200 gap-1"
        title="عمل ريفريش لمتصفح جهاز التنفيذ من هنا — بيتنفّذ خلال حوالى 20 ثانية"
      >
        {reloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        ريفريش جهاز التنفيذ
      </Button>
      {/* الطابور فيه مهام ومفيش جهاز تنفيذ شغّال → تحذير ظاهر على أى صفحة.
          ده اللى بيمنع إن القياسات تفضل واقفة ساعات من غير ما حد ياخد باله. */}
       {autoReloading && (
         <span
           className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1"
           title="آخر نبضة من جهاز التنفيذ متوقفة — يتم إرسال طلب ريفرش تلقائي كل 5 ثوانٍ"
         >
           ↻ ريفرش تلقائي لجهاز التنفيذ
         </span>
       )}
       {pending > 0 && execDown && !active && (
        <span
          className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1"
          title={execDown.lastSeenSec == null
            ? "مفيش جهاز تنفيذ اتفعّل — شغّل «جهاز التنفيذ» على الجهاز المخصص"
            : `آخر نبضة من ${execDown.who || "جهاز التنفيذ"} من ${agoText(execDown.lastSeenSec)} — التاب غالباً متجمّد، افتحه أو اعمله ريفريش`}
        >
          ⚠️ الطابور واقف ({pending})
          {execDown.lastSeenSec != null && ` — آخر نبضة من ${agoText(execDown.lastSeenSec)}`}
        </span>
      )}
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

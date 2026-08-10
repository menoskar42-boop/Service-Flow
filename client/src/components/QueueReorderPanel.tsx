import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ChevronUp, ChevronDown, Save, ListOrdered, Ban, Pause, Play, RotateCcw, AlertTriangle } from "lucide-react";

// ترتيب باتشات «الأولوية المتأخرة» (>3 خطوط من غير تقرير محتاجة رفع سرعة) — للسوبر أدمن.
// الأولويات الأعلى (≤3 خطوط، ثم محتاجة رفع سرعة) بتتنفّذ قبلها دايماً ومش بتتأثر بالترتيب ده.
interface Batch {
  batchId: string;
  type: "measure" | "raise" | "stop" | string;
  requestedBy: string | null;
  note: string | null;
  total: number;
  done: number;
  paused: boolean;
  claimed: number;          // كام مهمة تحت التنفيذ دلوقتى
  claimedMins: number | null; // من كام دقيقة بدأ أقدم تنفيذ (null = مفيش شغّال)
  createdAt: string | null;
  queueOrder: number;
}

// الباتش يعتبر «عالق» لو فيه مهمة تحت التنفيذ عدّت مهلتها:
//   • القياس 5 دقايق — الخط الواحد بيخلص فى ~3 دقايق، فاللى بيعدّى 5 واقف.
//   • أى عملية تانية 20 دقيقة.
//   • استثناءات مهلتها الفعلية أطول من 20: تحديث الملفات 60، وc360/wfmreport 45.
// ⚠️ لازم تفضل مطابقة لـ maxRunSql فى expireOrphanedExecJobs (server/routes.ts)
// — السيرفر بيرجّع المهمة للطابور تلقائياً بنفس المهل دى، فلو اختلفوا الشارة
// هتقول «عالق» على حاجة لسه شغّالة أو العكس.
const DAILY_TYPES = new Set(["ports", "fccdaily", "wfmdaily", "ossdaily", "weoas"]);
const stuckMinsFor = (type: string) =>
  DAILY_TYPES.has(type) ? 60
  : type === "c360" || type === "wfmreport" ? 45
  : type === "measure" ? 5 : 20;
const isStuck = (b: Batch) => b.claimed > 0 && (b.claimedMins ?? 0) >= stuckMinsFor(b.type);
interface PriorityBatch extends Batch {
  priority: number;
}

const typeLabel = (t: string) => (t === "measure" ? "قياس" : t === "raise" ? "رفع سرعة" : t === "stop" ? "إيقاف PO" : t);
const fmt = (d: string | null) => {
  if (!d) return "-";
  try { const t = new Date(d); const p = (n: number) => String(n).padStart(2, "0"); return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`; }
  catch { return "-"; }
};
const priorityBadge = (p: number) =>
  p === 2
    ? <span className="text-xs px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-800">أولوية عاجلة (≤3 خطوط)</span>
    : <span className="text-xs px-2 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">محتاجة رفع سرعة</span>;

export function QueueReorderPanel() {
  const [rows, setRows] = useState<Batch[]>([]);
  const [priorityRows, setPriorityRows] = useState<PriorityBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null); // batchId اللى بيتلغى دلوقتى
  const [pausing, setPausing] = useState<string | null>(null); // batchId اللى بيتوقّف/يستأنف دلوقتى ("all" للكل)
  const [requeuing, setRequeuing] = useState<string | null>(null); // batchId اللى بيتعاد تشغيله
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // silent = تحديث فى الخلفية (التحديث التلقائى): مايوريّش سبينر ولا يمسح الشاشة،
  // عشان الجدول مايرفرفش كل 5 ثوانى.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [r, rp] = await Promise.all([
        fetch("/api/exec-queue/reorderable", { credentials: "include" }),
        fetch("/api/exec-queue/priority-preview", { credentials: "include" }),
      ]);
      const d = await r.json();
      const dp = await rp.json();
      setRows(Array.isArray(d.data) ? d.data : []);
      setPriorityRows(Array.isArray(dp.data) ? dp.data : []);
      setDirty(false);
      setLastRefresh(new Date());
    } catch { if (!silent) { setRows([]); setPriorityRows([]); } } finally { if (!silent) setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // التحديث التلقائى بيتخطّى نفسه لو فيه ترتيب لسه ماتحفظش (عشان مايضيعش) أو فيه
  // عملية شغالة (حفظ/إلغاء/إيقاف) — نحدّثها فى ref عشان الـ interval يقرا آخر قيمة
  // من غير ما نعيد إنشاؤه كل رندر.
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = dirty || saving || loading || !!canceling || !!pausing || !!requeuing;
  }, [dirty, saving, loading, canceling, pausing, requeuing]);

  // تحديث تلقائى كل 5 ثوانى — بيقف لو التاب مش ظاهر (مافيش داعى نضرب السيرفر فى الخلفية)
  useEffect(() => {
    const id = setInterval(() => {
      if (busyRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      load(true);
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/exec-queue/reorder", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchIds: rows.map((b) => b.batchId) }),
      });
      const d = await r.json();
      if (d?.ok) { setDirty(false); await load(); alert("تم حفظ الترتيب الجديد"); }
      else alert(d?.message || "تعذّر حفظ الترتيب");
    } catch { alert("تعذّر حفظ الترتيب"); } finally { setSaving(false); }
  };

  // إلغاء باتش كامل من الطابور (كل خطوطه اللى لسه فى pending/claimed)
  const cancelBatch = async (batchId: string, total: number) => {
    if (!confirm(`تأكيد إلغاء الباتش (${total} خط)؟ اللى اتنفّذ فعلاً مش هيتراجع.`)) return;
    setCanceling(batchId);
    try {
      const r = await fetch("/api/exec-queue/cancel", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const d = await r.json();
      if (r.ok && d?.ok) await load();
      else alert(d?.message || "تعذّر إلغاء الباتش");
    } catch { alert("تعذّر إلغاء الباتش"); } finally { setCanceling(null); }
  };

  // إيقاف مؤقت/استئناف باتش واحد — بيتخطّاه جهاز التنفيذ ويكمّل التالى فى الترتيب فوراً، وقابل للاستئناف.
  const togglePauseBatch = async (batchId: string, paused: boolean) => {
    setPausing(batchId);
    try {
      const r = await fetch(`/api/exec-queue/${paused ? "resume" : "pause"}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const d = await r.json();
      if (r.ok && d?.ok) await load();
      else alert(d?.message || "تعذّر تنفيذ الطلب");
    } catch { alert("تعذّر تنفيذ الطلب"); } finally { setPausing(null); }
  };

  // إعادة تشغيل باتش عالق: بيرجّع مهامه (العالقة والملغاة) للطابور من أول وجديد.
  // ده المخرج اليدوى لما الإنقاذ التلقائى يستنفد محاولاته والباتش يقف من غير رجعة.
  const requeueBatch = async (batchId: string, b: Batch) => {
    const msg = isStuck(b)
      ? `الباتش ده فيه ${b.claimed} مهمة تحت التنفيذ من ${b.claimedMins} دقيقة (يبدو إنها علقت).\nإعادة تشغيله هترجّعها للطابور من أول وجديد. تأكيد؟`
      : `إعادة تشغيل الباتش (${b.total} خط)؟ اللى اتنفّذ فعلاً مش هيتعاد.`;
    if (!confirm(msg)) return;
    setRequeuing(batchId);
    try {
      const r = await fetch("/api/exec-queue/requeue", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const d = await r.json();
      if (r.ok && d?.ok) { await load(); alert(`تم — رجّعنا ${d.requeued} مهمة للطابور`); }
      else alert(d?.message || "تعذّر إعادة التشغيل");
    } catch { alert("تعذّر إعادة التشغيل"); } finally { setRequeuing(null); }
  };

  // إيقاف مؤقت/استئناف لكل الباتشات دفعة واحدة
  const anyPaused = [...priorityRows, ...rows].some((b) => b.paused);
  const togglePauseAll = async () => {
    setPausing("all");
    try {
      const r = await fetch(`/api/exec-queue/${anyPaused ? "resume-all" : "pause-all"}`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json();
      if (r.ok && d?.ok) await load();
      else alert(d?.message || "تعذّر تنفيذ الطلب");
    } catch { alert("تعذّر تنفيذ الطلب"); } finally { setPausing(null); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* زر تحديث واحد أعلى الصفحة — بيحدّث الجزئين معاً (الأولوية العليا + المؤجّلة) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="font-bold text-lg">طابور التنفيذ</h2>
          {/* مؤشّر التحديث التلقائى — يوضّح إن الأرقام حيّة من غير ما تضغط تحديث */}
          <span className="text-xs text-muted-foreground">
            {dirty
              ? "⏸ التحديث التلقائى متوقف — فيه ترتيب لسه ماتحفظش"
              : <>🔄 يتحدّث تلقائياً كل 5 ثوانى{lastRefresh ? ` — آخر تحديث ${lastRefresh.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}</>}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={togglePauseAll}
            size="sm"
            variant="outline"
            disabled={pausing === "all" || (!priorityRows.length && !rows.length)}
            className={`gap-1 ${anyPaused ? "text-emerald-700 border-emerald-200" : "text-amber-700 border-amber-200"}`}
          >
            {pausing === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : anyPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {anyPaused ? "استئناف الكل" : "إيقاف مؤقت للكل"}
          </Button>
          {/* () => load() مش load مباشرة — عشان onClick بيمرّر الحدث كأول باراميتر
              وكان هيتقرا كـ silent=true فيتحوّل التحديث اليدوى لتحديث صامت بغير قصد */}
          <Button onClick={() => load()} size="sm" variant="outline" className="gap-1" disabled={loading || saving}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
        </div>
      </div>

      {/* جزء علوى للعرض فقط: باتشات الأولوية العليا (≤3 خطوط أو محتاجة رفع سرعة) — دايماً بتتنفّذ
          قبل الباتشات المؤجّلة تحت بترتيب created_at، ومش قابلة لإعادة ترتيب. */}
      <Card className="p-4 space-y-3">
        <h3 className="font-bold flex items-center gap-2"><ListOrdered className="w-5 h-5 text-emerald-700" /> باتشات الأولوية العليا (فى الطابور الآن)</h3>
        <p className="text-xs text-muted-foreground">للعرض فقط — بتتنفّذ دايماً قبل الباتشات المؤجّلة تحت، بترتيب وصولها (الأقدم أولاً)، ومش قابلة لإعادة ترتيب.</p>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : priorityRows.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4">لا توجد باتشات أولوية عليا فى الطابور حالياً.</div>
        ) : (
          <div className="space-y-2">
            {priorityRows.map((b, i) => (
              <div key={b.batchId} className="flex items-center gap-3 border rounded-md px-3 py-2 bg-white">
                <span className="w-6 text-center font-bold text-emerald-700">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                    <span className="font-semibold">{typeLabel(b.type)}</span>
                    {priorityBadge(b.priority)}
                    <span className="text-emerald-700 font-medium">اتنفّذ {b.done} من {b.total} خط</span>
                    <span className="text-xs text-muted-foreground">من تقرير: <span className="text-foreground">{b.note || "غير محدد"}</span></span>
                    <span className="text-xs text-muted-foreground">طلبها: <span className="text-foreground">{b.requestedBy || "-"}</span></span>
                    <span className="text-xs text-muted-foreground">التوقيت: {fmt(b.createdAt)}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">باتش: {b.batchId}</span>
                    {b.paused && <span className="text-xs px-2 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">موقَّف مؤقتاً</span>}
                    {/* الباتش العالق لازم يبان — قبل كده كان بيفضل «0 من N» من غير أى تفسير */}
                    {b.claimed > 0 && (
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold inline-flex items-center gap-1 ${isStuck(b) ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}`}>
                        {isStuck(b) && <AlertTriangle className="w-3 h-3" />}
                        {isStuck(b) ? `عالق — تحت التنفيذ من ${b.claimedMins} دقيقة` : `جارٍ التنفيذ${b.claimedMins != null ? ` من ${b.claimedMins} دقيقة` : ""}`}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => requeueBatch(b.batchId, b)}
                  disabled={requeuing === b.batchId}
                  className={`shrink-0 disabled:opacity-30 ${isStuck(b) ? "text-red-600 hover:text-red-800" : "text-blue-600 hover:text-blue-800"}`}
                  title="إعادة تشغيل — يرجّع مهام الباتش للطابور من أول وجديد"
                >
                  {requeuing === b.batchId ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => togglePauseBatch(b.batchId, b.paused)}
                  disabled={pausing === b.batchId}
                  className={`shrink-0 disabled:opacity-30 ${b.paused ? "text-emerald-600 hover:text-emerald-800" : "text-amber-500 hover:text-amber-700"}`}
                  title={b.paused ? "استئناف الباتش" : "إيقاف مؤقت — يكمّل التالى فوراً"}
                >
                  {pausing === b.batchId ? <Loader2 className="w-4 h-4 animate-spin" /> : b.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => cancelBatch(b.batchId, b.total)}
                  disabled={canceling === b.batchId}
                  className="text-red-500 hover:text-red-700 disabled:opacity-30 shrink-0"
                  title="إلغاء الباتش"
                >
                  {canceling === b.batchId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold flex items-center gap-2"><ListOrdered className="w-5 h-5 text-purple-700" /> ترتيب الباتشات المؤجّلة (أكثر من 3 خطوط)</h3>
          <p className="text-xs text-muted-foreground">رتّب تنفيذ الباتشات الكبيرة كما تريد (الأسهم للأعلى/الأسفل). الأولوية الأعلى دايماً: الطلبات ≤3 خطوط ثم تقرير «محتاجة رفع سرعة» — مش بتتأثر بالترتيب ده.</p>
        </div>
        <Button onClick={save} size="sm" className="gap-1 bg-purple-600 hover:bg-purple-700" disabled={!dirty || saving || !rows.length}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ الترتيب</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">لا توجد باتشات مؤجّلة فى الطابور حالياً.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((b, i) => (
            <div key={b.batchId} className="flex items-center gap-3 border rounded-md px-3 py-2 bg-white">
              <span className="w-6 text-center font-bold text-purple-700">{i + 1}</span>
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-purple-700 disabled:opacity-30" title="لأعلى"><ChevronUp className="w-4 h-4" /></button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="text-muted-foreground hover:text-purple-700 disabled:opacity-30" title="لأسفل"><ChevronDown className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                  <span className="font-semibold">{typeLabel(b.type)}</span>
                  <span className="text-emerald-700 font-medium">اتنفّذ {b.done} من {b.total} خط</span>
                  <span className="text-xs text-muted-foreground">من تقرير: <span className="text-foreground">{b.note || "غير محدد"}</span></span>
                  <span className="text-xs text-muted-foreground">طلبها: <span className="text-foreground">{b.requestedBy || "-"}</span></span>
                  <span className="text-xs text-muted-foreground">التوقيت: {fmt(b.createdAt)}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">باتش: {b.batchId}</span>
                  {b.paused && <span className="text-xs px-2 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">موقَّف مؤقتاً</span>}
                  {/* الباتش العالق لازم يبان — قبل كده كان بيفضل «0 من N» من غير أى تفسير */}
                  {b.claimed > 0 && (
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold inline-flex items-center gap-1 ${isStuck(b) ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}`}>
                      {isStuck(b) && <AlertTriangle className="w-3 h-3" />}
                      {isStuck(b) ? `عالق — تحت التنفيذ من ${b.claimedMins} دقيقة` : `جارٍ التنفيذ${b.claimedMins != null ? ` من ${b.claimedMins} دقيقة` : ""}`}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => requeueBatch(b.batchId, b)}
                disabled={requeuing === b.batchId}
                className={`shrink-0 disabled:opacity-30 ${isStuck(b) ? "text-red-600 hover:text-red-800" : "text-blue-600 hover:text-blue-800"}`}
                title="إعادة تشغيل — يرجّع مهام الباتش للطابور من أول وجديد"
              >
                {requeuing === b.batchId ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              </button>
              <button
                onClick={() => togglePauseBatch(b.batchId, b.paused)}
                disabled={pausing === b.batchId}
                className={`shrink-0 disabled:opacity-30 ${b.paused ? "text-emerald-600 hover:text-emerald-800" : "text-amber-500 hover:text-amber-700"}`}
                title={b.paused ? "استئناف الباتش" : "إيقاف مؤقت — يكمّل التالى فوراً"}
              >
                {pausing === b.batchId ? <Loader2 className="w-4 h-4 animate-spin" /> : b.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
              <button
                onClick={() => cancelBatch(b.batchId, b.total)}
                disabled={canceling === b.batchId}
                className="text-red-500 hover:text-red-700 disabled:opacity-30 shrink-0"
                title="إلغاء الباتش"
              >
                {canceling === b.batchId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
    </div>
  );
}

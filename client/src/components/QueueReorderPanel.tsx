import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ChevronUp, ChevronDown, Save, ListOrdered } from "lucide-react";

// ترتيب باتشات «الأولوية المتأخرة» (>3 خطوط من غير تقرير محتاجة رفع سرعة) — للسوبر أدمن.
// الأولويات الأعلى (≤3 خطوط، ثم محتاجة رفع سرعة) بتتنفّذ قبلها دايماً ومش بتتأثر بالترتيب ده.
interface Batch {
  batchId: string;
  type: "measure" | "raise" | "stop" | string;
  requestedBy: string | null;
  note: string | null;
  total: number;
  done: number;
  createdAt: string | null;
  queueOrder: number;
}
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

  const load = useCallback(async () => {
    setLoading(true);
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
    } catch { setRows([]); setPriorityRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="space-y-4" dir="rtl">
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
                  </div>
                </div>
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
        <div className="flex gap-2">
          <Button onClick={load} size="sm" variant="outline" className="gap-1" disabled={loading || saving}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
          <Button onClick={save} size="sm" className="gap-1 bg-purple-600 hover:bg-purple-700" disabled={!dirty || saving || !rows.length}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ الترتيب</Button>
        </div>
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
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
    </div>
  );
}

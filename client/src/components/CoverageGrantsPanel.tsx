import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Trash2, Plus } from "lucide-react";

// «منح التغطية الدائمة» — السوبر أدمن يمنح فنى (القائم بالعمل) حق التصرف فى خطوط زميل
// (قياس/رفع سرعة/إيقاف من بحث برقم التليفون + رؤيتها فى أعطاله) حتى لو الزميل «عمل».
interface Grant { id: number; granteeTechName: string; coveredTechName: string; createdBy: string | null }

export function CoverageGrantsPanel() {
  const qc = useQueryClient();
  const [grantee, setGrantee] = useState("");
  const [covered, setCovered] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: grants = [], isFetching } = useQuery<Grant[]>({
    queryKey: ["/api/coverage-grants"],
    queryFn: async () => { const r = await fetch("/api/coverage-grants", { credentials: "include" }); if (!r.ok) throw new Error("فشل"); return r.json(); },
  });
  const { data: techList = [] } = useQuery<{ workerCode: string; techName: string }[]>({
    queryKey: ["/api/technician-names"],
    // لازم نرمى الخطأ مش نرجّع [] — الرد الفاشل كان بيتخزّن كنجاح بقائمة فاضية
    // فالدروب ليست تفضل فاضية من غير إعادة محاولة (retry: false عام).
    queryFn: async () => {
      const r = await fetch("/api/technician-names", { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر تحميل قائمة الفنيين");
      return r.json();
    },
    retry: 3, retryDelay: (n: number) => Math.min(1000 * 2 ** n, 8000),
    staleTime: 5 * 60 * 1000,
  });
  const techOptions = useMemo(
    () => Array.from(new Set(techList.map((t) => (t.techName || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar")),
    [techList],
  );

  const add = async () => {
    if (!grantee || !covered) return;
    setBusy(true);
    try {
      const r = await fetch("/api/coverage-grants", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granteeTechName: grantee, coveredTechName: covered }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || "فشل الإضافة");
      setGrantee(""); setCovered("");
      qc.invalidateQueries({ queryKey: ["/api/coverage-grants"] });
    } catch (e: any) { alert(e.message || "تعذّرت الإضافة"); } finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    if (!confirm("حذف منح التغطية ده؟")) return;
    await fetch(`/api/coverage-grants/${id}`, { method: "DELETE", credentials: "include" }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["/api/coverage-grants"] });
  };

  return (
    <Card className="p-4 space-y-3 border-indigo-200" dir="rtl">
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-indigo-600" /> منح التغطية الدائمة</h3>
        <p className="text-[11px] text-muted-foreground">الفنى «القائم بالعمل» يقدر يقيس/يرفع سرعة/يوقف خطوط الزميل من بحث برقم التليفون ويشوفها فى أعطاله — حتى لو الزميل «عمل».</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label className="text-[11px] text-muted-foreground">الفنى القائم بالعمل</label>
          <select value={grantee} onChange={(e) => setGrantee(e.target.value)} className="border rounded-md px-2 py-1.5 text-xs bg-background min-w-[170px]" dir="rtl">
            <option value="">اختر الفنى</option>
            {techOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] text-muted-foreground">يغطّى خطوط الفنى</label>
          <select value={covered} onChange={(e) => setCovered(e.target.value)} className="border rounded-md px-2 py-1.5 text-xs bg-background min-w-[170px]" dir="rtl">
            <option value="">اختر الفنى</option>
            {techOptions.filter((t) => t !== grantee).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Button onClick={add} size="sm" disabled={busy || !grantee || !covered} className="gap-1">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} إضافة منح
        </Button>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="rounded-md border divide-y">
        {grants.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3 text-center">لا توجد منح تغطية</div>
        ) : grants.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <span><strong>{g.granteeTechName}</strong> ← يغطّى خطوط <strong>{g.coveredTechName}</strong></span>
            <button onClick={() => remove(g.id)} className="text-red-600 hover:text-red-800" title="حذف"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </Card>
  );
}

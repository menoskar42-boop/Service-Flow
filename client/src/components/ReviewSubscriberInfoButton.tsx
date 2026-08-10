import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useIsSuperAdmin } from "@/lib/use-speed-tools";
import { UserSearch, Loader2 } from "lucide-react";
import { isExecutorActive, enqueueJob, canRunLocalExecutor, NO_EXECUTOR_MSG } from "@/lib/exec-queue";

// زر "مراجعة الاسم والعنوان": يعيد جلب الأسماء/العناوين من FCC لأرقام البورتات.
// نعم = الأرقام بدون اسم/عنوان فقط. الكل = كل الأرقام.
// ⚠️ قبل كده كان بيفتح FCC مباشرة على متصفح المستخدم الحالى — فلو ده مش جهاز التنفيذ
// (مالوش وصول لـ FCC، أو مستخدم من الموبايل) كان التاب بيتفتح وميعملش حاجة. دلوقتى:
//  • فيه جهاز تنفيذ مفعّل → الأرقام بتتبعت لطابور مراجعة البيان الفنى (subinfo لكل رقم)
//    زى باقى العمليات، وجهاز التنفيذ هو اللى بيفتح FCC.
//  • مفيش جهاز تنفيذ وسوبر أدمن على كمبيوتر مكتب → fallback زى القديم بالظبط: يفتح FCC
//    محلياً بوضع «auto» اللى بيلف على /pending بنفسه.
// filters: لو اتمرّرت (من بيان التليفونات) → المراجعة بتقتصر على الأرقام المفلترة بس.
export function ReviewSubscriberInfoButton({ filters }: { filters?: { central?: string; cabin?: string; box?: string; phoneFrom?: string; phoneTo?: string } }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const isSuper = useIsSuperAdmin(); // الزر للسوبر أدمن فقط — فى كل أماكن استخدامه

  const run = async (scope: "empty" | "all") => {
    setBusy(true);
    try {
      const res = await fetch("/api/line-subscriber-info/requeue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scope, ...(filters || {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "خطأ");
      const j = await res.json();
      const phones: string[] = Array.isArray(j.phones) ? j.phones : [];
      if (!phones.length) {
        toast({ title: "لا يوجد ما يُراجع", description: "كل الأرقام فى هذا النطاق عندها اسم/عنوان بالفعل.", duration: 5000 });
        return;
      }

      if (await isExecutorActive()) {
        const r = await enqueueJob("subinfo", phones);
        if (!r.ok) throw new Error(r.message || "تعذّر الإضافة لطابور التنفيذ");
        toast({
          title: "بدأت المراجعة",
          description: `${scope === "all" ? "كل الأرقام" : "الأرقام بدون اسم/عنوان"} — ${phones.length} رقم اتضافوا لطابور مراجعة البيان الفنى. هيتنفّذوا على جهاز التنفيذ.`,
          duration: 6000,
        });
        return;
      }
      if (!isSuper || !canRunLocalExecutor()) {
        toast({ variant: "destructive", title: "غير متاح حالياً", description: NO_EXECUTOR_MSG, duration: 6000 });
        return;
      }

      // fallback محلى (سوبر أدمن، كمبيوتر مكتب، من غير جهاز تنفيذ): نفس السلوك القديم —
      // يفتح FCC هنا فيشتغل سكربت الجلب تلقائياً على /pending.
      toast({
        title: "بدأت المراجعة",
        description: `${scope === "all" ? "كل الأرقام" : "الأرقام بدون اسم/عنوان"} — ${phones.length} رقم. سيُفتح FCC لجلب البيانات على هذا المتصفح.`,
        duration: 5000,
      });
      const f = filters || {};
      const hasF = !!(f.central || f.cabin || f.box || f.phoneFrom || f.phoneTo);
      const fkey = [f.central || "", f.cabin || "", f.box || "", f.phoneFrom || "", f.phoneTo || ""].join("~");
      const sif = hasF ? "&sf_sif=" + encodeURIComponent(fkey) : "";
      const win = hasF
        ? "sf_si_" + Math.abs(Array.from(fkey).reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)).toString(36)
        : "sf_subinfo_auto";
      window.open("https://fcc.te.eg/TroubleTicket/faces/security/pages/Login.jsf#sf_si=auto" + sif, win);
    } catch (e: any) {
      toast({ variant: "destructive", title: "خطأ", description: e.message || "تعذّر البدء", duration: 5000 });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  if (!isSuper) return null; // مخفى لغير السوبر أدمن

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="gap-1 text-fuchsia-700 border-fuchsia-200 hover:bg-fuchsia-50"
        title="جلب اسم وعنوان العميل من FCC لأرقام البورتات"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserSearch className="w-4 h-4" />}
        مراجعة الاسم والعنوان
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">مراجعة الاسم والعنوان</AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              تريد إعادة جلب أي أرقام من FCC؟
              <br />
              <b>الأرقام بدون اسم/عنوان فقط</b>: يجلب الأرقام الجديدة/الناقصة فقط.
              <br />
              <b>كل الأرقام</b>: يعيد جلب كل الأرقام من جديد (حتى اللى ليها بيانات).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction onClick={() => run("empty")} className="bg-fuchsia-600 hover:bg-fuchsia-700">
              الأرقام بدون اسم/عنوان فقط
            </AlertDialogAction>
            <Button variant="outline" onClick={() => run("all")} disabled={busy}>
              كل الأرقام
            </Button>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

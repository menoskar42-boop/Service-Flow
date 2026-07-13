import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { UserSearch, Loader2 } from "lucide-react";

// زر "مراجعة الاسم والعنوان": يعيد جلب الأسماء/العناوين من FCC لأرقام البورتات.
// نعم = الأرقام بدون اسم/عنوان فقط. الكل = كل الأرقام. ثم يفتح FCC ويشغّل السكربت تلقائياً.
export function ReviewSubscriberInfoButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const run = async (scope: "empty" | "all") => {
    setBusy(true);
    try {
      const res = await fetch("/api/line-subscriber-info/requeue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "خطأ");
      const j = await res.json();
      toast({
        title: "بدأت المراجعة",
        description: `${scope === "all" ? "كل الأرقام" : "الأرقام بدون اسم/عنوان"} — تم تجهيز ${j.requeued} رقم. سيُفتح FCC لجلب البيانات.`,
        duration: 5000,
      });
      // يفتح FCC (بالاسم الثابت) فيشتغل سكربت الجلب تلقائياً على كل الأرقام المطلوبة
      window.open("https://fcc.te.eg/TroubleTicket/faces/security/pages/Login.jsf", "sf_subinfo_auto");
    } catch (e: any) {
      toast({ variant: "destructive", title: "خطأ", description: e.message || "تعذّر البدء", duration: 5000 });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

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

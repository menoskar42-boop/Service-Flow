import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Loader2, X } from "lucide-react";

// زر «كلمة السر» — متاح لأى مستخدم مسجّل دخول ليغيّر كلمة سره بنفسه (يتحقق من الحالية).
export function ChangeMyPasswordButton() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const submit = async () => {
    if (nw.length < 3) { toast({ variant: "destructive", title: "كلمة السر الجديدة قصيرة (3 أحرف على الأقل)" }); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/change-my-password", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "خطأ");
      toast({ title: "تم تغيير كلمة السر بنجاح" });
      setOpen(false); setCur(""); setNw("");
    } catch (e: any) {
      toast({ variant: "destructive", title: "تعذّر التغيير", description: e.message });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="h-8 sm:h-9 px-2 sm:px-3 text-muted-foreground" title="غيّر كلمة السر">
        <KeyRound className="w-4 h-4 sm:ml-2" />
        <span className="hidden sm:inline">كلمة السر</span>
      </Button>
      {open && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-4 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2"><KeyRound className="w-5 h-5 text-blue-600" /> تغيير كلمة السر</h3>
              <button onClick={() => setOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">كلمة السر الحالية</label>
              <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus />
            </div>
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">كلمة السر الجديدة</label>
              <Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button size="sm" onClick={submit} disabled={busy} className="gap-1">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} حفظ
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

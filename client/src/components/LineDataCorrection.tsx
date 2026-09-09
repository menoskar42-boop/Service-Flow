import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// «تصحيح بيانات» — الفنى بيبعت رقم الخط ومعاه السنترال/الكابينة/البكس الصح.
// رقم التليفون بس هو الإلزامى. الإرسال بيعمل تلات حاجات على السيرفر:
//   (1) يسجّل التصحيح، (2) يطبّقه على البيان الفنى للخط، (3) يحطّ طلب «مراجعة الاسم
//   والعنوان» فى الطابور. الطابور نفسه هو التخزين — المهمة بتفضل منتظرة لحد ما جهاز
//   تنفيذ يرجع ويسحبها، فمفيش طلب بيضيع لو مفيش جهاز مفعّل دلوقتى.
interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

interface Props {
  /** رقم يتملى تلقائياً (من «بحث برقم التليفون») — بيتقفل عشان يبقى نفس الرقم المعروض. */
  initialPhone?: string;
  /** وضع النافذة المنبثقة: من غير كارت ولا عنوان (النافذة نفسها فيها العنوان). */
  compact?: boolean;
  /** بيتنادى بعد إرسال ناجح — النافذة بتتقفل بيه. */
  onSent?: () => void;
}

export function LineDataCorrection({ initialPhone, compact, onSent }: Props = {}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // الرقم الجاى من بحث برقم التليفون بيتحطّ من غير بادئة 88 (السيرفر بيشيلها برضه)
  const [phone, setPhone] = useState(() =>
    String(initialPhone ?? "").replace(/\D/g, "").replace(/^88/, ""));
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [terminal, setTerminal] = useState("");   // إدخال حر — مش دروب ليست
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const { data: opts } = useQuery<FilterOptions>({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("فشل تحميل قوائم السنترال والكابينة");
      return res.json();
    },
  });

  // الكابينة بتتفلتر بالسنترال، والبكس بالسنترال+الكابينة — زى باقى فلاتر الموقع.
  const cabinOptions = useMemo(
    () => (central && opts?.cabins?.[central]) || [],
    [opts, central]);
  const boxOptions = useMemo(
    () => (central && cabin && opts?.boxes?.[`${central}||${cabin}`]) || [],
    [opts, central, cabin]);

  // رقم التليفون: أرقام فقط (بادئة 88 بتتضاف على السيرفر)
  const onPhone = (v: string) => { if (v === "" || /^\d*$/.test(v)) setPhone(v); };
  const canSend = phone.trim().length >= 5 && !sending;

  const reset = () => { setPhone(""); setCentral(""); setCabin(""); setBox(""); setTerminal(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    try {
      const res = await apiRequest("POST", "/api/line-data-corrections", {
        phone: phone.trim(), central, cabinNumber: cabin, boxNumber: box, dpTerminal: terminal.trim(),
      });
      const j = await res.json();
      setLastSent(j?.phone || `88-${phone.trim()}`);
      toast({
        title: "اتبعت",
        description: j?.queued
          ? "اتسجّل التصحيح، وطلب مراجعة الاسم والعنوان اتحطّ فى الطابور — هيتنفّذ أول ما جهاز التنفيذ يبقى متاح."
          : "اتسجّل التصحيح، وطلب المراجعة للرقم ده موجود فى الطابور بالفعل.",
        duration: 6000,
      });
      if (!initialPhone) reset(); else { setCentral(""); setCabin(""); setBox(""); setTerminal(""); }
      onSent?.();
      // البيان الفنى اتغيّر → التقارير اللى بتعتمد عليه تتحدّث
      qc.invalidateQueries({ queryKey: ["/api/reports/work-orders-no-cable"] });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/lookup"] });
    } catch (err: any) {
      let msg = err?.message || "حدث خطأ";
      const m = String(msg).match(/^\d+:\s*(.*)$/s);
      if (m) msg = m[1];
      try { const j = JSON.parse(msg); if (j?.message) msg = j.message; } catch { /* نص عادى */ }
      toast({ title: "تعذّر الإرسال", description: msg, variant: "destructive", duration: 6000 });
    } finally {
      setSending(false);
    }
  };

  const selectCls = "w-full border rounded-md px-3 py-2 text-sm bg-white disabled:opacity-50";

  const body = (
    <>
      {!compact && (
        <div className="flex items-center gap-2 mb-1">
          <Wrench className="w-5 h-5 text-primary" />
          <h2 className="text-base font-bold">تصحيح بيانات</h2>
        </div>
      )}
      <p className="text-xs text-muted-foreground mb-4">
        اكتب رقم التليفون (إلزامى) واختار السنترال والكابينة والبكس ورقم الترمنال الصح لو تعرفهم (كلها اختيارية).
        رقم الترمنال بيتكتب بإيدك (مش قائمة). الإرسال بيسجّل التصحيح ويطلب
        <strong>مراجعة الاسم والعنوان</strong> للرقم — ولو جهاز
        التنفيذ مش مفعّل، الطلب بيفضل محفوظ فى الطابور وبيتنفّذ أول ما الجهاز يرجع.
      </p>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-48">
          <Label className="text-xs text-muted-foreground block mb-1">
            رقم التليفون <span className="text-red-600">*</span>
          </Label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground font-mono shrink-0">88-</span>
            <Input
              inputMode="numeric"
              value={phone}
              onChange={(e) => onPhone(e.target.value)}
              placeholder="2657290"
              dir="ltr"
              className="text-sm text-left"
              readOnly={!!initialPhone}
              title={initialPhone ? "الرقم المعروض فى البحث" : ""}
            />
          </div>
        </div>

        <div className="w-full sm:w-56">
          <Label className="text-xs text-muted-foreground block mb-1">اسم السنترال</Label>
          <select
            value={central}
            onChange={(e) => { setCentral(e.target.value); setCabin(""); setBox(""); }}
            className={selectCls}
            dir="rtl"
          >
            <option value="">— اختيارى —</option>
            {(opts?.centrals ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="w-full sm:w-40">
          <Label className="text-xs text-muted-foreground block mb-1">رقم الكابينة</Label>
          <select
            value={cabin}
            onChange={(e) => { setCabin(e.target.value); setBox(""); }}
            className={selectCls}
            dir="rtl"
            disabled={!central}
            title={central ? "" : "اختار السنترال الأول"}
          >
            <option value="">— اختيارى —</option>
            {cabinOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="w-full sm:w-40">
          <Label className="text-xs text-muted-foreground block mb-1">رقم البكس</Label>
          <select
            value={box}
            onChange={(e) => setBox(e.target.value)}
            className={selectCls}
            dir="rtl"
            disabled={!cabin}
            title={cabin ? "" : "اختار الكابينة الأول"}
          >
            <option value="">— اختيارى —</option>
            {boxOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div className="w-full sm:w-40">
          <Label className="text-xs text-muted-foreground block mb-1">رقم الترمنال</Label>
          <Input
            value={terminal}
            onChange={(e) => setTerminal(e.target.value)}
            placeholder="اختيارى"
            dir="ltr"
            className="text-sm text-left"
            title="رقم الترمنال — بيتكتب بإيدك، مش قائمة اختيار"
          />
        </div>

        <Button type="submit" disabled={!canSend} className="gap-1">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          إرسال
        </Button>
      </form>

      {lastSent && (
        <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          آخر إرسال: <strong className="font-mono">{lastSent}</strong> — التصحيح اتسجّل وطلب
          مراجعة الاسم والعنوان فى الطابور.
        </div>
      )}
    </>
  );

  if (compact) return <div dir="rtl">{body}</div>;
  return <Card className="p-4 sm:p-5 bg-white border-0 shadow-sm" dir="rtl">{body}</Card>;
}

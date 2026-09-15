import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Info } from "lucide-react";

// نافذة «بيان الخط» — الاسم والعنوان + البيانات الفنية + كود كابينة المسان الحالى.
// بتتفتح من جنب رقم التليفون فى «أوامر شغل بدون كمية سلك» عشان الفنى يفتكر الخط
// ويقدّر كمية السلك من غير ما يسيب الشاشة ويروح لـ«بحث برقم التليفون».
// نفس مصدر بحث برقم التليفون بالظبط (/api/phone-lines/lookup) — فالبيانات واحدة،
// وبتشمل تصحيحات البيان لأن الـ endpoint بيعمل COALESCE عليها.
interface LookupLine {
  telNo?: string | null; fullPhone?: string | null; central?: string | null;
  cabinNumber?: string | null; boxNumber?: string | null; dpTerminal?: string | null;
  msanCode?: string | null; port?: string | null; len?: string | null;
  iduNo?: string | null; oduNo?: string | null;
  primaryBlockNo?: string | null; cabinetIn?: string | null;
  secBlockNo?: string | null; cabinetOut?: string | null;
  fiberBlock?: string | null; fiberOut?: string | null;
  subName?: string | null; subAdd?: string | null;
  techName?: string | null; accountNo?: string | null;
  dataCorrected?: boolean | null; correctedBy?: string | null;
}

const Row = ({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) => (
  <div className="flex items-start gap-2 py-1 border-b last:border-0">
    <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
    <span className={`text-sm flex-1 break-words ${mono ? "font-mono" : ""}`}>
      {value && String(value).trim() ? value : "-"}
    </span>
  </div>
);

export function LineInfoDialog({ phone, open, onOpenChange }: {
  phone: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { data, isFetching, error } = useQuery<LookupLine | null>({
    queryKey: ["/api/phone-lines/lookup", phone],
    // بنجيب البيان بس لما النافذة تتفتح فعلاً — مش مع كل صف فى الجدول
    enabled: open && !!phone,
    queryFn: async () => {
      // أرقام بس: أوامر الشغل بتخزّن الرقم بشرطة («88-2650848») والسيرفر بيطبّع
      // برضه، بس بنبعته نضيف من هنا كمان عشان الطلب يبقى واضح.
      const res = await fetch(`/api/phone-lines/lookup?phone=${encodeURIComponent(String(phone).replace(/\D/g, ""))}`,
        { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "تعذّر جلب بيان الخط");
      // شكل الرد: { found: boolean, line: {...} } — نفس اللى بحث برقم التليفون بيقراه
      const j = await res.json();
      return j?.found && j?.line ? (j.line as LookupLine) : null;
    },
  });

  const d = data || {};
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            بيان الخط <span className="font-mono text-blue-700">{phone}</span>
          </DialogTitle>
        </DialogHeader>

        {isFetching ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="text-sm text-red-600 py-4">{(error as Error).message}</div>
        ) : !data ? (
          <div className="text-sm text-muted-foreground py-4">مفيش بيان للرقم ده.</div>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-bold mb-1">العميل</h4>
              <Row label="الاسم" value={d.subName} />
              <Row label="العنوان" value={d.subAdd} />
              <Row label="رقم الأكونت" value={d.accountNo} mono />
            </div>
            <div>
              {/* كود كابينة المسان — أهم حاجة للفنى عشان يعرف الخط على أنهى مسان */}
              <h4 className="text-sm font-bold mb-1">كود كابينة المسان</h4>
              <Row label="كود المسان" value={d.msanCode} mono />
              <Row label="السنترال" value={d.central} />
              <Row label="رقم الكابينة" value={d.cabinNumber} mono />
              <Row label="رقم البكس" value={d.boxNumber} mono />
              <Row label="الترمنال" value={d.dpTerminal} mono />
            </div>
            <div>
              <h4 className="text-sm font-bold mb-1">البيانات الفنية</h4>
              <Row label="IDU" value={d.iduNo} mono />
              <Row label="ODU" value={d.oduNo} mono />
              <Row label="بلوك أولى" value={d.primaryBlockNo} mono />
              <Row label="داخل الكابينة" value={d.cabinetIn} mono />
              <Row label="بلوك ثانوى" value={d.secBlockNo} mono />
              <Row label="خارج الكابينة" value={d.cabinetOut} mono />
              <Row label="بلوك فايبر" value={d.fiberBlock} mono />
              <Row label="خارج الفايبر" value={d.fiberOut} mono />
              <Row label="البورت" value={d.port} mono />
              <Row label="الطول" value={d.len} mono />
              <Row label="فنى المنطقة" value={d.techName} />
            </div>
            {d.dataCorrected && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                البيان ده متصحَّح{d.correctedBy ? ` بواسطة ${d.correctedBy}` : ""}.
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";

// نافذة «تفاصيل الخط» المشتركة — بتتفتح من أى تقرير فيه رقم تليفون.
// مصدر البيانات هو نفس مصادر «بحث برقم التليفون» بالظبط عشان مايبقاش فيه مصدرين
// للاسم والعنوان يختلفوا عن بعض:
//   • /api/phone-lines/lookup      → الاسم والعنوان والموبايل وبيانات الخط الفنية
//   • /api/line-fault-history      → تواريخ الشكاوى والإغلاق وأسبابها ومين قفل
// highlightComplainNo (اختيارى): بيلوّن سطر الشكوى اللى جاى منها الصف فى التقرير.

const fmt = (d: string | null | undefined) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

interface FaultRow {
  at: string | null;
  code: string | null;
  by: string | null;
  complainAt?: string | null;
  complainNo?: string | null;
}

export function LineDetailsDialog({
  phone, onClose, highlightComplainNo,
}: { phone: string; onClose: () => void; highlightComplainNo?: string | null }) {
  const { data, isFetching } = useQuery({
    queryKey: ["/api/phone-lines/lookup", phone],
    queryFn: async () => {
      const res = await fetch(`/api/phone-lines/lookup?phone=${encodeURIComponent(phone)}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل البحث");
      return res.json() as Promise<{ found: boolean; line?: any }>;
    },
  });
  const { data: hist, isFetching: histLoading } = useQuery({
    queryKey: ["/api/line-fault-history", phone],
    queryFn: async () => {
      const res = await fetch(`/api/line-fault-history?phone=${encodeURIComponent(phone)}`, { credentials: "include" });
      if (!res.ok) return { closes: [] as FaultRow[] };
      return res.json() as Promise<{ closes?: FaultRow[] }>;
    },
  });

  const l = data?.found ? data.line : null;
  const closes = hist?.closes ?? [];

  const Row = ({ k, v }: { k: string; v: any }) => (
    <div className="flex gap-2 py-1.5 border-b last:border-0">
      <span className="text-muted-foreground w-32 shrink-0 text-xs">{k}</span>
      <span className="text-sm font-medium break-words">{v || "-"}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-start justify-center p-3 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b bg-blue-50">
          <h3 className="font-bold text-sm">تفاصيل الخط — <bdi dir="ltr">{phone}</bdi></h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4">
          {isFetching ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !l ? (
            <p className="text-center text-sm text-muted-foreground py-6">مفيش بيانات للرقم ده</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              <div>
                <Row k="اسم العميل" v={l.subName} />
                <Row k="العنوان" v={l.subAdd} />
                <Row k="رقم الموبايل" v={l.mobile} />
                <Row k="رقم الأكونت" v={l.accountNo} />
                <Row k="اسم الفنى" v={l.techName} />
              </div>
              <div>
                <Row k="السنترال" v={l.central} />
                <Row k="رقم الكابينه" v={l.cabinNumber} />
                <Row k="رقم البكس" v={l.boxNumber} />
                <Row k="DP Terminal" v={l.dpTerminal} />
                <Row k="كود المسان / الفريم" v={[l.msanCode, l.frame].filter(Boolean).join(" / ")} />
              </div>
            </div>
          )}

          {/* تاريخ الشكاوى والإغلاق */}
          <div className="mt-4">
            <h4 className="text-xs font-bold text-muted-foreground mb-1">تاريخ الأعطال</h4>
            {histLoading ? (
              <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin inline text-muted-foreground" /></div>
            ) : !closes.length ? (
              <p className="text-xs text-muted-foreground py-2">مفيش أعطال مسجّلة</p>
            ) : (
              <div className="overflow-auto max-h-64 border rounded">
                <table className="w-full text-xs text-right">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="p-1.5 font-bold whitespace-nowrap">تاريخ الشكوى</th>
                      <th className="p-1.5 font-bold whitespace-nowrap">تاريخ الإغلاق</th>
                      <th className="p-1.5 font-bold whitespace-nowrap">سبب الإغلاق</th>
                      <th className="p-1.5 font-bold whitespace-nowrap">قفلها</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closes.map((c, i) => {
                      const hot = highlightComplainNo && c.complainNo && String(c.complainNo) === String(highlightComplainNo);
                      return (
                        <tr key={i} className={`border-t ${hot ? "bg-amber-50 font-semibold" : ""}`}>
                          <td className="p-1.5 whitespace-nowrap">{fmt(c.complainAt)}</td>
                          <td className="p-1.5 whitespace-nowrap">{fmt(c.at)}</td>
                          <td className="p-1.5">{c.code || "-"}</td>
                          <td className="p-1.5 whitespace-nowrap">{c.by || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

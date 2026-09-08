import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Cable, Search, Save, FileSpreadsheet, Printer, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { format } from "date-fns";

// أوامر الشغل اللى لسه مالهاش كمية سلك — نفس مصدر تقرير «أوامر شغل بدون كمية سلك»
// (/api/reports/work-orders-no-cable) بس هنا قدّام كل صف خانة إدخال. الحفظ بيروح على
// نفس endpoint الإدخال اليدوى (/api/cable-entries)، فالكمية بتدخل «استكمال البيانات»
// وبالتبعية بتظهر فى تقرير أوامر الشغل — ومابيبقاش فيه مسار تانى للبيانات.
interface Row {
  id: number;
  centralName: string | null;
  workOrderId: number | string | null;
  phoneNumber: string | null;
  serviceType: string | null;
  closeDate: string | null;
  itemName: string | null;
  techName: string | null;          // الاسم الفعلى (بعد أى تعديل)
  sheetTechName: string | null;     // الاسم الأصلى الجاى من الشيت
  techEdited: boolean;              // اتعدّل قبل كده؟
  techEditedBy: string | null;
  techKnown: boolean;               // الاسم ده واحد من الفنيين المسجّلين؟
  areaTechName: string | null;      // فنى المنطقة من البيانات الفنية للرقم
  hasLineData: boolean;             // الرقم له بيانات فنية؟
}

// أول يوم فى الشهر الحالى → النهاردة (بتوقيت القاهرة)، بصيغة yyyy-MM-dd
const cairoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const cairoMonthStart = () => cairoToday().slice(0, 8) + "01";

const fmtDate = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

// نوع أمر الشغل المخزَّن مع الكمية — نفس التطابق المستخدم فى الـ endpoint وفى الربط
// مع تقرير أوامر الشغل: «نقل» تفضل نقل، وأى حاجة تانية تتسجّل «تركيب».
const orderTypeOf = (serviceType: string | null) =>
  String(serviceType ?? "").trim() === "نقل" ? "نقل" : "تركيب";

const COLS = ["#", "رقم امر الشغل", "رقم التليفون", "اسم السنترال", "نوع الخدمة",
  "نوع امر الشغل", "اسم الصنف", "اسم الفنى", "فنى المنطقة", "تاريخ الاغلاق"];

export function WorkOrdersNoCableEntry() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dateFrom, setDateFrom] = useState(cairoMonthStart);
  const [dateTo, setDateTo] = useState(cairoToday);
  const [search, setSearch] = useState("");
  // الكمية المكتوبة لكل صف + الصف اللى بيتحفظ دلوقتى (المفتاح = id أمر الشغل)
  const [qty, setQty] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const { user } = useAuth();
  // تعديل اسم الفنى متاح لكل مستخدمى التقرير **ما عدا الفنيين** (والمبيعات ممنوعة من
  // التقرير كله). بيظهر بس للأوامر اللى اسم الفنى فيها مش مطابق لأى فنى مسجّل.
  const canEditTech = user?.role !== ROLES.TECH && user?.role !== ROLES.SALES && user?.role !== ROLES.SALES_ADMIN;
  const [savingTech, setSavingTech] = useState<number | null>(null);

  const { data: techNames = [] } = useQuery<{ techName: string }[]>({
    queryKey: ["/api/technician-names"],
    enabled: canEditTech,
    queryFn: async () => {
      const res = await fetch("/api/technician-names", { credentials: "include" });
      if (!res.ok) throw new Error("فشل تحميل أسماء الفنيين");
      const j = await res.json();
      return Array.isArray(j) ? j : (j?.data ?? []);
    },
  });

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/reports/work-orders-no-cable", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/reports/work-orders-no-cable?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
    refetchOnMount: "always",
  });

  // بحث محلى فورى (أرقام لرقم التليفون/أمر الشغل، ونص للأسماء)
  const shown = useMemo(() => {
    const s = search.trim();
    if (!s) return rows;
    const digits = s.replace(/\D/g, "");
    const low = s.toLowerCase();
    return rows.filter((r) => {
      if (digits && (String(r.phoneNumber ?? "").replace(/\D/g, "").includes(digits)
                  || String(r.workOrderId ?? "").includes(digits))) return true;
      return [r.techName, r.centralName, r.serviceType, r.itemName]
        .some((v) => String(v ?? "").toLowerCase().includes(low));
    });
  }, [rows, search]);

  // كمية السلك: أرقام فقط مع نقطة عشرية واحدة (نفس تحقّق الإدخال اليدوى)
  const setRowQty = (id: number, v: string) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setQty((q) => ({ ...q, [id]: v }));
  };
  const validQty = (v: string) => /^\d+(\.\d+)?$/.test(String(v ?? "").trim());

  const saveTech = async (r: Row, techName: string) => {
    if (!techName) return;
    setSavingTech(r.id);
    try {
      const res = await apiRequest("PUT", "/api/work-order-tech", {
        centralName: r.centralName, workOrderId: r.workOrderId, techName,
      });
      await res.json();
      toast({ title: "اتسجّل اسم الفنى", description: `${techName} — أمر شغل ${r.workOrderId}`, duration: 3000 });
      qc.invalidateQueries({ queryKey: ["/api/reports/work-orders-no-cable"] });
      qc.invalidateQueries({ queryKey: ["/api/work-orders"] });
    } catch (e: any) {
      let msg = e?.message || "حدث خطأ";
      const m = String(msg).match(/^\d+:\s*(.*)$/s);
      if (m) msg = m[1];
      try { const j = JSON.parse(msg); if (j?.message) msg = j.message; } catch { /* نص عادى */ }
      toast({ title: "تعذّر تسجيل اسم الفنى", description: msg, variant: "destructive", duration: 6000 });
    } finally {
      setSavingTech(null);
    }
  };

  const save = async (r: Row) => {
    const v = String(qty[r.id] ?? "").trim();
    if (!validQty(v)) return;
    setSaving(r.id);
    try {
      // السيرفر بيشيل بادئة 88 بنفسه، فبنبعت الرقم زى ما هو جاى من أمر الشغل
      const res = await apiRequest("POST", "/api/cable-entries", {
        phone: String(r.phoneNumber ?? ""),
        workOrderType: orderTypeOf(r.serviceType),
        cableQuantity: v,
      });
      await res.json();
      toast({
        title: "تم الحفظ",
        description: `كمية السلك ${v} متر للرقم ${r.phoneNumber} (${orderTypeOf(r.serviceType)})`,
        duration: 3500,
      });
      setQty((q) => { const n = { ...q }; delete n[r.id]; return n; });
      // الصف بيختفى من هنا، والكمية بتظهر فى «استكمال البيانات» وفى تقرير أوامر الشغل
      qc.invalidateQueries({ queryKey: ["/api/reports/work-orders-no-cable"] });
      qc.invalidateQueries({ queryKey: ["/api/cable-entries"] });
      qc.invalidateQueries({ queryKey: ["/api/work-orders"] });
    } catch (e: any) {
      // رسالة الخطأ بتيجى بصيغة "409: {\"message\":\"...\"}" — بننضّفها للعرض
      let msg = e?.message || "حدث خطأ";
      const m = String(msg).match(/^\d+:\s*(.*)$/s);
      if (m) msg = m[1];
      try { const j = JSON.parse(msg); if (j?.message) msg = j.message; } catch { /* نص عادى */ }
      toast({ title: "تعذّر الحفظ", description: msg, variant: "destructive", duration: 6000 });
    } finally {
      setSaving(null);
    }
  };

  const exportRows = () => shown.map((r, i) => [
    i + 1, r.workOrderId ?? "", r.phoneNumber ?? "", r.centralName ?? "", r.serviceType ?? "",
    orderTypeOf(r.serviceType), r.itemName ?? "", r.techName ?? "",
    r.techKnown ? "" : (r.areaTechName ?? ""), fmtDate(r.closeDate),
  ]);

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLS, ...exportRows()]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بدون كمية سلك");
    XLSX.writeFile(wb, `work-orders-no-cable-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "أوامر شغل بدون كمية سلك",
      columns: COLS,
      rows: exportRows(),
    });
  };

  return (
    <Card className="p-4 sm:p-5 bg-white border-0 shadow-sm" dir="rtl">
      <div className="flex items-center gap-2 mb-1">
        <Cable className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold">أوامر شغل بدون كمية سلك</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        دى أوامر الشغل الناجحة اللى لسه مالهاش كمية سلك. اكتب الكمية قدام الرقم واضغط حفظ —
        هتتسجّل فى «استكمال البيانات» وتظهر فى تقرير أوامر الشغل، والصف هيختفى من هنا.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">من</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm w-40" dir="ltr" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">إلى</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="text-sm w-40" dir="ltr" />
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <label className="text-xs text-muted-foreground block mb-1">بحث</label>
          <Search className="absolute right-2 top-[30px] w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="رقم التليفون / أمر الشغل / الفنى" className="text-sm pr-8" dir="rtl" />
        </div>
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mb-2" />}
        <span className="text-sm text-muted-foreground mb-2">
          إجمالي: <strong>{shown.length}</strong> أمر شغل
        </span>
        <Button variant="outline" size="sm" onClick={handleExportExcel}
          disabled={shown.length === 0} className="text-green-700 border-green-200 gap-1 mb-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF}
          disabled={shown.length === 0} className="text-red-700 border-red-200 gap-1 mb-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table className="text-right text-sm" dir="rtl">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="text-right font-bold">#</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">رقم امر الشغل</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
              <TableHead className="text-right font-bold">اسم السنترال</TableHead>
              <TableHead className="text-right font-bold">نوع الخدمة</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">نوع امر الشغل</TableHead>
              <TableHead className="text-right font-bold">اسم الصنف</TableHead>
              <TableHead className="text-right font-bold">اسم الفنى</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الاغلاق</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">كمية السلك (متر)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  {isFetching ? "جارٍ التحميل…" : "مافيش أوامر شغل ناقصة كمية سلك فى المدة دى"}
                </TableCell>
              </TableRow>
            ) : shown.map((r, i) => {
              const v = qty[r.id] ?? "";
              const ok = validQty(v);
              const busy = saving === r.id;
              return (
                <TableRow key={r.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono">{r.workOrderId ?? "-"}</TableCell>
                  <TableCell className="font-mono font-semibold text-blue-700">{r.phoneNumber ?? "-"}</TableCell>
                  <TableCell>{r.centralName || "-"}</TableCell>
                  <TableCell>{r.serviceType || "-"}</TableCell>
                  <TableCell>
                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-100 text-emerald-800">
                      {orderTypeOf(r.serviceType)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate">{r.itemName || "-"}</TableCell>
                  <TableCell>
                    {r.techKnown ? (
                      <span className="whitespace-nowrap">{r.techName || "-"}</span>
                    ) : canEditTech ? (
                      // الاسم مش مطابق لأى فنى مسجّل → دروب ليست بأسماء الفنيين
                      <div className="flex items-center gap-1">
                        <select
                          value=""
                          disabled={savingTech === r.id}
                          onChange={(e) => { if (e.target.value) void saveTech(r, e.target.value); }}
                          className="border rounded-md px-2 py-1 text-xs max-w-[150px]"
                          dir="rtl"
                          title={`الاسم الحالى: ${r.techName || "—"} — مش مطابق لأى فنى مسجّل. اختر الفنى الصحيح.`}
                        >
                          <option value="">{r.techName || "بدون اسم"} — اختر الفنى</option>
                          {techNames.map((t) => (
                            <option key={t.techName} value={t.techName}>{t.techName}</option>
                          ))}
                        </select>
                        {savingTech === r.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                      </div>
                    ) : (
                      <span className="whitespace-nowrap text-amber-700" title="مش مطابق لأى فنى مسجّل">
                        {r.techName || "-"}
                      </span>
                    )}
                    {/* فنى المنطقة من البيانات الفنية — بيوضّح المسئول لما الاسم مش معروف */}
                    {!r.techKnown && r.areaTechName && (
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                        فنى المنطقة: {r.areaTechName}
                      </div>
                    )}
                    {!r.hasLineData && (
                      <div className="text-[11px] text-orange-700 flex items-center gap-1 whitespace-nowrap"
                        title="الرقم مالوش بيانات فنية — اتطلبت مراجعة بيان فنى تلقائياً">
                        <AlertTriangle className="w-3 h-3" /> مافيش بيانات فنية
                      </div>
                    )}
                  </TableCell>
                  <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap">{fmtDate(r.closeDate)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        inputMode="decimal"
                        value={v}
                        onChange={(e) => setRowQty(r.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && ok && !busy) void save(r); }}
                        placeholder="مثال: 12.5"
                        dir="ltr"
                        className="h-8 w-24 text-sm text-left"
                        disabled={busy}
                      />
                      <Button
                        size="sm" variant="outline"
                        onClick={() => void save(r)}
                        disabled={!ok || busy}
                        className="h-8 gap-1 text-primary border-primary/30 disabled:opacity-40"
                        title="حفظ كمية السلك لهذا الرقم"
                      >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        حفظ
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/RefreshButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Cable, Search, X } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

// أوامر شغل لسه مالهاش كمية سلك. كمية السلك مابتيجيش من ملف أوامر الشغل خالص —
// الفنى بيدخّلها من «استكمال بيانات»، فالتقرير ده بيوضّح اللى لسه ناقص إدخال.
interface Row {
  id: number;
  centralName: string | null;
  workOrderId: number | string | null;
  phoneNumber: string | null;
  serviceType: string | null;
  closeDate: string | null;
  itemName: string | null;
  techName: string | null;
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

const COLS = ["#", "رقم امر الشغل", "رقم التليفون", "رقم الموبايل", "اسم السنترال", "نوع الخدمة", "اسم الصنف", "اسم الفنى", "تاريخ الاغلاق"];

export function WorkOrdersNoCableReport() {
  // الافتراضى: من أول يوم فى الشهر الحالى إلى اليوم — وقابل للتغيير
  const [dateFrom, setDateFrom] = useState(cairoMonthStart);
  const [dateTo, setDateTo] = useState(cairoToday);
  const [search, setSearch] = useState("");

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
  const mobileLookup = useMobileLookup(rows.map((r) => r.phoneNumber));

  // بحث محلى فورى (أرقام فقط لرقم التليفون/أمر الشغل، ونص للأسماء)
  const shown = useMemo(() => {
    const s = search.trim();
    if (!s) return rows;
    const digits = s.replace(/\D/g, "");
    const low = s.toLowerCase();
    return rows.filter((r) => {
      if (digits && (String(r.phoneNumber ?? "").replace(/\D/g, "").includes(digits)
                  || String(r.workOrderId ?? "").includes(digits))) return true;
      return [r.techName, r.centralName, r.serviceType].some((v) => String(v ?? "").toLowerCase().includes(low));
    });
  }, [rows, search]);

  const asRow = (r: Row, i: number) => [
    i + 1, r.workOrderId ?? "-", r.phoneNumber ?? "-", r.centralName ?? "-",
    r.serviceType ?? "-", r.itemName ?? "-", r.techName ?? "-", fmtDate(r.closeDate),
  ];

  const handleExportExcel = () => {
    const out = shown.map((r, i) => Object.fromEntries(COLS.map((c, ci) => [c, asRow(r, i)[ci]])));
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بدون كمية سلك");
    XLSX.writeFile(wb, `work-orders-no-cable-${dateFrom}_${dateTo}.xlsx`);
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: `أوامر شغل بدون كمية سلك (${dateFrom} → ${dateTo})`,
      columns: COLS,
      rows: shown.map((r, i) => asRow(r, i)),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Cable className="w-4 h-4 text-orange-600" />
                أوامر شغل بدون كمية سلك
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                أوامر شغل الفنى لسه ما دخّلش لها كمية السلك من «استكمال بيانات».
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RefreshButton queryKeys={["/api/reports/work-orders-no-cable"]} />
              <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!shown.length} className="text-green-700 border-green-200">
                تصدير Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!shown.length} className="text-red-700 border-red-200">
                تصدير PDF
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">من تاريخ:</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="border rounded-md text-sm px-2 py-1.5 bg-white" />
            <label className="text-xs text-muted-foreground whitespace-nowrap">إلى تاريخ:</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="border rounded-md text-sm px-2 py-1.5 bg-white" />
            <button
              onClick={() => { setDateFrom(cairoMonthStart()); setDateTo(cairoToday()); }}
              className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
              title="رجوع للفترة الافتراضية: من أول الشهر إلى اليوم"
            >
              الشهر الحالى
            </button>

            <div className="flex-1 min-w-[200px] relative">
              <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم التليفون أو أمر الشغل أو الفنى…" className="text-sm pr-8 h-9" />
              {search && (
                <button type="button" onClick={() => setSearch("")} title="مسح البحث"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              إجمالى: <strong className="text-foreground">{shown.length}</strong> أمر شغل
              {search && <span className="text-xs"> (من {rows.length})</span>}
            </span>
          </div>
        </div>

        {isFetching && !rows.length ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="overflow-x-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-orange-800">
                <TableRow>
                  {COLS.map((c) => <TableHead key={c} className="text-white font-bold text-center">{c}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 ? (
                  <TableRow><TableCell colSpan={COLS.length} className="text-center py-14 text-muted-foreground">
                    {search ? "مفيش نتائج مطابقة للبحث" : "كل أوامر الشغل فى الفترة دى متسجّل لها كمية سلك 🎉"}
                  </TableCell></TableRow>
                ) : shown.map((r, i) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
                    <TableCell className="text-center text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-center font-mono">{r.workOrderId ?? "-"}</TableCell>
                    <TableCell className="text-center font-mono font-semibold text-blue-700">{r.phoneNumber ?? "-"}</TableCell>
                    <TableCell><MobileValue mobile={mobileLookup[phoneLookupKey(r.phoneNumber)]} /></TableCell>
                    <TableCell>{r.centralName ?? "-"}</TableCell>
                    <TableCell className="text-center">{r.serviceType ?? "-"}</TableCell>
                    <TableCell className="text-center">{r.itemName ?? "-"}</TableCell>
                    <TableCell>{r.techName ?? "-"}</TableCell>
                    <TableCell className="text-center">{fmtDate(r.closeDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PackageCheck, Search, FileSpreadsheet, Printer, Phone } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { format } from "date-fns";

// «متعذرات OM بوكس مليان تمت مراجعتها» — البكسيات اللى فنى الصيانة خلّص فيها بند
// «مراجعة بيانات البكس». البكس بيوصل موقع الصيانة أول ما فنى يرد «بوكس مليان»
// (من متعذرات OM أو من الطلبات)، ومعاه أرقام البكس من بيان التليفونات.
interface Row {
  inspectionId: number;
  central: string | null;
  cabinet: string | null;
  box: string | null;
  openedBy: string | null;
  origin: string | null;
  originRef: string | null;
  inspectionDate: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewedBy: string | null;
  phonesCount: number;
  boxStatus: string | null;
}

const cairoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const cairoMonthStart = () => cairoToday().slice(0, 8) + "01";

const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const COLS = ["#", "السنترال", "الكابينة", "البكس", "اتفتح بواسطة", "المصدر", "المرجع",
  "عدد الأرقام", "راجعها", "تاريخ المراجعة"];

export function BoxFullReviewedReport() {
  const [dateFrom, setDateFrom] = useState(cairoMonthStart);
  const [dateTo, setDateTo] = useState(cairoToday);
  const [search, setSearch] = useState("");
  const [openPhones, setOpenPhones] = useState<Row | null>(null);

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/reports/box-full-reviewed", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/reports/box-full-reviewed?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
    refetchOnMount: "always",
  });

  const { data: phones = [], isFetching: phonesLoading } = useQuery<{ phone: string; notes: string; source: string }[]>({
    queryKey: ["/api/reports/box-full-reviewed/phones", openPhones?.inspectionId],
    enabled: !!openPhones,
    queryFn: async () => {
      const res = await fetch(`/api/reports/box-full-reviewed/${openPhones!.inspectionId}/phones`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const shown = useMemo(() => {
    const s = search.trim();
    if (!s) return rows;
    const digits = s.replace(/\D/g, "");
    const low = s.toLowerCase();
    return rows.filter((r) => {
      if (digits && [r.box, r.cabinet, r.originRef].some((v) => String(v ?? "").includes(digits))) return true;
      return [r.central, r.cabinet, r.box, r.openedBy, r.reviewedByName, r.origin]
        .some((v) => String(v ?? "").toLowerCase().includes(low));
    });
  }, [rows, search]);

  const exportRows = () => shown.map((r, i) => [
    i + 1, r.central ?? "", r.cabinet ?? "", r.box ?? "", r.openedBy ?? "", r.origin ?? "",
    r.originRef ?? "", r.phonesCount, r.reviewedByName || r.reviewedBy || "", fmtDt(r.reviewedAt),
  ]);

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLS, ...exportRows()]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بوكس مليان تمت مراجعتها");
    XLSX.writeFile(wb, `box-full-reviewed-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };
  const handleExportPDF = () =>
    printTablePDF({ title: "متعذرات OM بوكس مليان — تمت مراجعتها", columns: COLS, rows: exportRows() });

  return (
    <Card className="p-4 sm:p-5 bg-white border-0 shadow-sm" dir="rtl">
      <div className="flex items-center gap-2 mb-1">
        <PackageCheck className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold">متعذرات OM بوكس مليان — تمت مراجعتها</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        البكسيات اللى فنى الصيانة خلّص فيها بند <strong>«مراجعة بيانات البكس»</strong>.
        البكس بيروح لموقع الصيانة أول ما فنى يرد «بوكس مليان» — من متعذرات OM أو من
        الطلبات — ومعاه أرقام البكس من بيان التليفونات.
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
            placeholder="البكس / الكابينة / الفنى" className="text-sm pr-8" dir="rtl" />
        </div>
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mb-2" />}
        <span className="text-sm text-muted-foreground mb-2">
          إجمالي: <strong>{shown.length}</strong> بكس
        </span>
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={shown.length === 0}
          className="text-green-700 border-green-200 gap-1 mb-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={shown.length === 0}
          className="text-red-700 border-red-200 gap-1 mb-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table className="text-right text-sm" dir="rtl">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="text-right font-bold">#</TableHead>
              <TableHead className="text-right font-bold">السنترال</TableHead>
              <TableHead className="text-right font-bold">الكابينة</TableHead>
              <TableHead className="text-right font-bold">البكس</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">اتفتح بواسطة</TableHead>
              <TableHead className="text-right font-bold">المصدر</TableHead>
              <TableHead className="text-right font-bold">المرجع</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">الأرقام</TableHead>
              <TableHead className="text-right font-bold">راجعها</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">تاريخ المراجعة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  {isFetching ? "جارٍ التحميل…" : "مافيش بكسيات اتراجعت فى المدة دى"}
                </TableCell>
              </TableRow>
            ) : shown.map((r, i) => (
              <TableRow key={r.inspectionId} className="hover:bg-muted/30 transition-colors">
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                <TableCell className="font-medium">{r.cabinet || "-"}</TableCell>
                <TableCell className="font-medium text-blue-700">{r.box || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.openedBy || "-"}</TableCell>
                <TableCell>
                  {r.origin ? (
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      r.origin === "OM" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"
                    }`}>{r.origin}</span>
                  ) : "-"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.originRef || "-"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => setOpenPhones(r)}
                    className="h-7 gap-1 text-blue-700" title="عرض الأرقام اللى راجعها الفنى">
                    <Phone className="w-3.5 h-3.5" /> {r.phonesCount}
                  </Button>
                </TableCell>
                <TableCell className="whitespace-nowrap">{r.reviewedByName || r.reviewedBy || "-"}</TableCell>
                <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap">{fmtDt(r.reviewedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {openPhones && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4"
          onClick={() => setOpenPhones(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-4 max-h-[80vh] overflow-auto"
            dir="rtl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-1">
              أرقام البكس {openPhones.box} — كابينة {openPhones.cabinet} · {openPhones.central}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              الأرقام بعد ما فنى الصيانة راجعها (شال الغلط وضاف الناقص).
            </p>
            {phonesLoading ? (
              <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
            ) : phones.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground">مافيش أرقام مسجّلة</p>
            ) : (
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-right font-bold">#</TableHead>
                    <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold">ملاحظات</TableHead>
                    <TableHead className="text-right font-bold">المصدر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {phones.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-semibold text-blue-700">{p.phone}</TableCell>
                      <TableCell className="text-xs">{p.notes || "-"}</TableCell>
                      <TableCell className="text-xs">
                        {p.source === "technician" ? "إضافة الفنى" : "من الموقع"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="mt-3 text-left">
              <Button variant="outline" size="sm" onClick={() => setOpenPhones(null)}>إغلاق</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

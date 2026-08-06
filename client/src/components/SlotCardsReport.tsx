import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/RefreshButton";
import { Loader2, Search, X, FileSpreadsheet, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// «الكروت (شيلف/سلوت)» — سطر لكل (كابينة MSAN + شيلف + سلوت) من ملف البورتات:
// عدد الشغّال عليه ونوع الكارت. مالوش أى علاقة بالمتعذرات — مصدره البورتات وحده.
//  • الشغّال = البورت اللى ليه فريم (نفس تعريف الشغّال فى باقى التقارير).
//  • نوع الكارت = نوع البورت الغالب على السلوت — الكارت واحد للسلوت كله فأى خط
//    جوّاه بيدلّ على نوعه. لو السلوت فيه أكتر من نوع بيتكتب جنبه تنبيه.
interface Row {
  msanCode: string | null;
  shelf: string | null;
  slot: string | null;
  workingCount: number;
  portsCount: number;
  cardType: string | null;
  cardTypeCount: number;
}

const COLS: [string, (r: Row) => any][] = [
  ["كود كابينة المسان", (r) => r.msanCode],
  ["شيلف", (r) => r.shelf],
  ["سلوت", (r) => r.slot],
  ["عدد الشغال", (r) => r.workingCount],
  ["نوع الكارت", (r) => (r.cardType || "-") + (r.cardTypeCount > 1 ? ` (+${r.cardTypeCount - 1} نوع تانى)` : "")],
];

export function SlotCardsReport() {
  const [q, setQ] = useState("");
  // فلتر «الشغال أقل من N» — السلوتات اللى قربت تفضى أو شبه فاضية
  const [workingLt, setWorkingLt] = useState("");

  const url = `/api/phone-ports/slot-cards?q=${encodeURIComponent(q)}&workingLt=${encodeURIComponent(workingLt)}`;
  const { data, isLoading } = useQuery({
    queryKey: [url],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "تعذّر التحميل");
      return res.json() as Promise<{ data: Row[]; total: number }>;
    },
    refetchOnMount: "always",
  });

  const rows = data?.data ?? [];
  const totalWorking = rows.reduce((s, r) => s + (r.workingCount || 0), 0);

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => Object.fromEntries(COLS.map(([h, f]) => [h, f(r) ?? ""]))),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الكروت");
    XLSX.writeFile(wb, "الكروت-شيلف-سلوت.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "الكروت (شيلف / سلوت) — من بيانات البورتات",
      columns: COLS.map(([h]) => h),
      rows: rows.map((r) => COLS.map(([, f]) => f(r) ?? "-")),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">الكروت (شيلف / سلوت)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              سطر لكل سلوت من ملف البورتات: عدد الخطوط الشغّالة عليه ونوع الكارت (من نوع البورت
              لأى خط جوّه السلوت). الشغّال = الخط اللى ليه فريم.
              {data && (
                <span className="text-purple-600">
                  {" "}({data.total.toLocaleString("ar-EG")} سلوت — {totalWorking.toLocaleString("ar-EG")} خط شغّال)
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث بكود المسان / الشيلف / السلوت / نوع الكارت…"
                className="h-9 w-72 pr-8 text-sm"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} title="مسح البحث"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <Input
              type="number" min={0} value={workingLt}
              onChange={(e) => setWorkingLt(e.target.value)}
              placeholder="الشغال أقل من…"
              title="يعرض السلوتات اللى عليها أقل من العدد ده من الخطوط الشغّالة"
              className="h-9 w-36 text-sm"
            />
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1 text-green-700 border-green-200">
              <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-1 text-red-700 border-red-200">
              <Printer className="w-4 h-4" /> تصدير PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-auto">
        {isLoading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">مفيش بيانات — ارفع ملف البورتات الأول</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLS.map(([h]) => <TableHead key={h} className="text-right whitespace-nowrap">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.msanCode}|${r.shelf}|${r.slot}|${i}`}>
                  {COLS.map(([h, f]) => (
                    <TableCell key={h} className="whitespace-nowrap text-sm">
                      {h === "عدد الشغال"
                        ? <span className="font-semibold">{r.workingCount}</span>
                        : (f(r) ?? "-")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

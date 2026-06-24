import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

interface BoxSummary {
  central: string;
  cabinNumber: string;
  boxNumber: string;
  count: number;
}

export function BoxLinesSummaryReport() {
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");

  const { data: allData, isLoading } = useQuery({
    queryKey: ["/api/phone-lines/box-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/phone-lines/box-summary?search=`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<BoxSummary[]>;
    },
  });

  const centrals = useMemo(() =>
    [...new Set((allData ?? []).map(r => r.central))].sort(), [allData]);
  const cabins = useMemo(() =>
    central ? [...new Set((allData ?? []).filter(r => r.central === central).map(r => r.cabinNumber))].sort() : [], [allData, central]);
  const boxes = useMemo(() =>
    central && cabin ? [...new Set((allData ?? []).filter(r => r.central === central && r.cabinNumber === cabin).map(r => r.boxNumber))].sort((a, b) => (+a || 0) - (+b || 0) || a.localeCompare(b)) : [], [allData, central, cabin]);

  const data = useMemo(() => {
    if (!allData) return [];
    return allData.filter(r =>
      (!central || r.central === central) &&
      (!cabin || r.cabinNumber === cabin) &&
      (!box || r.boxNumber === box)
    );
  }, [allData, central, cabin, box]);

  const handleExport = () => {
    if (!data.length) return;
    const rows = data.map((r) => ({
      "السنترال": r.central,
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "عدد الخطوط": r.count,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ملخص البكسيات");
    XLSX.writeFile(wb, "box-lines-summary.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "تقرير ملخص عدد الخطوط لكل بكس",
      columns: ["#", "السنترال", "رقم الكابينه", "رقم البكس", "عدد الخطوط"],
      rows: data.map((r, i) => [i + 1, r.central, r.cabinNumber, r.boxNumber, r.count]),
    });
  };

  const maxCount = data.length ? Math.max(...data.map((r) => r.count), 1) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">ملخص عدد الخطوط لكل بكس</h3>
            {allData && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.length.toLocaleString("ar-EG")} بكس — إجمالي {data.reduce((s, r) => s + r.count, 0).toLocaleString("ar-EG")} خط
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableCombobox
              options={centrals}
              value={central}
              onChange={(v) => { setCentral(v); setCabin(""); setBox(""); }}
              placeholder="كل السنترالات"
              searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={cabins}
              value={cabin}
              onChange={(v) => { setCabin(v); setBox(""); }}
              placeholder="كل الكباين"
              searchPlaceholder="ابحث في الكباين..."
              disabled={!central}
              className="w-full sm:w-36 text-sm"
            />
            <SearchableCombobox
              options={boxes}
              value={box}
              onChange={(v) => setBox(v)}
              placeholder="كل البكسيات"
              searchPlaceholder="ابحث في البكسيات..."
              disabled={!cabin}
              className="w-full sm:w-32 text-sm"
            />
            <Button variant="outline" size="sm" onClick={handleExport} className="text-green-700 border-green-200">
              تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!data.length} className="text-red-700 border-red-200">
              تصدير PDF
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold w-12">#</TableHead>
                  <TableHead className="text-right font-bold">السنترال</TableHead>
                  <TableHead className="text-right font-bold">رقم الكابينه</TableHead>
                  <TableHead className="text-right font-bold">رقم البكس</TableHead>
                  <TableHead className="text-right font-bold">عدد الخطوط</TableHead>
                  <TableHead className="text-right font-bold w-48">نسبة الامتلاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r, idx) => {
                  const pct = Math.round((r.count / maxCount) * 100);
                  const color = r.count >= 10 ? "bg-red-500" : r.count >= 5 ? "bg-orange-400" : "bg-green-500";
                  return (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.central}</TableCell>
                      <TableCell className="font-medium">{r.cabinNumber || "-"}</TableCell>
                      <TableCell className="font-medium">{r.boxNumber || "-"}</TableCell>
                      <TableCell>
                        <span className={`font-bold text-base ${r.count >= 10 ? "text-red-600" : r.count >= 5 ? "text-orange-600" : "text-green-700"}`}>
                          {r.count}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-8">{r.count}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

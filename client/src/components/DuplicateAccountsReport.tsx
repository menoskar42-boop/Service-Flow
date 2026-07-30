import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// خطوط تليفون مختلفة لكن لها نفس رقم الأكونت — تجميع لكل رقم أكونت الخطوط المتعارضة معه
interface DupRow {
  accountNo: string;
  fullPhone: string;
  telNo: string | null;
  central: string | null;
  cabinNumber: string | null;
  boxNumber: string | null;
  source: string;
  sourceLabel: string;
  updatedByName: string | null;
  updatedAt: string | null;
}

const fmtTime = (t: string | null) => {
  if (!t) return "—";
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  return d.toLocaleString("ar-EG", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
};

export function DuplicateAccountsReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/duplicate-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/reports/duplicate-accounts", { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json() as Promise<{ data: DupRow[]; groups: number; lines: number }>;
    },
    refetchOnMount: "always",
  });
  const rows = data?.data ?? [];

  const handleExportExcel = () => {
    const out = rows.map((r) => ({
      "رقم الأكونت": r.accountNo,
      "رقم التليفون الكامل": r.fullPhone,
      "رقم التليفون": r.telNo ?? "",
      "السنترال": r.central ?? "",
      "رقم الكابينة": r.cabinNumber ?? "",
      "رقم البكس": r.boxNumber ?? "",
      "المصدر": r.sourceLabel,
      "أدخله": r.updatedByName ?? "—",
      "تاريخ الإدخال": fmtTime(r.updatedAt),
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أكونتات مكررة");
    XLSX.writeFile(wb, "duplicate-accounts.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "خطوط مختلفة بنفس رقم الأكونت",
      columns: ["رقم الأكونت", "رقم التليفون", "السنترال", "الكابينة", "البكس", "المصدر", "أدخله", "التاريخ"],
      rows: rows.map((r) => [
        r.accountNo, r.telNo ?? r.fullPhone, r.central ?? "—", r.cabinNumber ?? "—",
        r.boxNumber ?? "—", r.sourceLabel, r.updatedByName ?? "—", fmtTime(r.updatedAt),
      ]),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              خطوط مختلفة لها نفس رقم الأكونت
            </h3>
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data?.groups ?? 0} رقم أكونت مكرر — على {rows.length} خط تليفون
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!rows.length} className="text-green-700 border-green-200">
              تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!rows.length} className="text-red-700 border-red-200">
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
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الأكونت</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الكابينة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">البكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">المصدر</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">أدخله</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الإدخال</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  let lastAccount = "";
                  return rows.map((r, i) => {
                    const isNewGroup = r.accountNo !== lastAccount;
                    lastAccount = r.accountNo;
                    return (
                      <TableRow key={r.fullPhone + i} className={`hover:bg-muted/30 transition-colors ${isNewGroup ? "border-t-2 border-t-amber-300" : ""}`}>
                        <TableCell dir="ltr" className="font-mono text-left font-bold text-amber-700">{r.accountNo}</TableCell>
                        <TableCell className="font-mono font-semibold text-blue-700" dir="ltr">{r.telNo ?? r.fullPhone}</TableCell>
                        <TableCell>{r.central ?? "—"}</TableCell>
                        <TableCell className="text-center">{r.cabinNumber ?? "—"}</TableCell>
                        <TableCell className="text-center">{r.boxNumber ?? "—"}</TableCell>
                        <TableCell>
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-700">{r.sourceLabel}</span>
                        </TableCell>
                        <TableCell>{r.updatedByName ?? "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtTime(r.updatedAt)}</TableCell>
                      </TableRow>
                    );
                  });
                })()}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      لا توجد أرقام أكونت مكررة حالياً 🎉
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

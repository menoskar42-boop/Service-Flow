import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";

interface PhoneLine {
  telNo: string;
  central: string;
  iduNo: string;
  oduNo: string;
  cabinNumber: string;
  primaryBlockNo: string;
  cabinetIn: string;
  secBlockNo: string;
  cabinetOut: string;
  boxNumber: string;
  dpTerminal: string;
  port: string;
  len: string;
  fiberBlock: string;
  fiberOut: string;
  telNumTxt: string;
  fullPhone: string;
}

const PAGE_SIZE = 50;

export function PhoneLinesReport() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimer) clearTimeout(searchTimer);
    const t = setTimeout(() => setDebouncedSearch(val), 400);
    setSearchTimer(t);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["/api/phone-lines", debouncedSearch, page],
    queryFn: async () => {
      const params = new URLSearchParams({ search: debouncedSearch, page: String(page), limit: String(PAGE_SIZE) });
      const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: PhoneLine[]; total: number; page: number; pageSize: number }>;
    },
  });

  // Export all matching records (fetch with high limit)
  const handleExport = async () => {
    const params = new URLSearchParams({ search: debouncedSearch, page: "1", limit: "20000" });
    const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as PhoneLine[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "السنترال": r.central,
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "رقم التليفون": r.telNo,
      "IDU": r.iduNo,
      "ODU": r.oduNo,
      "Primary Block": r.primaryBlockNo,
      "Cabinet In": r.cabinetIn,
      "Sec Block": r.secBlockNo,
      "Cabinet Out": r.cabinetOut,
      "DP Terminal": r.dpTerminal,
      "Port": r.port,
      "LEN": r.len,
      "Fiber Block": r.fiberBlock,
      "Fiber Out": r.fiberOut,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيان التليفونات");
    XLSX.writeFile(wb, "phone-lines-report.xlsx");
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">بيان أرقام التليفونات</h3>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.total.toLocaleString("ar-EG")} سجل
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم التليفون / السنترال / الكابينه / البكس..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pr-10 text-right text-sm"
                dir="rtl"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} className="text-green-700 border-green-200">
              تصدير Excel
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون الكامل</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينه</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">IDU</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">ODU</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Primary Block</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Cabinet In</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Sec Block</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Cabinet Out</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">DP Terminal</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Port</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">LEN</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Fiber Block</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Fiber Out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((r, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                      <TableCell className="font-medium">{r.cabinNumber || "-"}</TableCell>
                      <TableCell className="font-medium">{r.boxNumber || "-"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{r.telNo || "-"}</TableCell>
                      <TableCell>{r.iduNo || "-"}</TableCell>
                      <TableCell>{r.oduNo || "-"}</TableCell>
                      <TableCell>{r.primaryBlockNo || "-"}</TableCell>
                      <TableCell>{r.cabinetIn || "-"}</TableCell>
                      <TableCell>{r.secBlockNo || "-"}</TableCell>
                      <TableCell>{r.cabinetOut || "-"}</TableCell>
                      <TableCell>{r.dpTerminal || "-"}</TableCell>
                      <TableCell>{r.port || "-"}</TableCell>
                      <TableCell>{r.len || "-"}</TableCell>
                      <TableCell>{r.fiberBlock || "-"}</TableCell>
                      <TableCell>{r.fiberOut || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-4 border-t flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronRight className="w-4 h-4 ml-1" />
                  السابق
                </Button>
                <span className="text-sm text-muted-foreground">
                  صفحة {page} من {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  التالي
                  <ChevronLeft className="w-4 h-4 mr-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

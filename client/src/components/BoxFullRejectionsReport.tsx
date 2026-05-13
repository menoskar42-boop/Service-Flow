import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type Order, ORDER_STATUS, REJECTION_REASONS } from "@shared/schema";
import { Search } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import * as XLSX from "xlsx";

interface BoxSummary {
  central: string;
  cabinNumber: string;
  boxNumber: string;
  count: number;
}

interface BoxFullRejectionsReportProps {
  orders: Order[];
}

export function BoxFullRejectionsReport({ orders }: BoxFullRejectionsReportProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: boxSummaryData } = useQuery({
    queryKey: ["/api/phone-lines/box-summary"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/box-summary?search=", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch box summary");
      return res.json() as Promise<BoxSummary[]>;
    },
  });

  const workingMap = new Map<string, number>();
  boxSummaryData?.forEach((b) => {
    const key = `${b.central}||${b.cabinNumber}||${b.boxNumber}`;
    workingMap.set(key, b.count);
  });

  const boxFullOrders = orders.filter(
    (o) =>
      (o.status === ORDER_STATUS.NOT_FEASIBLE || o.status === ORDER_STATUS.EXTERNAL_NOT_FEASIBLE) &&
      o.rejectionReason === REJECTION_REASONS.BOX_FULL &&
      o.boxNumber
  );

  const rows = boxFullOrders.map((o) => {
    const key = `${o.centralName}||${o.cabinNumber}||${o.boxNumber}`;
    const workingCount = workingMap.has(key) ? workingMap.get(key)! : null;
    return {
      orderId: o.id,
      date: o.createdAt,
      customerName: o.customerName,
      customerAddress: o.customerAddress,
      centralName: o.centralName || "-",
      cabinNumber: o.cabinNumber || "-",
      boxNumber: o.boxNumber || "-",
      nearestBoxDistance: o.nearestBoxDistance || null,
      additionalNotes: o.additionalNotes || null,
      techName: o.techName || "-",
      isExternal: o.status === ORDER_STATUS.EXTERNAL_NOT_FEASIBLE,
      workingCount,
    };
  });

  const uniqueBoxes = new Set(rows.map((r) => `${r.centralName}||${r.cabinNumber}||${r.boxNumber}`)).size;
  const noMatchCount = rows.filter((r) => r.workingCount === null).length;

  const boxRejectCount: Record<string, { count: number; boxNumber: string }> = {};
  rows.forEach((r) => {
    const key = `${r.centralName}||${r.cabinNumber}||${r.boxNumber}`;
    if (!boxRejectCount[key]) boxRejectCount[key] = { count: 0, boxNumber: r.boxNumber };
    boxRejectCount[key].count++;
  });
  const topEntry = Object.values(boxRejectCount).sort((a, b) => b.count - a.count)[0];

  const filtered = rows.filter((row) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const workingText = row.workingCount !== null ? String(row.workingCount) : "لا يوجد في بيان التليفونات";
    return (
      row.customerName.toLowerCase().includes(q) ||
      row.customerAddress.toLowerCase().includes(q) ||
      row.centralName.toLowerCase().includes(q) ||
      row.cabinNumber.toLowerCase().includes(q) ||
      row.boxNumber.toLowerCase().includes(q) ||
      row.techName.toLowerCase().includes(q) ||
      (row.nearestBoxDistance || "").toLowerCase().includes(q) ||
      (row.additionalNotes || "").toLowerCase().includes(q) ||
      workingText.includes(q)
    );
  });

  const handleExport = () => {
    const exportRows = rows.map((r) => ({
      "العميل": r.customerName,
      "العنوان": r.customerAddress,
      "السنترال": r.centralName,
      "الكابينة": r.cabinNumber,
      "رقم البوكس": r.boxNumber,
      "بعد أقرب بوكس": r.nearestBoxDistance || "",
      "ملاحظات": r.additionalNotes || "",
      "عدد الشغال على البكس": r.workingCount !== null ? r.workingCount : "لا يوجد في بيان التليفونات",
      "الفني": r.techName,
      "التاريخ": format(new Date(r.date), "yyyy/MM/dd"),
      "المصدر": r.isExternal ? "شئون خارجية" : "فني",
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "متعذرات بوكس مليان");
    XLSX.writeFile(wb, "box-full-rejections.xlsx");
  };

  if (boxFullOrders.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground bg-white rounded-xl border border-dashed">
        <p>لا توجد متعذرات بسبب "بوكس مليان" حتى الآن</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border shadow-sm text-center">
          <div className="text-2xl font-bold text-red-600">{rows.length}</div>
          <div className="text-xs text-muted-foreground mt-1">إجمالي الحالات</div>
        </div>
        <div className="bg-white p-4 rounded-xl border shadow-sm text-center">
          <div className="text-2xl font-bold text-orange-600">{uniqueBoxes}</div>
          <div className="text-xs text-muted-foreground mt-1">بوكسات فريدة</div>
        </div>
        <div className="bg-white p-4 rounded-xl border shadow-sm text-center">
          <div className="text-2xl font-bold text-gray-500">{noMatchCount}</div>
          <div className="text-xs text-muted-foreground mt-1">حالات بدون تطابق في بيان التليفونات</div>
        </div>
        <div className="bg-white p-4 rounded-xl border shadow-sm text-center">
          <div className="text-2xl font-bold text-blue-600">{topEntry?.count || 0}</div>
          <div className="text-xs text-muted-foreground mt-1">
            أعلى بكس متعذر — بوكس {topEntry?.boxNumber || "-"}
          </div>
        </div>
      </div>

      {/* Main Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3" dir="rtl">
          <div>
            <h3 className="font-semibold text-base">متعذرات بوكس مليان</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{rows.length} حالة</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10 text-right text-sm"
                dir="rtl"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} className="text-green-700 border-green-200">
              تصدير Excel
            </Button>
          </div>
        </div>

        {searchQuery && (
          <div className="px-4 pb-2 text-sm text-muted-foreground" dir="rtl">
            النتائج: {filtered.length} من {rows.length}
          </div>
        )}

        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-10">#</TableHead>
                <TableHead className="text-right font-bold">العميل</TableHead>
                <TableHead className="text-right font-bold">السنترال</TableHead>
                <TableHead className="text-right font-bold">الكابينة</TableHead>
                <TableHead className="text-right font-bold">رقم البوكس</TableHead>
                <TableHead className="text-right font-bold">بعد أقرب بوكس</TableHead>
                <TableHead className="text-right font-bold">ملاحظات</TableHead>
                <TableHead className="text-right font-bold">عدد الشغال على البكس</TableHead>
                <TableHead className="text-right font-bold">الفني</TableHead>
                <TableHead className="text-right font-bold">التاريخ</TableHead>
                <TableHead className="text-right font-bold">المصدر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row, idx) => (
                <TableRow key={row.orderId} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <div className="font-medium">{row.customerName}</div>
                    <div className="text-xs text-muted-foreground">{row.customerAddress}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{row.centralName}</TableCell>
                  <TableCell>{row.cabinNumber}</TableCell>
                  <TableCell>
                    <span className="font-bold text-red-700 bg-red-50 px-2 py-1 rounded">{row.boxNumber}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.nearestBoxDistance ? `${row.nearestBoxDistance} م` : "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-32 truncate">
                    {row.additionalNotes || "-"}
                  </TableCell>
                  <TableCell>
                    {row.workingCount !== null ? (
                      <Badge
                        variant="outline"
                        className={
                          row.workingCount >= 10
                            ? "bg-red-50 text-red-700 border-red-200"
                            : row.workingCount >= 5
                            ? "bg-orange-50 text-orange-700 border-orange-200"
                            : "bg-green-50 text-green-700 border-green-200"
                        }
                      >
                        {row.workingCount}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">لا يوجد في بيان التليفونات</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{row.techName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(row.date), "yyyy/MM/dd", { locale: ar })}
                  </TableCell>
                  <TableCell>
                    {row.isExternal ? (
                      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
                        شئون خارجية
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                        فني
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

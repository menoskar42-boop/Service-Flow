import { useState } from "react";
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
import { type Order, ORDER_STATUS } from "@shared/schema";
import { Search, BoxSelect } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

interface BoxRejectionReportProps {
  orders: Order[];
}

export function BoxRejectionReport({ orders }: BoxRejectionReportProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const rejectedOrders = orders.filter(
    (o) =>
      (o.status === ORDER_STATUS.NOT_FEASIBLE ||
        o.status === ORDER_STATUS.EXTERNAL_NOT_FEASIBLE) &&
      o.boxNumber
  );

  const rows = rejectedOrders.map((o) => ({
    orderId: o.id,
    date: o.createdAt,
    boxNumber: o.boxNumber || "-",
    centralName: o.centralName || "-",
    cabinNumber: o.cabinNumber || "-",
    rejectionReason: o.rejectionReason || "-",
    nearestBoxDistance: o.nearestBoxDistance || null,
    additionalNotes: o.additionalNotes || null,
    techName: o.techName || "-",
    customerName: o.customerName,
    customerAddress: o.customerAddress,
    isExternal: o.status === ORDER_STATUS.EXTERNAL_NOT_FEASIBLE,
  }));

  const filtered = rows.filter((row) => {
    const rowKey = `${row.centralName}||${row.cabinNumber}||${row.boxNumber}`;
    if (selectedKey && rowKey !== selectedKey) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      row.boxNumber.toLowerCase().includes(q) ||
      row.centralName.toLowerCase().includes(q) ||
      row.cabinNumber.toLowerCase().includes(q) ||
      row.rejectionReason.toLowerCase().includes(q) ||
      row.techName.toLowerCase().includes(q) ||
      row.customerName.toLowerCase().includes(q) ||
      row.customerAddress.toLowerCase().includes(q) ||
      row.orderId.toString().includes(q)
    );
  });

  // Summary: count per (central + cabin + box) composite key
  const boxSummary: Record<string, { central: string; cabinNumber: string; boxNumber: string; count: number; reasons: Set<string> }> = {};
  rows.forEach((row) => {
    const key = `${row.centralName}||${row.cabinNumber}||${row.boxNumber}`;
    if (!boxSummary[key]) {
      boxSummary[key] = { central: row.centralName, cabinNumber: row.cabinNumber, boxNumber: row.boxNumber, count: 0, reasons: new Set() };
    }
    boxSummary[key].count++;
    if (row.rejectionReason !== "-") {
      boxSummary[key].reasons.add(row.rejectionReason);
    }
  });

  const topBoxes = Object.entries(boxSummary)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  if (rejectedOrders.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground bg-white rounded-xl border border-dashed">
        <BoxSelect className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p>لا توجد بيانات تعذر مرتبطة ببوكسات حتى الآن</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border shadow-sm text-center">
          <div className="text-2xl font-bold text-red-600">{rows.length}</div>
          <div className="text-xs text-muted-foreground mt-1">إجمالي حالات التعذر</div>
        </div>
        <div className="bg-white p-4 rounded-xl border shadow-sm text-center">
          <div className="text-2xl font-bold text-orange-600">{Object.keys(boxSummary).length}</div>
          <div className="text-xs text-muted-foreground mt-1">بوكسات مختلفة</div>
        </div>
        <div className="bg-white p-4 rounded-xl border shadow-sm text-center">
          <div className="text-2xl font-bold text-blue-600">
            {topBoxes[0]?.[1].count || 0}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            أعلى تكرار — بوكس {topBoxes[0]?.[1].boxNumber || "-"}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border shadow-sm text-center">
          <div className="text-2xl font-bold text-purple-600">
            {rows.filter((r) => r.isExternal).length}
          </div>
          <div className="text-xs text-muted-foreground mt-1">تعذر من الشئون الخارجية</div>
        </div>
      </div>

      {/* Grouped Summary Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b" dir="rtl">
          <h3 className="font-semibold text-base">تقرير عدد المتعذرات لكل بوكس</h3>
          <p className="text-xs text-muted-foreground mt-0.5">مجمّع حسب السنترال + الكابينة + رقم البوكس</p>
        </div>
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-12">#</TableHead>
                <TableHead className="text-right font-bold">السنترال</TableHead>
                <TableHead className="text-right font-bold">الكابينة</TableHead>
                <TableHead className="text-right font-bold">رقم البوكس</TableHead>
                <TableHead className="text-right font-bold">عدد المتعذرات</TableHead>
                <TableHead className="text-right font-bold">التفاصيل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(boxSummary)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([key, val], idx) => (
                  <TableRow key={key} className={`hover:bg-muted/30 transition-colors ${selectedKey === key ? "bg-blue-50" : ""}`}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{val.central}</TableCell>
                    <TableCell className="text-sm">{val.cabinNumber}</TableCell>
                    <TableCell>
                      <span className="font-bold text-red-700 bg-red-50 px-2 py-1 rounded text-sm">{val.boxNumber}</span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          val.count >= 3
                            ? "bg-red-50 text-red-700 border-red-200"
                            : val.count >= 2
                            ? "bg-orange-50 text-orange-700 border-orange-200"
                            : "bg-yellow-50 text-yellow-700 border-yellow-200"
                        }
                      >
                        {val.count} متعذر
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                        onClick={() => setSelectedKey(selectedKey === key ? null : key)}
                      >
                        {selectedKey === key ? "إلغاء" : "عرض التفاصيل"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Report Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3" dir="rtl">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base">تقرير البوكسات المتعذرة</h3>
            {selectedKey && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                بوكس {boxSummary[selectedKey]?.boxNumber} — {boxSummary[selectedKey]?.central}
              </span>
            )}
          </div>
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
        </div>

        {searchQuery && (
          <div className="px-4 pb-2 text-sm text-muted-foreground" dir="rtl">
            النتائج: {filtered.length} من {rows.length}
          </div>
        )}

        <div className="overflow-x-auto">
          <Table className="text-right" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold">#</TableHead>
                <TableHead className="text-right font-bold">رقم البوكس</TableHead>
                <TableHead className="text-right font-bold">سبب التعذر</TableHead>
                <TableHead className="text-right font-bold">السنترال</TableHead>
                <TableHead className="text-right font-bold">الكابينة</TableHead>
                <TableHead className="text-right font-bold">العميل</TableHead>
                <TableHead className="text-right font-bold">الفني</TableHead>
                <TableHead className="text-right font-bold">التاريخ</TableHead>
                <TableHead className="text-right font-bold">المصدر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row, idx) => (
                <TableRow key={row.orderId} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <span className="font-bold text-red-700 bg-red-50 px-2 py-1 rounded text-sm">
                      {row.boxNumber}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium text-sm text-red-700">{row.rejectionReason}</div>
                      {row.nearestBoxDistance && (
                        <div className="text-xs text-muted-foreground">بعد: {row.nearestBoxDistance} م</div>
                      )}
                      {row.additionalNotes && (
                        <div className="text-xs text-muted-foreground">{row.additionalNotes}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{row.centralName}</TableCell>
                  <TableCell className="text-sm">{row.cabinNumber}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{row.customerName}</div>
                    <div className="text-xs text-muted-foreground">{row.customerAddress}</div>
                  </TableCell>
                  <TableCell className="text-sm">{row.techName}</TableCell>
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

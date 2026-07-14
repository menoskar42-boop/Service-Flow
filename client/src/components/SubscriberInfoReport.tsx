import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileSpreadsheet } from "lucide-react";
import { ReviewSubscriberInfoButton } from "@/components/ReviewSubscriberInfoButton";

interface Row {
  phoneNumber: string;
  central: string | null;
  subName: string | null;
  subAdd: string | null;
  workOrdDate: string | null;
  workOrdNo: string | null;
  fetchedAt: string | null;
  areaCode: string | null;
  msanCode: string | null;
  frame: string | null;
  portNumber: string | null;
  portType: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  operator: string | null;
}

export function SubscriberInfoReport() {
  const [q, setQ] = useState("");

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/line-subscriber-info", q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      const res = await fetch(`/api/line-subscriber-info?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        "رقم التليفون": r.phoneNumber,
        "السنترال": r.central ?? "",
        "اسم العميل": r.subName ?? "",
        "العنوان": r.subAdd ?? "",
        "تاريخ أمر الشغل": r.workOrdDate ?? "",
        "رقم أمر الشغل": r.workOrdNo ?? "",
        "MSAN": r.msanCode ?? "",
        "Frame": r.frame ?? "",
        "المنفذ": r.portNumber ?? "",
        "نوع المنفذ": r.portType ?? "",
        "حالة الصوت": r.voiceStatus ?? "",
        "حالة الداتا": r.dataStatus ?? "",
        "المشغّل": r.operator ?? "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "اسم وعنوان");
    XLSX.writeFile(wb, "subscriber-info.xlsx");
  };

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="بحث برقم التليفون / الاسم / العنوان / MSAN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm text-sm"
          dir="rtl"
        />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <span className="text-sm text-muted-foreground">إجمالي: <strong>{rows.length}</strong></span>
        <div className="flex-1" />
        <ReviewSubscriberInfoButton />
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={rows.length === 0} className="text-green-700 border-green-200 gap-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
      </div>

      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-fuchsia-50">
              <TableRow>
                <TableHead className="text-right font-bold w-8">#</TableHead>
                <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                <TableHead className="text-right font-bold">السنترال</TableHead>
                <TableHead className="text-right font-bold">اسم العميل</TableHead>
                <TableHead className="text-right font-bold">العنوان</TableHead>
                <TableHead className="text-right font-bold">تاريخ الأمر</TableHead>
                <TableHead className="text-right font-bold">رقم الأمر</TableHead>
                <TableHead className="text-right font-bold">MSAN</TableHead>
                <TableHead className="text-right font-bold">Frame</TableHead>
                <TableHead className="text-right font-bold">المنفذ</TableHead>
                <TableHead className="text-right font-bold">الصوت</TableHead>
                <TableHead className="text-right font-bold">الداتا</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center py-16 text-muted-foreground">
                  {isFetching ? "جاري التحميل..." : "لا توجد بيانات — اضغط «مراجعة الاسم والعنوان» لجلبها من FCC"}
                </TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={r.phoneNumber} className="hover:bg-muted/30">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell dir="ltr" className="text-left font-mono text-xs">{r.phoneNumber}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{r.central || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-normal break-words min-w-[140px]">{r.subName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-normal break-words min-w-[200px] max-w-[320px]">{r.subAdd || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{r.workOrdDate || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{r.workOrdNo || "—"}</TableCell>
                  <TableCell className="text-xs">{r.msanCode || "—"}</TableCell>
                  <TableCell className="text-xs">{r.frame || "—"}</TableCell>
                  <TableCell className="text-xs">{r.portNumber || "—"}</TableCell>
                  <TableCell className="text-xs">{r.voiceStatus || "—"}</TableCell>
                  <TableCell className="text-xs">{r.dataStatus || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

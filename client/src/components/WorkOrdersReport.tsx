import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Upload, FileDown, FileText, Loader2 } from "lucide-react";
import { ROLES } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

interface WorkOrder {
  id: number;
  centralName: string;
  workOrderId: number;
  phoneNumber: string;
  serviceType: string;
  closeDate: string;
  itemName: string | null;
  cableQuantity: string | null;
  techName: string;
}

const ROWS_PER_PDF_PAGE = 11;

export function WorkOrdersReport() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: orders = [], isFetching } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/work-orders?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/work-orders/import", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const text = await res.text();
      const json = JSON.parse(text);
      if (!res.ok) throw new Error(json.message || "خطأ");
      return json;
    },
    onSuccess: (data) => {
      toast({ title: "تم الاستيراد", description: `${data.inserted} امر شغل تم رفعهم`, duration: 4000 });
      qc.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: (e: Error) => {
      toast({ title: "خطأ في الاستيراد", description: e.message, variant: "destructive", duration: 5000 });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = "";
  };

  const formatDate = (d: string) =>
    format(new Date(d), "yyyy/MM/dd HH:mm", { locale: ar });

  // ── Excel export ──
  const handleExportExcel = () => {
    const rows = orders.map((o, i) => ({
      "#": i + 1,
      "اسم السنترال": o.centralName,
      "رقم امر الشغل": o.workOrderId,
      "رقم التليفون": o.phoneNumber,
      "نوع الخدمه": o.serviceType,
      "تاريخ الاغلاق": formatDate(o.closeDate),
      "اسم الصنف": o.itemName || "",
      "كميه السلك": o.cableQuantity || "",
      "اسم الفنى": o.techName,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "اوامر الشغل");
    XLSX.writeFile(wb, `work-orders-${dateFrom || "all"}-${dateTo || "all"}.xlsx`);
  };

  // ── PDF export — 11 rows per page ──
  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    // Arabic font fallback — use built-in latin + data is Arabic so we just
    // set RTL direction via column order reversal trick
    const pageTitle = `تقرير أوامر الشغل${dateFrom ? "  من " + dateFrom : ""}${dateTo ? "  إلى " + dateTo : ""}`;

    const head = [["#", "اسم السنترال", "رقم امر الشغل", "رقم التليفون", "نوع الخدمه", "تاريخ الاغلاق", "اسم الصنف", "كميه السلك", "اسم الفنى"]];

    const body = orders.map((o, i) => [
      String(i + 1),
      o.centralName,
      String(o.workOrderId),
      o.phoneNumber,
      o.serviceType,
      formatDate(o.closeDate),
      o.itemName || "",
      o.cableQuantity || "",
      o.techName,
    ]);

    // Chunk into pages of 11 rows each
    for (let start = 0; start < body.length; start += ROWS_PER_PDF_PAGE) {
      if (start > 0) doc.addPage();
      const chunk = body.slice(start, start + ROWS_PER_PDF_PAGE);
      const pageNum = Math.floor(start / ROWS_PER_PDF_PAGE) + 1;
      const totalPages = Math.ceil(body.length / ROWS_PER_PDF_PAGE);

      doc.setFontSize(13);
      doc.text(pageTitle, doc.internal.pageSize.width / 2, 12, { align: "center" });
      doc.setFontSize(9);
      doc.text(`صفحة ${pageNum} من ${totalPages}`, doc.internal.pageSize.width - 10, 12, { align: "right" });

      autoTable(doc, {
        head,
        body: chunk,
        startY: 18,
        styles: { font: "helvetica", fontSize: 8, halign: "right", cellPadding: 2 },
        headStyles: { fillColor: [30, 80, 160], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 252] },
        margin: { left: 8, right: 8 },
        tableWidth: "auto",
      });
    }

    doc.save(`work-orders-${dateFrom || "all"}-${dateTo || "all"}.pdf`);
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Controls */}
      <Card className="p-4 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          {/* Date range */}
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">من تاريخ</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">إلى تاريخ</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 text-sm" />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-muted-foreground">
                مسح
              </Button>
            )}
          </div>

          <div className="flex-1" />

          {/* Export buttons */}
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={orders.length === 0} className="text-green-700 border-green-200 gap-1">
            <FileDown className="w-4 h-4" />
            Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={orders.length === 0} className="text-red-700 border-red-200 gap-1">
            <FileText className="w-4 h-4" />
            PDF
          </Button>

          {/* Upload — admin only */}
          {user?.role === ROLES.ADMIN && (
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
              <Button
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={importMutation.isPending}
                className="gap-1"
              >
                {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                رفع تركيبات
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
        {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        <span>إجمالي: <strong className="text-foreground">{orders.length}</strong> امر شغل</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-10">#</TableHead>
                <TableHead className="text-right font-bold">اسم السنترال</TableHead>
                <TableHead className="text-right font-bold">رقم امر الشغل</TableHead>
                <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                <TableHead className="text-right font-bold">نوع الخدمه</TableHead>
                <TableHead className="text-right font-bold">تاريخ الاغلاق</TableHead>
                <TableHead className="text-right font-bold">اسم الصنف</TableHead>
                <TableHead className="text-right font-bold">كميه السلك</TableHead>
                <TableHead className="text-right font-bold">اسم الفنى</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-16 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد بيانات — اختر نطاق تاريخ أو ارفع ملف تركيبات"}
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((o, idx) => (
                  <TableRow key={o.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="whitespace-nowrap">{o.centralName}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{o.workOrderId}</span>
                    </TableCell>
                    <TableCell dir="ltr" className="text-left">{o.phoneNumber}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${o.serviceType.trim() === "نقل" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"}`}>
                        {o.serviceType.trim()}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(o.closeDate)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{o.itemName || "-"}</TableCell>
                    <TableCell className="text-center">{o.cableQuantity || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{o.techName}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

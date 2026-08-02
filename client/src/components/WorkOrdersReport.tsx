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
import { Upload, FileDown, FileText, Loader2, BarChart3 } from "lucide-react";
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

interface WorkOrdersReportProps {
  /** التصنيف: success (افتراضى) | fail | all */
  category?: "success" | "fail" | "all";
  /** true = التركيبات المتخطية زمن الإغلاق 24 ساعة (Success) */
  over24?: boolean;
  title?: string;
  /** إظهار زر رفع الملف (افتراضى للتقرير الرئيسى فقط) */
  showUpload?: boolean;
}

export function WorkOrdersReport({ category = "success", over24 = false, title, showUpload = true }: WorkOrdersReportProps = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: orders = [], isFetching } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders", dateFrom, dateTo, category, over24],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      if (category) p.set("category", category);
      if (over24) p.set("over24", "1");
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

  // ── PDF export — browser print, 11 rows per A4 landscape page ──
  const ROWS_PER_PAGE = 11;
  const handleExportPDF = () => {
    // الطباعة تقفل تعديل كميات السلك (استكمال بيانات) — تُعلَّم كل الإدخالات كمطبوعة
    fetch("/api/cable-entries/mark-printed", { method: "POST", credentials: "include" })
      .then(() => qc.invalidateQueries({ queryKey: ["/api/cable-entries"] }))
      .catch(() => {});
    const title = `تقرير أوامر الشغل${dateFrom ? " من " + dateFrom : ""}${dateTo ? " إلى " + dateTo : ""}`;
    const esc = (v: any) =>
      String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const headRow = `<tr>
      <th>#</th><th>اسم السنترال</th><th>رقم امر الشغل</th><th>رقم التليفون</th>
      <th>نوع الخدمه</th><th>تاريخ الاغلاق</th><th>اسم الصنف</th><th>كميه السلك</th><th>اسم الفنى</th>
    </tr>`;

    const totalPages = Math.max(1, Math.ceil(orders.length / ROWS_PER_PAGE));
    let pages = "";
    for (let p = 0; p < totalPages; p++) {
      const chunk = orders.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const body = chunk.map((o, ci) => `
        <tr>
          <td>${p * ROWS_PER_PAGE + ci + 1}</td>
          <td>${esc(o.centralName)}</td>
          <td>${esc(o.workOrderId)}</td>
          <td>${esc(o.phoneNumber)}</td>
          <td>${esc(o.serviceType)}</td>
          <td>${esc(formatDate(o.closeDate))}</td>
          <td>${esc(o.itemName || "")}</td>
          <td>${esc(o.cableQuantity || "")}</td>
          <td>${esc(o.techName)}</td>
        </tr>`).join("");
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          <div class="pageno">صفحة ${p + 1} من ${totalPages}</div>
          <table><thead>${headRow}</thead><tbody>${body}</tbody></table>
        </section>`;
    }

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(title)}</title>
      <style>
        body { font-family: Arial, "Segoe UI", sans-serif; font-size: 11px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 15px; margin: 0 0 4px; }
        .pageno { text-align: center; font-size: 10px; color: #64748b; margin-bottom: 8px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
        th { background: #1e50a0 !important; color: #ffffff !important; padding: 7px 4px;
          border: 1px solid #15407f; font-weight: bold; font-size: 12px; }
        td { border: 1px solid #ccc; padding: 5px 4px; text-align: right; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        .page { background: #fff; padding: 14px; margin: 12px auto; max-width: 1000px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0;
          padding: 10px 14px; display: flex; gap: 10px; align-items: center; z-index: 10; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px;
          padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
        .toolbar span { color: #475569; font-size: 12px; }
        @media print {
          body { background: #fff; }
          .toolbar { display: none; }
          .page { box-shadow: none; margin: 0; padding: 0; max-width: none; page-break-after: always; }
          .page:last-child { page-break-after: auto; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>في نافذة الطباعة اختر &quot;حفظ بصيغة PDF&quot; (Save as PDF) كوجهة الطباعة.</span>
      </div>
      ${pages}
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {title && <h2 className="text-lg font-bold">{title}</h2>}
      {/* Controls */}
      <Card className="p-4 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          {/* Date range */}
          <div className="flex flex-wrap items-end gap-2 w-full sm:w-auto">
            <div className="flex-1 sm:flex-none">
              <label className="text-xs text-muted-foreground block mb-1">من تاريخ</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-40 text-sm" />
            </div>
            <div className="flex-1 sm:flex-none">
              <label className="text-xs text-muted-foreground block mb-1">إلى تاريخ</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-40 text-sm" />
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

          {/* Upload — admin only, and only on the main report */}
          {showUpload && (user?.role === ROLES.ADMIN || user?.role === ROLES.SUPER_ADMIN) && (
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
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

          {/* جلب أوامر الشغل من WFM Reporting — سوبر أدمن فقط.
              سكربت التامبر منكى (wfm-voice-installation-raw.user.js) بيكمّل التدفّق
              لوحده: دخول → FO Raw Data Reports → Voice Installation Raw Data →
              آخر 30 يوم + Middle Upper/Asuit → Generate → Export → رفع تلقائى هنا. */}
          {showUpload && user?.role === ROLES.SUPER_ADMIN && (
            <Button
              size="sm"
              onClick={() => window.open("https://wfm.te.eg/WfmReports/#/login", "wfm_voice_raw")}
              className="gap-1 bg-rose-700 hover:bg-rose-800 text-white"
              title="يفتح WFM Reporting ويسجّل الدخول ويشغّل تقرير Voice Installation Raw Data (آخر 30 يوم) ثم يرفعه هنا تلقائياً"
            >
              <BarChart3 className="w-4 h-4" />
              جلب من WFM
            </Button>
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

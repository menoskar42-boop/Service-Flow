import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

interface EditRow {
  id: number;
  fullPhone: string;
  oldAccountNo: string | null;
  newAccountNo: string;
  editedByName: string | null;
  editedAt: string;
}

const fmtTime = (t: string | null) => {
  if (!t) return "—";
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  return d.toLocaleString("ar-EG", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
};

export function AccountEditsReport() {
  const [phoneFilter, setPhoneFilter] = useState("");
  const [editorFilter, setEditorFilter] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [searchEditor, setSearchEditor] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["/api/reports/account-edits", searchPhone, searchEditor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchPhone) params.set("phone", searchPhone);
      if (searchEditor) params.set("editor", searchEditor);
      const res = await fetch(`/api/reports/account-edits?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json() as Promise<EditRow[]>;
    },
  });

  const doSearch = () => { setSearchPhone(phoneFilter); setSearchEditor(editorFilter); };

  const handleExportExcel = () => {
    const data = rows.map((r) => ({
      "#": r.id,
      "رقم التليفون الكامل": r.fullPhone,
      "الأكونت القديم": r.oldAccountNo ?? "—",
      "الأكونت الجديد": r.newAccountNo,
      "القائم بالتعديل": r.editedByName ?? "—",
      "وقت التعديل": fmtTime(r.editedAt),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تعديلات الأكونت");
    XLSX.writeFile(wb, "account-edits.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "سجل تعديلات أرقام الأكونت",
      columns: ["#", "رقم التليفون", "الأكونت القديم", "الأكونت الجديد", "القائم بالتعديل", "وقت التعديل"],
      rows: rows.map((r) => [
        r.id, r.fullPhone, r.oldAccountNo ?? "—", r.newAccountNo,
        r.editedByName ?? "—", fmtTime(r.editedAt),
      ]),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">سجل تعديلات أرقام الأكونت</h3>
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {rows.length.toLocaleString("ar-EG")} سجل
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={phoneFilter}
              onChange={(e) => setPhoneFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="بحث برقم التليفون..."
              className="w-40 text-sm h-9"
              dir="ltr"
            />
            <Input
              value={editorFilter}
              onChange={(e) => setEditorFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="بحث باسم المستخدم..."
              className="w-44 text-sm h-9"
              dir="rtl"
            />
            <Button variant="outline" size="sm" onClick={doSearch} className="h-9">
              بحث
            </Button>
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="text-green-700 border-green-200">
              تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200">
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
                  <TableHead className="text-right font-bold whitespace-nowrap">#</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون الكامل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الأكونت القديم</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الأكونت الجديد</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">القائم بالتعديل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">وقت التعديل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground text-xs">{r.id}</TableCell>
                    <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone}</TableCell>
                    <TableCell dir="ltr" className="font-mono text-left text-muted-foreground">
                      {r.oldAccountNo ?? <span className="italic text-gray-400">جديد</span>}
                    </TableCell>
                    <TableCell dir="ltr" className="font-mono text-left font-semibold text-green-700">
                      {r.newAccountNo}
                    </TableCell>
                    <TableCell>{r.editedByName ?? "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtTime(r.editedAt)}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      لا توجد تعديلات مسجلة
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

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronRight, ChevronLeft, Loader2, Save, SaveAll, IdCard, Ban } from "lucide-react";
import { openCustomer360 } from "@/lib/customer360";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";

interface PhoneLine {
  id: number;
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
  fullPhone: string;
}

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const PAGE_SIZE = 50;

// افتراضى: من أول نفس الشهر السنة اللى فاتت (سنة للخلف) إلى اليوم
const monthStart = () => {
  const d = new Date();
  const p = new Date(d.getFullYear() - 1, d.getMonth(), 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}-01`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function RegularizedNoAccountReport() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user?.role !== ROLES.SALES;

  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(todayStr());
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, string>>({});
  const [bulkSaving, setBulkSaving] = useState(false);

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const buildParams = (forExport = false) => {
    const params = new URLSearchParams(
      forExport ? { page: "1", limit: "20000" } : { page: String(page), limit: String(PAGE_SIZE) },
    );
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    return params;
  };

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/regularized-no-account", dateFrom, dateTo, central, cabin, box, page],
    queryFn: async () => {
      const res = await fetch(`/api/reports/regularized-no-account?${buildParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: PhoneLine[]; total: number }>;
    },
  });

  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];

  const handleSave = async (fullPhone: string) => {
    const accountNo = (drafts[fullPhone] ?? "").trim();
    if (!accountNo) return;
    setSaveState((s) => ({ ...s, [fullPhone]: "saving" }));
    try {
      const res = await fetch(`/api/line-accounts/${encodeURIComponent(fullPhone)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNo }),
      });
      if (!res.ok) throw new Error("failed");
      setSaveState((s) => ({ ...s, [fullPhone]: "saved" }));
      setDrafts((d) => { const n = { ...d }; delete n[fullPhone]; return n; });
      qc.invalidateQueries({ queryKey: ["/api/reports/regularized-no-account"] });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/with-account"] });
    } catch {
      setSaveState((s) => ({ ...s, [fullPhone]: "error" }));
    }
  };

  // تعليم خط بأنه "بدون رقم أكونت" — يختفى من التقرير دون تسجيل رقم أكونت
  const handleMarkNoAccount = async (fullPhone: string) => {
    if (!confirm("تأكيد: هذا الخط ليس له رقم أكونت وسيختفى من التقرير؟")) return;
    setSaveState((s) => ({ ...s, [fullPhone]: "saving" }));
    try {
      const res = await fetch(`/api/lines-no-account/${encodeURIComponent(fullPhone)}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      qc.invalidateQueries({ queryKey: ["/api/reports/regularized-no-account"] });
    } catch {
      setSaveState((s) => ({ ...s, [fullPhone]: "error" }));
    }
  };

  const handleSaveAll = async () => {
    const entries = Object.entries(drafts)
      .map(([fullPhone, accountNo]) => ({ fullPhone, accountNo: (accountNo ?? "").trim() }))
      .filter((e) => e.accountNo);
    if (entries.length === 0) { alert("لا توجد أرقام أكونت مكتوبة للحفظ"); return; }
    setBulkSaving(true);
    setSaveState((s) => {
      const n = { ...s };
      entries.forEach((e) => { n[e.fullPhone] = "saving"; });
      return n;
    });
    try {
      const res = await fetch(`/api/line-accounts/bulk`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setDrafts({});
      setSaveState({});
      qc.invalidateQueries({ queryKey: ["/api/reports/regularized-no-account"] });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/with-account"] });
      alert(`تم حفظ ${json.saved ?? entries.length} رقم أكونت`);
    } catch {
      setSaveState((s) => {
        const n = { ...s };
        entries.forEach((e) => { n[e.fullPhone] = "error"; });
        return n;
      });
      alert("تعذّر الحفظ — حاول مرة أخرى");
    } finally {
      setBulkSaving(false);
    }
  };

  const draftCount = Object.values(drafts).filter((v) => (v ?? "").trim()).length;

  const handleExport = async () => {
    const res = await fetch(`/api/reports/regularized-no-account?${buildParams(true)}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as PhoneLine[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "السنترال": r.central,
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "رقم التليفون": r.telNo,
      "IDU": r.iduNo,
      "ODU": r.oduNo,
      "DP Terminal": r.dpTerminal,
      "Port": r.port,
      "LEN": r.len,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أعطال منتظمة بدون أكونت");
    XLSX.writeFile(wb, "regularized-no-account-report.xlsx");
  };

  const handleExportPDF = async () => {
    const res = await fetch(`/api/reports/regularized-no-account?${buildParams(true)}`, { credentials: "include" });
    const json = await res.json();
    const all = json.data as PhoneLine[];
    printTablePDF({
      title: `الأعطال المنتظمة بدون رقم أكونت (${dateFrom} → ${dateTo})`,
      columns: ["#", "التليفون الكامل", "السنترال", "الكابينه", "البكس", "التليفون", "IDU", "DP Terminal"],
      rows: all.map((r, i) => [i + 1, r.fullPhone, r.central, r.cabinNumber, r.boxNumber, r.telNo, r.iduNo, r.dpTerminal]),
    });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">الأعطال المنتظمة (فترة) بدون رقم أكونت</h3>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.total.toLocaleString("ar-EG")} سجل
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">من</span>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9 w-36 text-sm" />
              <span className="text-xs text-muted-foreground">إلى</span>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9 w-36 text-sm" />
            </div>
            <SearchableCombobox
              options={filterOptions?.centrals ?? []}
              value={central}
              onChange={(v) => { setCentral(v); setCabin(""); setBox(""); setPage(1); }}
              placeholder="كل السنترالات"
              searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={cabins}
              value={cabin}
              onChange={(v) => { setCabin(v); setBox(""); setPage(1); }}
              placeholder="كل الكباين"
              searchPlaceholder="ابحث في الكباين..."
              disabled={!central}
              className="w-full sm:w-40 text-sm"
            />
            <SearchableCombobox
              options={boxes}
              value={box}
              onChange={(v) => { setBox(v); setPage(1); }}
              placeholder="كل البكسيات"
              searchPlaceholder="ابحث في البكسيات..."
              disabled={!cabin}
              className="w-full sm:w-36 text-sm"
            />
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openCustomer360((data?.data ?? []).map((r) => r.fullPhone))}
                disabled={!data?.data?.length}
                className="gap-1 text-purple-700 border-purple-200 disabled:opacity-40"
                title="فتح Customer360 لجلب أرقام الأكونت لخطوط الصفحة الحالية تلقائياً"
              >
                <IdCard className="w-4 h-4" /> جلب الأكونت من Customer360
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveAll}
                disabled={draftCount === 0 || bulkSaving}
                className="gap-1 text-blue-700 border-blue-200 disabled:opacity-40"
                title="حفظ كل أرقام الأكونت المكتوبة دفعة واحدة"
              >
                {bulkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <SaveAll className="w-4 h-4" />}
                حفظ الكل{draftCount > 0 ? ` (${draftCount})` : ""}
              </Button>
            )}
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExport} className="text-green-700 border-green-200">
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
          <>
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون الكامل</TableHead>
                    {canEdit && <TableHead className="text-right font-bold whitespace-nowrap">تسجيل أكونت</TableHead>}
                    <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينه</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">IDU</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">ODU</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">DP Terminal</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Port</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">LEN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((r, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone || "-"}</TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex items-center gap-1" dir="ltr">
                            <Input
                              value={drafts[r.fullPhone] ?? ""}
                              onChange={(e) => {
                                setDrafts((d) => ({ ...d, [r.fullPhone]: e.target.value }));
                                setSaveState((s) => { const n = { ...s }; delete n[r.fullPhone]; return n; });
                              }}
                              onKeyDown={(e) => e.key === "Enter" && handleSave(r.fullPhone)}
                              placeholder="أكونت"
                              className="h-7 w-28 text-xs"
                              dir="ltr"
                            />
                            <button
                              type="button"
                              onClick={() => handleSave(r.fullPhone)}
                              disabled={!drafts[r.fullPhone]?.trim() || saveState[r.fullPhone] === "saving"}
                              title="حفظ"
                              className="text-green-600 hover:text-green-800 disabled:opacity-40"
                            >
                              {saveState[r.fullPhone] === "saving" ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMarkNoAccount(r.fullPhone)}
                              disabled={saveState[r.fullPhone] === "saving"}
                              title="ليس له رقم أكونت — إخفاء من التقرير"
                              className="text-orange-500 hover:text-orange-700 disabled:opacity-40"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                            {saveState[r.fullPhone] === "saved" && <span className="text-green-600 text-xs">✓</span>}
                            {saveState[r.fullPhone] === "error" && <span className="text-red-500 text-xs">!</span>}
                          </div>
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                      <TableCell className="font-medium">{r.cabinNumber || "-"}</TableCell>
                      <TableCell className="font-medium">{r.boxNumber || "-"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{r.telNo || "-"}</TableCell>
                      <TableCell>{r.iduNo || "-"}</TableCell>
                      <TableCell>{r.oduNo || "-"}</TableCell>
                      <TableCell>{r.dpTerminal || "-"}</TableCell>
                      <TableCell>{r.port || "-"}</TableCell>
                      <TableCell>{r.len || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="p-4 border-t flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronRight className="w-4 h-4 ml-1" />
                  السابق
                </Button>
                <span className="text-sm text-muted-foreground">صفحة {page} من {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
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

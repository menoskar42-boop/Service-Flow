import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { ChevronRight, ChevronLeft, Loader2, Radar, Pencil, Save, X } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { Measurement138Button, type Measurement138 } from "@/components/Measurement138Button";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";

const DZS_URL = "https://10.42.187.101:8080/expresse/";

type DZSItem = { account: string; complaint?: string | null; short?: string | null; full?: string | null };
const buildDZSUrl = (items: DZSItem[]) => {
  const accounts = items.map((it) => it.account);
  return `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;
};

interface PhoneLine extends Measurement138 {
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
  accountNo: string;
  accountSource: string;
}

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const PAGE_SIZE = 50;

const scoreBadge = (v: string | number | null | undefined) => {
  if (v == null || v === "") return <span className="text-gray-400">-</span>;
  const n = Number(v);
  if (isNaN(n)) return <span>{String(v)}</span>;
  const cls =
    n >= 70 ? "bg-green-100 text-green-800" :
    n >= 40 ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

export function WithAccountReport() {
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [page, setPage] = useState(1);
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role !== ROLES.SALES;

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["/api/phone-lines/with-account", central, cabin, box, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      const res = await fetch(`/api/phone-lines/with-account?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: PhoneLine[]; total: number; page: number; pageSize: number }>;
    },
  });

  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];

  const startEdit = (r: PhoneLine) => {
    setEditingPhone(r.fullPhone);
    setEditDraft(r.accountNo ?? "");
  };

  const cancelEdit = () => setEditingPhone(null);

  const handleSave = async (fullPhone: string) => {
    if (!editDraft.trim()) return;
    setSaveState((s) => ({ ...s, [fullPhone]: "saving" }));
    try {
      const res = await fetch(`/api/line-accounts/${encodeURIComponent(fullPhone)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountNo: editDraft.trim() }),
      });
      if (!res.ok) throw new Error("فشل الحفظ");
      setSaveState((s) => ({ ...s, [fullPhone]: "saved" }));
      setEditingPhone(null);
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/with-account"] });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/without-account"] });
      setTimeout(() => setSaveState((s) => { const n = { ...s }; delete n[fullPhone]; return n; }), 2000);
    } catch {
      setSaveState((s) => ({ ...s, [fullPhone]: "error" }));
    }
  };

  const toItem = (r: PhoneLine): DZSItem => ({
    account: (r.accountNo ?? "").toString().trim(),
    complaint: "",
    short: r.telNo ?? "",
    full: r.fullPhone ?? "",
  });

  const handleMeasureDZS = async () => {
    if (!central && !cabin && !box) {
      alert("اختر سنترال أو كابينة أو بكس أولاً — القياس يشتغل على النطاق المحدد فقط");
      return;
    }
    const win = window.open("", "_blank");
    try {
      const params = new URLSearchParams({ page: "1", limit: "20000" });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      const res = await fetch(`/api/phone-lines/with-account?${params}`, { credentials: "include" });
      const json = await res.json();
      const all = (json.data as PhoneLine[]) ?? [];
      const seen = new Set<string>();
      const items = all
        .map(toItem)
        .filter((it) => it.account && !seen.has(it.account) && seen.add(it.account));
      if (items.length === 0) {
        if (win) win.close();
        alert("لا توجد أرقام أكونت فى النطاق المحدد");
        return;
      }
      if (items.length > 150 && !confirm(`سيتم فتح DZS لقياس ${items.length} رقم — متأكد؟`)) {
        if (win) win.close();
        return;
      }
      const url = buildDZSUrl(items);
      if (win) win.location.href = url; else window.open(url, "_blank");
    } catch {
      if (win) win.close();
      alert("تعذّر تحميل بيانات النطاق للقياس");
    }
  };

  const openDZSSingle = (r: PhoneLine) => window.open(buildDZSUrl([toItem(r)]), "_blank");

  const handleExport = async () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    const res = await fetch(`/api/phone-lines/with-account?${params}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as PhoneLine[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "رقم الأكونت": r.accountNo,
      "مصدر الأكونت": r.accountSource === "manual" ? "يدوى" : "شيت 138",
      "آخر قياس": r.lastMeasScore,
      "السرعة الحالية": r.lineCurrentSpeed,
      "أقصى سرعة": r.lineMaxSpeed,
      "السنترال": r.central,
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "رقم التليفون": r.telNo,
      "IDU": r.iduNo,
      "ODU": r.oduNo,
      "Primary Block": r.primaryBlockNo,
      "Cabinet In": r.cabinetIn,
      "DP Terminal": r.dpTerminal,
      "Port": r.port,
      "LEN": r.len,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "خطوط لها أكونت");
    XLSX.writeFile(wb, "with-account-report.xlsx");
  };

  const handleExportPDF = async () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    const res = await fetch(`/api/phone-lines/with-account?${params}`, { credentials: "include" });
    const json = await res.json();
    const all = json.data as PhoneLine[];
    printTablePDF({
      title: "تقرير الخطوط التى لها رقم أكونت",
      columns: ["#", "التليفون الكامل", "الأكونت", "المصدر", "سرعة حالية", "أقصى سرعة", "السنترال", "الكابينه", "البكس", "IDU", "DP Terminal"],
      rows: all.map((r, i) => [i + 1, r.fullPhone, r.accountNo, r.accountSource === "manual" ? "يدوى" : "138",
        r.lineCurrentSpeed ?? "", r.lineMaxSpeed ?? "", r.central, r.cabinNumber, r.boxNumber, r.iduNo, r.dpTerminal]),
    });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">الخطوط التى لها رقم أكونت</h3>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.total.toLocaleString("ar-EG")} سجل
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              placeholder="كل الكابينات"
              searchPlaceholder="ابحث في الكابينات..."
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
            <Button variant="outline" size="sm" onClick={handleMeasureDZS} className="text-blue-700 border-blue-200 gap-1">
              <Radar className="w-4 h-4" /> قياس DZS
            </Button>
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
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الأكونت</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">المصدر</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">قياس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السرعة الحالية</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">أقصى سرعة</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">الاسكور</TableHead>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((r, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left font-mono">
                        {editingPhone === r.fullPhone ? (
                          <span className="inline-flex items-center gap-1">
                            <Input
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleSave(r.fullPhone); if (e.key === "Escape") cancelEdit(); }}
                              className="h-7 w-28 text-xs px-1"
                              dir="ltr"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleSave(r.fullPhone)}
                              disabled={saveState[r.fullPhone] === "saving"}
                              title="حفظ"
                              className="text-green-600 hover:text-green-800 disabled:opacity-40"
                            >
                              {saveState[r.fullPhone] === "saving"
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Save className="w-3.5 h-3.5" />}
                            </button>
                            <button type="button" onClick={cancelEdit} title="إلغاء" className="text-gray-400 hover:text-gray-700">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {r.accountNo}
                            <button
                              type="button"
                              onClick={() => openDZSSingle(r)}
                              title="فتح DZS وقياس هذا الرقم"
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Radar className="w-3.5 h-3.5" />
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => startEdit(r)}
                                title="تعديل رقم الأكونت"
                                className="text-amber-500 hover:text-amber-700"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                            {saveState[r.fullPhone] === "saved" && (
                              <span className="text-[10px] text-green-600">✓ حُفظ</span>
                            )}
                            {saveState[r.fullPhone] === "error" && (
                              <span className="text-[10px] text-red-600">خطأ</span>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.accountSource === "manual" ? (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-700">يدوى</span>
                        ) : (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700">شيت 138</span>
                        )}
                      </TableCell>
                      <TableCell><Measurement138Button m={r} /></TableCell>
                      <TableCell className="font-mono">{r.lineCurrentSpeed ?? "-"}</TableCell>
                      <TableCell className="font-mono">{r.lineMaxSpeed ?? "-"}</TableCell>
                      <TableCell>{scoreBadge(r.lastMeasScore)}</TableCell>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

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

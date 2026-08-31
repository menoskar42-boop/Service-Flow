import { useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, AlertCircle, Save, SaveAll, FileSpreadsheet, FileText, IdCard, Ban } from "lucide-react";
import { openCustomer360 } from "@/lib/customer360";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

interface OpenTicketLine {
  telNo: string;
  central: string;
  cabinNumber: string;
  boxNumber: string;
  fullPhone: string;
  iduNo: string;
  dpTerminal: string;
  accountNo: string | null;
  accountSource: string | null;
  lineCurrentSpeed: number | null;
  lineMaxSpeed: number | null;
  lastMeasScore: number | null;
  ticketNumber: string;
  faultType: string;
  ticketCreatedAt: string;
}

export function GroundFaultsNoAccountReport() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user?.role !== ROLES.SALES;

  const [lines, setLines] = useState<OpenTicketLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCentral, setFilterCentral] = useState("");
  const [filterCabinet, setFilterCabinet] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, string>>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const mobileLookup = useMobileLookup(lines.map((l) => l.telNo || l.fullPhone));

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proxy/cfm-open-ticket-lines", { credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error((j as any).message || `خطأ ${res.status}`);
      // فقط الخطوط التى ليس لها رقم أكونت
      setLines(((j.lines as OpenTicketLine[]) ?? []).filter((l) => !l.accountNo));
    } catch (e: any) {
      setError(e.message || "تعذّر التحميل");
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const centrals = useMemo(
    () => [...new Set(lines.map((l) => l.central).filter(Boolean))].sort(),
    [lines],
  );
  const cabinets = useMemo(
    () => [...new Set(
      lines.filter((l) => !filterCentral || l.central === filterCentral)
        .map((l) => l.cabinNumber).filter(Boolean),
    )].sort((a, b) => Number(a) - Number(b)),
    [lines, filterCentral],
  );

  const filtered = useMemo(
    () => lines.filter((l) => {
      if (filterCentral && l.central !== filterCentral) return false;
      if (filterCabinet && l.cabinNumber !== filterCabinet) return false;
      return true;
    }),
    [lines, filterCentral, filterCabinet],
  );

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
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.message || "فشل الحفظ");
      }
      setSaveState((s) => ({ ...s, [fullPhone]: "saved" }));
      setDrafts((d) => { const n = { ...d }; delete n[fullPhone]; return n; });
      // الخط بقى له أكونت — يختفى من القائمة
      setLines((ls) => ls.filter((l) => l.fullPhone !== fullPhone));
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/with-account"] });
    } catch (e: any) {
      setSaveState((s) => ({ ...s, [fullPhone]: "error" }));
      alert(e?.message || "تعذّر حفظ رقم الأكونت");
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
      setLines((ls) => ls.filter((l) => l.fullPhone !== fullPhone));
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
      const duplicates: { fullPhone: string; accountNo: string; conflictsWith: string }[] = Array.isArray(json.duplicates) ? json.duplicates : [];
      const dupPhones = new Set(duplicates.map((d) => d.fullPhone));
      // نشيل من القائمة بس الأرقام اللى اتحفظت فعلاً — نسيب المكرَّرة المرفوضة ظاهرة
      const savedSet = new Set(entries.map((e) => e.fullPhone).filter((p) => !dupPhones.has(p)));
      setDrafts({});
      setSaveState({});
      setLines((ls) => ls.filter((l) => !savedSet.has(l.fullPhone)));
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/with-account"] });
      const parts = [`تم حفظ ${json.saved ?? entries.length} رقم أكونت`];
      if (duplicates.length > 0) {
        parts.push(`⚠️ تم تجاهل ${duplicates.length} رقم (أكونت مستخدم بالفعل على خط تانى):`);
        duplicates.forEach((d) => parts.push(`  ${d.fullPhone} ← أكونت ${d.accountNo} مستخدم على ${d.conflictsWith}`));
      }
      alert(parts.join("\n"));
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

  const handleExportExcel = () => {
    const rows = filtered.map((l) => ({
      "رقم التذكرة": l.ticketNumber,
      "نوع العطل": l.faultType,
      "رقم التليفون الكامل": l.fullPhone,
      "رقم التليفون": l.telNo,
      "السنترال": l.central,
      "رقم الكابينه": l.cabinNumber,
      "رقم البكس": l.boxNumber,
      "IDU": l.iduNo,
      "DP Terminal": l.dpTerminal,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أعطال أرضية بدون أكونت");
    XLSX.writeFile(wb, "ground-faults-no-account.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "أعطال أرضية بدون رقم أكونت",
      columns: ["#", "التذكرة", "نوع العطل", "التليفون الكامل", "السنترال", "الكابينه", "البكس", "التليفون", "IDU", "DP Terminal"],
      rows: filtered.map((l, i) => [
        i + 1, l.ticketNumber, l.faultType, l.fullPhone, l.central, l.cabinNumber, l.boxNumber, l.telNo, l.iduNo, l.dpTerminal,
      ]),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">أعطال أرضية بدون رقم أكونت</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              خطوط على بكسيات لها تذكرة عطل شبكة أرضية مفتوحة وليس لها رقم أكونت — {filtered.length.toLocaleString("ar-EG")} خط
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableCombobox
              options={centrals}
              value={filterCentral}
              onChange={(v) => { setFilterCentral(v); setFilterCabinet(""); }}
              placeholder="كل السنترالات"
              searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={cabinets}
              value={filterCabinet}
              onChange={setFilterCabinet}
              placeholder="كل الكباين"
              searchPlaceholder="ابحث في الكباين..."
              disabled={!filterCentral}
              className="w-full sm:w-40 text-sm"
            />
            {user?.role === ROLES.SUPER_ADMIN && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openCustomer360(filtered.map((l) => l.fullPhone))}
                disabled={filtered.length === 0}
                className="gap-1 text-purple-700 border-purple-200 disabled:opacity-40"
                title="فتح Customer360 لجلب أرقام الأكونت للخطوط المعروضة تلقائياً"
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
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="text-green-700 border-green-200 gap-1">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200 gap-1">
              <FileText className="w-4 h-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> تحديث
            </Button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-3 border-b bg-red-50 flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التذكرة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">نوع العطل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون الكامل</TableHead>
                  {canEdit && <TableHead className="text-right font-bold whitespace-nowrap">تسجيل أكونت</TableHead>}
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينه</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الموبايل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">IDU</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">DP Terminal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 10 : 9} className="text-center text-muted-foreground py-10">
                      لا توجد أعطال أرضية بدون رقم أكونت
                    </TableCell>
                  </TableRow>
                ) : filtered.map((l, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono font-semibold text-amber-700">{l.ticketNumber || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.faultType || "-"}</TableCell>
                    <TableCell className="font-mono font-semibold text-blue-700">{l.fullPhone || "-"}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1" dir="ltr">
                          <Input
                            value={drafts[l.fullPhone] ?? ""}
                            onChange={(e) => {
                              setDrafts((d) => ({ ...d, [l.fullPhone]: e.target.value }));
                              setSaveState((s) => { const n = { ...s }; delete n[l.fullPhone]; return n; });
                            }}
                            onKeyDown={(e) => e.key === "Enter" && handleSave(l.fullPhone)}
                            placeholder="أكونت"
                            className="h-7 w-28 text-xs"
                            dir="ltr"
                          />
                          <button
                            type="button"
                            onClick={() => handleSave(l.fullPhone)}
                            disabled={!drafts[l.fullPhone]?.trim() || saveState[l.fullPhone] === "saving"}
                            title="حفظ"
                            className="text-green-600 hover:text-green-800 disabled:opacity-40"
                          >
                            {saveState[l.fullPhone] === "saving"
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Save className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkNoAccount(l.fullPhone)}
                            disabled={saveState[l.fullPhone] === "saving"}
                            title="ليس له رقم أكونت — إخفاء من التقرير"
                            className="text-orange-500 hover:text-orange-700 disabled:opacity-40"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                          {saveState[l.fullPhone] === "saved" && <span className="text-green-600 text-xs">✓</span>}
                          {saveState[l.fullPhone] === "error" && <span className="text-red-500 text-xs">!</span>}
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap">{l.central || "-"}</TableCell>
                    <TableCell className="font-medium">{l.cabinNumber || "-"}</TableCell>
                    <TableCell className="font-medium">{l.boxNumber || "-"}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{l.telNo || "-"}</TableCell>
                    <TableCell><MobileValue mobile={mobileLookup[phoneLookupKey(l.telNo || l.fullPhone)]} /></TableCell>
                    <TableCell>{l.iduNo || "-"}</TableCell>
                    <TableCell>{l.dpTerminal || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer, RotateCcw, IdCard, Check, X, Plus } from "lucide-react";
import { printTablePDF } from "@/lib/print-pdf";
import { openCustomer360 } from "@/lib/customer360";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

// تقرير الأرقام المعلَّمة "بدون رقم أكونت" — اتشالت من تقرير الخطوط بدون أكونت بالحذف اليدوى،
// أو Customer360 رجّع "this subscriber does not exist". المصدر = جدول lines_no_account.
interface MarkedRow {
  fullPhone: string;
  telNo: string | null;
  central: string | null;
  cabinNumber: string | null;
  boxNumber: string | null;
  frame: string | null;
  dpTerminal: string | null;
  markedByName: string | null;
  markedAt: string | null;
}

const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

// مصدر التعليم: customer360 (غير موجود) أو حذف يدوى بواسطة مستخدم
const sourceLabel = (name: string | null) =>
  (name || "").toLowerCase() === "customer360" ? "غير موجود (Customer360)" : `حذف يدوى${name ? " — " + name : ""}`;

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function MarkedNoAccountReport() {
  const { user } = useAuth();
  const [central, setCentral] = useState("");
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState<string | null>(null);

  const { data: rows = [], isFetching } = useQuery<MarkedRow[]>({
    queryKey: ["/api/reports/marked-no-account", central, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (central) p.set("central", central);
      if (q) p.set("q", q);
      const res = await fetch(`/api/reports/marked-no-account?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });
  const mobileLookup = useMobileLookup(rows.map((r) => r.telNo || r.fullPhone));

  // استرجاع: إلغاء تعليم "بدون أكونت" → الخط يرجع لتقرير الخطوط بدون أكونت
  const handleRestore = async (fullPhone: string) => {
    if (!confirm("استرجاع هذا الخط؟ سيرجع لتقرير «الخطوط بدون رقم أكونت».")) return;
    setRestoring(fullPhone);
    try {
      await fetch(`/api/lines-no-account/${encodeURIComponent(fullPhone)}`, { method: "DELETE", credentials: "include" });
      qc.invalidateQueries({ queryKey: ["/api/reports/marked-no-account"] });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/without-account"] });
    } finally {
      setRestoring(null);
    }
  };

  // إدخال رقم الأكونت مباشرةً من هنا: تسجيله معناه إن الخط **له أكونت فعلاً**،
  // فبيترجع تلقائياً (السيرفر بيشيل علامة «بدون أكونت» مع حفظ الأكونت فى نفس الطلب).
  const [editPhone, setEditPhone] = useState<string | null>(null);
  const [accInput, setAccInput] = useState("");
  const [savingAcc, setSavingAcc] = useState<string | null>(null);
  const saveAccount = async (fullPhone: string) => {
    const acc = accInput.trim();
    if (!acc) return;
    setSavingAcc(fullPhone);
    try {
      const res = await fetch(`/api/line-accounts/${encodeURIComponent(fullPhone)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNo: acc }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.message || "تعذّر حفظ رقم الأكونت");
        return;
      }
      setEditPhone(null); setAccInput("");
      qc.invalidateQueries({ queryKey: ["/api/reports/marked-no-account"] });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/without-account"] });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/with-account"] });
    } finally { setSavingAcc(null); }
  };

  const handleExportExcel = () => {
    const data = rows.map((r, i) => ({
      "#": i + 1,
      "رقم التليفون الكامل": r.fullPhone,
      "رقم التليفون": r.telNo ?? "",
      "السنترال": r.central ?? "",
      "رقم الكابينة": r.cabinNumber ?? "",
      "رقم البكس": r.boxNumber ?? "",
      "المصدر": sourceLabel(r.markedByName),
      "تاريخ التعليم": fmtDt(r.markedAt),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "معلَّمة بدون أكونت");
    XLSX.writeFile(wb, "marked-no-account.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "الأرقام المعلَّمة بدون رقم أكونت (محذوفة / غير موجودة)",
      columns: ["#", "التليفون الكامل", "التليفون", "السنترال", "الكابينة", "البكس", "المصدر", "تاريخ التعليم"],
      rows: rows.map((r, i) => [i + 1, r.fullPhone, r.telNo ?? "-", r.central ?? "-", r.cabinNumber ?? "-", r.boxNumber ?? "-", sourceLabel(r.markedByName), fmtDt(r.markedAt)]),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={central}
          onChange={(e) => setCentral(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm w-full sm:w-auto"
          dir="rtl"
        >
          <option value="">كل السنترالات</option>
          {CENTRALS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Input
          placeholder="بحث برقم التليفون / المصدر"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:max-w-xs text-sm"
          dir="rtl"
        />
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <span className="text-sm text-muted-foreground">إجمالي: <strong>{rows.length}</strong> رقم</span>
        {user?.role === ROLES.SUPER_ADMIN && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openCustomer360(rows.map((r) => r.fullPhone))}
            disabled={rows.length === 0}
            className="text-purple-700 border-purple-200 gap-1"
            title="فتح Customer360 لجلب أرقام الأكونت لخطوط هذا التقرير تلقائياً"
          >
            <IdCard className="w-4 h-4" /> Customer360
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={rows.length === 0} className="text-green-700 border-green-200 gap-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={rows.length === 0} className="text-red-700 border-red-200 gap-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-blue-900">
              <TableRow>
                <TableHead className="text-right font-bold text-white w-8">#</TableHead>
                <TableHead className="text-right font-bold text-white">رقم التليفون الكامل</TableHead>
                <TableHead className="text-right font-bold text-white">رقم التليفون</TableHead>
                <TableHead className="text-right font-bold text-white">رقم الموبايل</TableHead>
                <TableHead className="text-right font-bold text-white">السنترال</TableHead>
                <TableHead className="text-right font-bold text-white">رقم الكابينة</TableHead>
                <TableHead className="text-right font-bold text-white">رقم البكس</TableHead>
                <TableHead className="text-right font-bold text-white">المصدر</TableHead>
                <TableHead className="text-right font-bold text-white">تاريخ التعليم</TableHead>
                <TableHead className="text-right font-bold text-white">رقم الأكونت</TableHead>
                <TableHead className="text-right font-bold text-white">استرجاع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد أرقام معلَّمة بدون أكونت"}
                  </TableCell>
                </TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={r.fullPhone} className="hover:bg-muted/30">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{r.telNo || "-"}</TableCell>
                  <TableCell><MobileValue mobile={mobileLookup[phoneLookupKey(r.telNo || r.fullPhone)]} /></TableCell>
                  <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                  <TableCell>{r.cabinNumber || "-"}</TableCell>
                  <TableCell>{r.boxNumber || "-"}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      (r.markedByName || "").toLowerCase() === "customer360"
                        ? "bg-orange-100 text-orange-800"
                        : "bg-purple-100 text-purple-700"
                    }`}>
                      {sourceLabel(r.markedByName)}
                    </span>
                  </TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(r.markedAt)}</TableCell>
                  <TableCell>
                    {editPhone === r.fullPhone ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          value={accInput}
                          onChange={(e) => setAccInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveAccount(r.fullPhone); }}
                          placeholder="رقم الأكونت"
                          className="border rounded px-2 py-0.5 text-xs w-28"
                          dir="ltr"
                          autoFocus
                        />
                        <button
                          onClick={() => saveAccount(r.fullPhone)}
                          disabled={savingAcc === r.fullPhone || !accInput.trim()}
                          title="حفظ — الخط هيترجع تلقائياً"
                          className="text-emerald-600 hover:text-emerald-800 disabled:opacity-30"
                        >
                          {savingAcc === r.fullPhone ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button onClick={() => { setEditPhone(null); setAccInput(""); }} title="إلغاء" className="text-gray-500 hover:text-gray-700">
                          <X className="w-4 h-4" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditPhone(r.fullPhone); setAccInput(""); }}
                        title="لو الخط ليه أكونت فعلاً — اكتبه هنا والخط هيترجع تلقائياً"
                        className="inline-flex items-center gap-1 text-xs text-emerald-700 border border-emerald-300 rounded px-2 py-0.5 hover:bg-emerald-50"
                      >
                        <Plus className="w-3 h-3" /> إضافة أكونت
                      </button>
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => handleRestore(r.fullPhone)}
                      disabled={restoring === r.fullPhone}
                      title="استرجاع — يرجع لتقرير الخطوط بدون رقم أكونت"
                      className="text-blue-600 hover:text-blue-800 disabled:opacity-40 inline-flex items-center gap-1 text-xs"
                    >
                      {restoring === r.fullPhone ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                      استرجاع
                    </button>
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

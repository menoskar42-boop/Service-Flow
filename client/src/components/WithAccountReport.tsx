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
import { ChevronRight, ChevronLeft, Loader2, Radar, Pencil, Save, X, Ban } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { Measurement138Button, type Measurement138 } from "@/components/Measurement138Button";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { RefreshButton } from "@/components/RefreshButton";

const DZS_URL = "https://10.42.187.101:8080/expresse/";

type DZSItem = { account: string; complaint?: string | null; short?: string | null; full?: string | null };
const buildDZSUrl = (items: DZSItem[], force = false) => {
  const accounts = items.map((it) => it.account);
  // force = جاى من تقرير "الخطوط أسكورها أعلى من 100" → السكربت يعمل real-time فعلى حتى لو الخط
  // مخزّن كحالة خاصة (POP_O/out-of-service)، بدل ما يعتبرها 101 على طول.
  return `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}${force ? "&sf_force=1" : ""}`;
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
// بوابة DZS بتقفل التاب لو استقبلت عدد كبير من الأرقام مرة واحدة، فنقسّم
// التقسيم لدفعات والانتظار 400 ثانية بين كل دفعة يتم داخل سكريبت DZS نفسه
// (dzs-expresse-v10.user.js) — هنا نفتح كل الأكونتس فى تاب واحد والسكريبت يتولّى الباقى.

const scoreBadge = (v: string | number | null | undefined) => {
  if (v == null || v === "") return <span className="text-gray-400">-</span>;
  const n = Number(v);
  if (isNaN(n)) return <span>{String(v)}</span>;
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

interface WithAccountReportProps {
  /** فلتر اختيارى: عرض فقط الخطوط التى أسكورها أعلى من هذه القيمة (تقرير الأسكور > 100) */
  scoreGt?: number;
  /** فلتر اختيارى: عرض فقط الخطوط التى لم يتم قياسها من قبل (لا يوجد لها سجل فى شيت 138) */
  neverMeasured?: boolean;
  /** القيمة الافتراضية لعدد أيام فلتر «أقدم من N يوم» (الفلتر نفسه يظل مطفياً حتى تفعيله) */
  defaultStaleDays?: string;
  title?: string;
}

export function WithAccountReport({ scoreGt, neverMeasured, defaultStaleDays = "10", title }: WithAccountReportProps = {}) {
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [boxFrom, setBoxFrom] = useState("");
  const [boxTo, setBoxTo] = useState("");
  const [page, setPage] = useState(1);
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [speedMin, setSpeedMin] = useState("");
  const [speedMax, setSpeedMax] = useState("");
  const [accountQ, setAccountQ] = useState("");
  // فلتر "أقدم من N يوم": يعرض فقط الخطوط التى مرّ على آخر قياس لها أكثر من N يوم
  // أو التى لم تُقَس من قبل. عدد الأيام يكتبه المستخدم (افتراضى 7).
  const [staleDays, setStaleDays] = useState(defaultStaleDays);
  const [staleOn, setStaleOn] = useState(false);
  // زر (فى تقرير «لم تُقَس»): يفلتر الأرقام التى لها شكوى
  const [hasComplaintOn, setHasComplaintOn] = useState(false);
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [dzsLoading, setDzsLoading] = useState(false);
  const [dzsCount, setDzsCount] = useState<number | null>(null);
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role !== ROLES.SALES;
  // تنسيق تاريخ آخر قياس للخط (من شيت 138)
  const fmtMeasDate = (d: string | null | undefined) => {
    if (!d) return "-";
    const t = new Date(d);
    if (isNaN(t.getTime())) return "-";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
  };

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["/api/phone-lines/with-account", central, cabin, box, boxFrom, boxTo, page, scoreGt ?? "", neverMeasured ?? false, scoreMin, scoreMax, speedMin, speedMax, accountQ, staleOn, staleDays, hasComplaintOn],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      if (!box && boxFrom) params.set("boxFrom", boxFrom);
      if (!box && boxTo)   params.set("boxTo",   boxTo);
      if (staleOn && staleDays.trim()) params.set("staleDays", staleDays.trim());
      if (hasComplaintOn) params.set("hasComplaint", "1");
      if (scoreGt != null) params.set("scoreGt", String(scoreGt));
      if (neverMeasured) params.set("neverMeasured", "1");
      if (scoreMin.trim()) params.set("scoreGt", scoreMin.trim());
      if (scoreMax.trim()) params.set("scoreLt", scoreMax.trim());
      if (speedMin.trim()) params.set("speedGt", speedMin.trim());
      if (speedMax.trim()) params.set("speedLt", speedMax.trim());
      if (accountQ.trim()) params.set("accountQ", accountQ.trim());
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

  // تحويل خط من "لها أكونت" إلى "ليس له أكونت": حذف الأكونت + إخفاء من التقريرين
  const handleMarkNoAccount = async (fullPhone: string) => {
    if (!confirm("تأكيد: سيتم حذف رقم الأكونت وإخفاء هذا الخط من التقريرين؟")) return;
    setSaveState((s) => ({ ...s, [fullPhone]: "saving" }));
    try {
      await fetch(`/api/line-accounts/${encodeURIComponent(fullPhone)}`, {
        method: "DELETE",
        credentials: "include",
      });
      await fetch(`/api/lines-no-account/${encodeURIComponent(fullPhone)}`, {
        method: "POST",
        credentials: "include",
      });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/with-account"] });
      qc.invalidateQueries({ queryKey: ["/api/phone-lines/without-account"] });
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

  // القياس: نفتح كل أكونتس النطاق فى تاب DZS واحد — والسكريبت (dzs-expresse-v10.user.js)
  // يتولّى التقسيم لدفعات 50 خط والانتظار 400 ثانية بين كل دفعة والرفع التلقائى لشيت 138.
  const handleMeasureDZS = async () => {
    const totalCount = data?.total ?? 0;
    // تحذير فقط (مش منع): لو العدد كبير نسأل المستخدم هل يكمّل
    if (totalCount > 500) {
      if (!confirm(`عدد الخطوط ${totalCount.toLocaleString("ar-EG")} (أكثر من 500) — القياس على دفعات هياخد وقت طويل. هل تريد الاستمرار؟`)) return;
    }
    // افتح التاب فوراً وبشكل متزامن داخل ضغطة الزر (قبل أى await) — وإلا يحجبه الـ popup blocker
    const w = window.open("about:blank", "dzs_measure");
    setDzsLoading(true);
    setDzsCount(null);
    try {
      const params = new URLSearchParams({ page: "1", limit: "20000" });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      if (!box && boxFrom) params.set("boxFrom", boxFrom);
      if (!box && boxTo)   params.set("boxTo",   boxTo);
      if (staleOn && staleDays.trim()) params.set("staleDays", staleDays.trim());
      if (hasComplaintOn) params.set("hasComplaint", "1");
      if (scoreGt != null) params.set("scoreGt", String(scoreGt));
      if (neverMeasured) params.set("neverMeasured", "1");
      if (accountQ.trim()) params.set("accountQ", accountQ.trim());
      // 🆕 نطبّق نفس فلاتر الاسكور/السرعة المكتوبة فى الشاشة على القياس
      if (scoreMin.trim()) params.set("scoreGt", scoreMin.trim());
      if (scoreMax.trim()) params.set("scoreLt", scoreMax.trim());
      if (speedMin.trim()) params.set("speedGt", speedMin.trim());
      if (speedMax.trim()) params.set("speedLt", speedMax.trim());
      const res = await fetch(`/api/phone-lines/with-account?${params}`, { credentials: "include" });
      const json = await res.json();
      const all = (json.data as PhoneLine[]) ?? [];
      const seen = new Set<string>();
      const items = all
        .map(toItem)
        .filter((it) => it.account && !seen.has(it.account) && seen.add(it.account));
      if (items.length === 0) { try { w?.close(); } catch {} alert("لا توجد أرقام أكونت فى النطاق المحدد"); return; }
      if (w) w.location.href = buildDZSUrl(items, scoreGt != null); // scoreGt != null = تقرير الأسكور>100 → فرض real-time
      setDzsCount(items.length);
    } catch {
      try { w?.close(); } catch {}
      alert("تعذّر تحميل بيانات النطاق للقياس");
    } finally {
      setDzsLoading(false);
    }
  };

  const openDZSSingle = (r: PhoneLine) => window.open(buildDZSUrl([toItem(r)], scoreGt != null), "_blank");

  const handleExport = async () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    if (!box && boxFrom) params.set("boxFrom", boxFrom);
    if (!box && boxTo)   params.set("boxTo",   boxTo);
    if (staleOn && staleDays.trim()) params.set("staleDays", staleDays.trim());
    if (hasComplaintOn) params.set("hasComplaint", "1");
    if (scoreGt != null) params.set("scoreGt", String(scoreGt));
    if (neverMeasured) params.set("neverMeasured", "1");
    if (scoreMin.trim()) params.set("scoreGt", scoreMin.trim());
    if (scoreMax.trim()) params.set("scoreLt", scoreMax.trim());
    if (speedMin.trim()) params.set("speedGt", speedMin.trim());
    if (speedMax.trim()) params.set("speedLt", speedMax.trim());
    if (accountQ.trim()) params.set("accountQ", accountQ.trim());
    const res = await fetch(`/api/phone-lines/with-account?${params}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as PhoneLine[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "تاريخ آخر قياس": fmtMeasDate(r.lastMeasTime),
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
    if (staleOn && staleDays.trim()) params.set("staleDays", staleDays.trim());
    if (hasComplaintOn) params.set("hasComplaint", "1");
    if (scoreGt != null) params.set("scoreGt", String(scoreGt));
    if (neverMeasured) params.set("neverMeasured", "1");
    if (scoreMin.trim()) params.set("scoreGt", scoreMin.trim());
    if (scoreMax.trim()) params.set("scoreLt", scoreMax.trim());
    if (speedMin.trim()) params.set("speedGt", speedMin.trim());
    if (speedMax.trim()) params.set("speedLt", speedMax.trim());
    if (accountQ.trim()) params.set("accountQ", accountQ.trim());
    const res = await fetch(`/api/phone-lines/with-account?${params}`, { credentials: "include" });
    const json = await res.json();
    const all = json.data as PhoneLine[];
    printTablePDF({
      title: title ?? "تقرير الخطوط التى لها رقم أكونت",
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
            <h3 className="font-semibold text-base">{title ?? "الخطوط التى لها رقم أكونت"}</h3>
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
              onChange={(v) => { setCabin(v); setBox(""); setBoxFrom(""); setBoxTo(""); setPage(1); }}
              placeholder="كل الكباين"
              searchPlaceholder="ابحث في الكباين..."
              disabled={!central}
              className="w-full sm:w-40 text-sm"
            />
            <SearchableCombobox
              options={boxes}
              value={box}
              onChange={(v) => { setBox(v); setBoxFrom(""); setBoxTo(""); setPage(1); }}
              placeholder="كل البكسيات"
              searchPlaceholder="ابحث في البكسيات..."
              disabled={!cabin}
              className="w-full sm:w-36 text-sm"
            />
            <Input
              type="text"
              value={accountQ}
              onChange={(e) => { setAccountQ(e.target.value); setPage(1); }}
              placeholder="بحث برقم الأكونت"
              className="w-full sm:w-40 h-9 text-sm"
              dir="ltr"
            />
            <div className="flex items-center gap-1 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-500 bg-white">
              <span className="whitespace-nowrap">بكس من</span>
              <Input
                type="number" min="1" value={boxFrom}
                onChange={e => { setBoxFrom(e.target.value); setBox(""); setPage(1); }}
                className="w-14 h-6 text-xs px-1 border-0 shadow-none"
                placeholder="1"
                disabled={!cabin}
              />
              <span>—</span>
              <Input
                type="number" min="1" value={boxTo}
                onChange={e => { setBoxTo(e.target.value); setBox(""); setPage(1); }}
                className="w-14 h-6 text-xs px-1 border-0 shadow-none"
                placeholder="99"
                disabled={!cabin}
              />
            </div>
            {/* فلترا السرعة والاسكور — بلا معنى لتقرير «لم تُقَس» فنخفيهما هناك */}
            {!neverMeasured && (
            <div className="flex items-center gap-1 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-500 bg-gray-50">
              <span className="whitespace-nowrap">السرعة الحالية:</span>
              <Input
                type="number"
                min={0}
                value={speedMin}
                onChange={(e) => { setSpeedMin(e.target.value); setPage(1); }}
                placeholder="من"
                className="h-6 w-16 text-xs px-1 border-0 bg-transparent focus-visible:ring-0"
                dir="ltr"
              />
              <span>—</span>
              <Input
                type="number"
                min={0}
                value={speedMax}
                onChange={(e) => { setSpeedMax(e.target.value); setPage(1); }}
                placeholder="إلى"
                className="h-6 w-16 text-xs px-1 border-0 bg-transparent focus-visible:ring-0"
                dir="ltr"
              />
            </div>
            )}
            {!neverMeasured && (
            <div className="flex items-center gap-1 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-500 bg-gray-50">
              <span className="whitespace-nowrap">الاسكور:</span>
              <Input
                type="number"
                min={0}
                value={scoreMin}
                onChange={(e) => { setScoreMin(e.target.value); setPage(1); }}
                placeholder="من"
                className="h-6 w-14 text-xs px-1 border-0 bg-transparent focus-visible:ring-0"
                dir="ltr"
              />
              <span>—</span>
              <Input
                type="number"
                min={0}
                value={scoreMax}
                onChange={(e) => { setScoreMax(e.target.value); setPage(1); }}
                placeholder="إلى"
                className="h-6 w-14 text-xs px-1 border-0 bg-transparent focus-visible:ring-0"
                dir="ltr"
              />
            </div>
            )}
            {/* فلتر «أقدم من N يوم» — بلا معنى لتقرير «لم تُقَس» (كلها بدون قياس) فنخفيه هناك */}
            {!neverMeasured && (
            <div className={`flex items-center gap-1 border rounded-md px-2 py-1 text-xs ${staleOn ? "border-purple-300 bg-purple-50 text-purple-700" : "border-gray-200 bg-white text-gray-500"}`}>
              <span className="whitespace-nowrap">أقدم من</span>
              <Input
                type="number"
                min={1}
                value={staleDays}
                onChange={(e) => { setStaleDays(e.target.value); setPage(1); }}
                className="h-6 w-14 text-xs px-1 border-0 bg-transparent focus-visible:ring-0"
                dir="ltr"
              />
              <span className="whitespace-nowrap">يوم</span>
              <Button
                variant={staleOn ? "default" : "outline"}
                size="sm"
                onClick={() => { setStaleOn((v) => !v); setPage(1); }}
                className={`h-6 px-2 text-xs ${staleOn ? "bg-purple-600 hover:bg-purple-700 text-white" : "text-purple-700 border-purple-200"}`}
                title="عرض فقط الخطوط التى مرّ على آخر قياس لها أكثر من العدد المحدد من الأيام أو لم تُقَس من قبل"
              >
                {staleOn ? "مفعّل" : "تفعيل"}
              </Button>
            </div>
            )}
            {/* زر «لها شكوى» — يفلتر الأرقام التى لها رقم شكوى (سابقة) — فى كل التقارير */}
            <Button
              variant={hasComplaintOn ? "default" : "outline"}
              size="sm"
              onClick={() => { setHasComplaintOn((v) => !v); setPage(1); }}
              className={`gap-1 ${hasComplaintOn ? "bg-purple-600 hover:bg-purple-700 text-white" : "text-purple-700 border-purple-200"}`}
              title="عرض فقط الأرقام التى لها رقم شكوى"
            >
              {hasComplaintOn ? "لها شكوى ✓" : "لها شكوى"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleMeasureDZS} disabled={dzsLoading} className="text-blue-700 border-blue-200 gap-1">
              {dzsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />} قياس DZS
            </Button>
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExport} className="text-green-700 border-green-200">
              تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200">
              تصدير PDF
            </Button>
          </div>
        </div>

        {dzsCount != null && (
          <div className="px-4 py-2 border-b bg-blue-50 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-blue-700 font-semibold">
              فُتح قياس DZS لـ {dzsCount} رقم — السكريبت بيقيس على دفعات 140 خط، وبعد كل دفعة بينتظر 400 ثانية ويكمّل تلقائياً ويرفع النتائج لشيت 138.
            </span>
            <button onClick={() => setDzsCount(null)} className="text-gray-400 hover:text-gray-600 mr-auto" title="إغلاق">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {isLoading || dzsLoading ? (
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
                    {!neverMeasured && <TableHead className="text-right font-bold whitespace-nowrap">تاريخ آخر قياس</TableHead>}
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الأكونت</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">المصدر</TableHead>
                    {!neverMeasured && <TableHead className="text-right font-bold whitespace-nowrap">قياس</TableHead>}
                    {!neverMeasured && <TableHead className="text-right font-bold whitespace-nowrap">السرعة الحالية</TableHead>}
                    {!neverMeasured && <TableHead className="text-right font-bold whitespace-nowrap">أقصى سرعة</TableHead>}
                    {!neverMeasured && <TableHead className="text-right font-bold whitespace-nowrap">الاسكور</TableHead>}
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
                      {!neverMeasured && <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap text-muted-foreground">{fmtMeasDate(r.lastMeasTime)}</TableCell>}
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
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEdit(r)}
                                  title="تعديل رقم الأكونت"
                                  className="text-amber-500 hover:text-amber-700"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMarkNoAccount(r.fullPhone)}
                                  disabled={saveState[r.fullPhone] === "saving"}
                                  title="ليس له رقم أكونت — حذف الأكونت وإخفاء الخط"
                                  className="text-orange-500 hover:text-orange-700 disabled:opacity-40"
                                >
                                  <Ban className="w-3 h-3" />
                                </button>
                              </>
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
                      {!neverMeasured && <TableCell><Measurement138Button m={r} /></TableCell>}
                      {!neverMeasured && <TableCell className="font-mono">{r.lineCurrentSpeed ?? "-"}</TableCell>}
                      {!neverMeasured && <TableCell className="font-mono">{r.lineMaxSpeed ?? "-"}</TableCell>}
                      {!neverMeasured && <TableCell>{scoreBadge(r.lastMeasScore)}</TableCell>}
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

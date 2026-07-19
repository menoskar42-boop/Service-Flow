import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSpeedToolsVisible, useIsSuperAdmin } from "@/lib/use-speed-tools";
import { useSpeedToolSource } from "@/hooks/use-speed-tool-source";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageJump } from "@/components/ui/page-jump";
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
import { ChevronRight, ChevronLeft, Loader2, Radar, Gauge } from "lucide-react";
import { openProfileOptimization } from "@/lib/profile-optimization";
import { dispatchSpeedTool } from "@/lib/exec-queue";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { Measurement138Button, type Measurement138 } from "@/components/Measurement138Button";
import { ReviewSubscriberInfoButton } from "@/components/ReviewSubscriberInfoButton";

// رابط بوابة DZS expresse — يُفتح في تاب جديد ويُمرَّر أرقام الأكونت فى الـ hash.
const DZS_URL = "https://10.42.187.101:8080/expresse/";

// sf_accounts = أرقام الأكونت (lineIds)، sf_meta = أكونت~شكوى~تليفون~تليفون-كامل.
// (بيان التليفونات مالوش رقم شكوى → يُترك فارغاً.)
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
  subName: string | null;
  subAdd: string | null;
  lastPoRaiseAt: string | null;
  lastPoStopAt: string | null;
}

const fmtPoDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const PAGE_SIZE = 50;

export function PhoneLinesReport() {
  const showSpeedTools = useSpeedToolsVisible();
  const isSuper = useIsSuperAdmin();
  useSpeedToolSource("خطوط التليفون");
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [phoneFrom, setPhoneFrom] = useState(""); // نطاق: من رقم
  const [phoneTo, setPhoneTo] = useState("");     // نطاق: إلى رقم
  const [page, setPage] = useState(1);

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["/api/phone-lines", central, cabin, box, phoneFrom, phoneTo, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
      if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
      const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: PhoneLine[]; total: number; page: number; pageSize: number }>;
    },
  });

  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];

  // يجمع أرقام الأكونت من الصفحة المعروضة (يحذف المكرر ويتجاهل اللى مالهاش أكونت)
  // ويفتح تاب DZS واحد يمرّر الأرقام فى الـ hash ليقيسها الـ Tampermonkey.
  const toItem = (r: PhoneLine): DZSItem => ({
    account: (r.accountNo ?? "").toString().trim(),
    complaint: "", // بيان التليفونات مالوش رقم شكوى
    short: r.telNo ?? "",
    full: r.fullPhone ?? "",
  });

  // القياس يشتغل على النطاق المفلتر بالكامل (السنترال/الكابينه/البكس المحدد) —
  // مش الصفحة الظاهرة فقط — فنجيب كل الصفوف المطابقة للفلتر (limit كبير).
  const handleMeasureDZS = async () => {
    if (!central && !cabin && !box) {
      alert("اختر سنترال أو كابينه أو بكس أولاً — القياس يشتغل على النطاق المحدد فقط وليس كل الجدول");
      return;
    }
    // افتح التاب فوراً (قبل await) لتفادى حظر المتصفح للـ popup
    const win = window.open("", "_blank");
    try {
      const params = new URLSearchParams({ page: "1", limit: "20000" });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
      if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
      const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
      const json = await res.json();
      const all = (json.data as PhoneLine[]) ?? [];
      const seen = new Set<string>();
      const items = all
        .map(toItem)
        .filter((it) => it.account && !seen.has(it.account) && seen.add(it.account));
      if (items.length === 0) {
        if (win) win.close();
        alert("لا توجد أرقام أكونت فى النطاق المحدد — لا شىء للقياس");
        return;
      }
      if (await dispatchSpeedTool("measure", items.map((i) => i.account), isSuper)) { if (win) win.close(); return; }
      if (items.length > 150 &&
          !confirm(`سيتم فتح DZS لقياس ${items.length} رقم فى هذا النطاق — متأكد؟`)) {
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

  // رفع السرعة / إيقاف PO لأرقام النطاق المحدد.
  const handleRaisePO = async (kind: "raise" | "stop") => {
    if (!central && !cabin && !box) { alert("اختر سنترال أو كابينه أو بكس أولاً"); return; }
    const afterStop = kind === "raise"
      ? window.confirm("رفع السرعة والإيقاف؟\n\nموافق = رفع السرعة لكل الأرقام ثم إيقاف الـ Nightly الناتج لكلهم\nإلغاء = رفع السرعة فقط")
      : false;
    try {
      const params = new URLSearchParams({ page: "1", limit: "20000" });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
      if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
      const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
      const json = await res.json();
      const all = (json.data as PhoneLine[]) ?? [];
      const seen = new Set<string>();
      const accounts = all
        .map((r) => (toItem(r).account ?? "").toString().trim())
        .filter((a) => a && !seen.has(a) && seen.add(a));
      if (accounts.length === 0) { alert("لا توجد أرقام أكونت فى النطاق المحدد"); return; }
      if (await dispatchSpeedTool(kind === "stop" ? "stop" : "raise", accounts, isSuper)) return;
      openProfileOptimization(accounts, kind === "stop" ? { stopOnly: true } : { afterStop });
    } catch {
      alert("تعذّر تحميل بيانات النطاق");
    }
  };

  // يفتح تاب DZS لخط واحد (الزر بجوار كل خط).
  const openDZSSingle = async (r: PhoneLine) => {
    if (await dispatchSpeedTool("measure", [toItem(r).account], isSuper)) return;
    window.open(buildDZSUrl([toItem(r)]), "dzs_measure");
  };

  const handleExport = async () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
    if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
    const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as PhoneLine[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "رقم الأكونت": r.accountNo,
      "آخر قياس": r.lastMeasScore,
      "السرعة الحالية": r.lineCurrentSpeed,
      "أقصى سرعة": r.lineMaxSpeed,
      "السنترال": r.central,
      "اسم العميل": r.subName ?? "",
      "العنوان": r.subAdd ?? "",
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "رقم التليفون": r.telNo,
      "IDU": r.iduNo,
      "ODU": r.oduNo,
      "Primary Block": r.primaryBlockNo,
      "Cabinet In": r.cabinetIn,
      "Sec Block": r.secBlockNo,
      "Cabinet Out": r.cabinetOut,
      "DP Terminal": r.dpTerminal,
      "Port": r.port,
      "LEN": r.len,
      "آخر رفع سرعة": fmtPoDt(r.lastPoRaiseAt),
      "آخر إيقاف PO": fmtPoDt(r.lastPoStopAt),
      "Fiber Block": r.fiberBlock,
      "Fiber Out": r.fiberOut,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيان التليفونات");
    XLSX.writeFile(wb, "phone-lines-report.xlsx");
  };

  const handleExportPDF = async () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
    if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
    const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
    const json = await res.json();
    const all = json.data as PhoneLine[];
    printTablePDF({
      title: "تقرير بيان أرقام التليفونات",
      columns: ["#", "التليفون الكامل", "الأكونت", "سرعة حالية", "أقصى سرعة", "السنترال", "اسم العميل", "العنوان", "الكابينه", "البكس", "التليفون",
        "IDU", "ODU", "Cabinet In", "DP Terminal", "Port", "LEN"],
      rows: all.map((r, i) => [i + 1, r.fullPhone, r.accountNo ?? "", r.lineCurrentSpeed ?? "", r.lineMaxSpeed ?? "",
        r.central, r.subName ?? "", r.subAdd ?? "", r.cabinNumber, r.boxNumber,
        r.telNo, r.iduNo, r.oduNo, r.cabinetIn, r.dpTerminal, r.port, r.len]),
    });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">بيان أرقام التليفونات</h3>
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

            {/* نطاق أرقام: من رقم … إلى رقم (يُطابَق على الرقم القصير بدون 88) */}
            <div className="flex items-center gap-1">
              <Input
                inputMode="numeric"
                value={phoneFrom}
                onChange={(e) => { setPhoneFrom(e.target.value.replace(/\D/g, "")); setPage(1); }}
                placeholder="من رقم"
                dir="ltr"
                className="w-28 sm:w-32 text-sm text-left h-9"
              />
              <span className="text-xs text-muted-foreground">إلى</span>
              <Input
                inputMode="numeric"
                value={phoneTo}
                onChange={(e) => { setPhoneTo(e.target.value.replace(/\D/g, "")); setPage(1); }}
                placeholder="إلى رقم"
                dir="ltr"
                className="w-28 sm:w-32 text-sm text-left h-9"
              />
            </div>

            {showSpeedTools && (<>
            <Button variant="outline" size="sm" onClick={handleMeasureDZS} className="text-blue-700 border-blue-200 gap-1">
              <Radar className="w-4 h-4" /> قياس DZS
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleRaisePO("raise")} className="text-emerald-700 border-emerald-200 gap-1" title="رفع السرعة (Profile Optimization) لأرقام النطاق المحدد">
              <Gauge className="w-4 h-4" /> رفع سرعة
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleRaisePO("stop")} className="text-orange-700 border-orange-200 gap-1" title="إيقاف الـ Nightly PO فقط لأرقام النطاق المحدد">
              <Gauge className="w-4 h-4" /> إيقاف PO
            </Button>
            </>)}
            {/* مراجعة البيانات: يعيد جلب اسم/عنوان العميل من FCC للأرقام (بدون بيانات أو الكل) — سوبر أدمن. */}
            {isSuper && <ReviewSubscriberInfoButton filters={{ central, cabin, box, phoneFrom, phoneTo }} />}
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
                    <TableHead className="text-right font-bold whitespace-nowrap">قياس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">اسم العميل</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">العنوان</TableHead>
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
                    <TableHead className="text-right font-bold whitespace-nowrap">Fiber Block</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Fiber Out</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">آخر رفع سرعة</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">آخر إيقاف PO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((r, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left font-mono">
                        {r.accountNo ? (
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
                          </span>
                        ) : "-"}
                      </TableCell>
                      <TableCell><Measurement138Button m={r} /></TableCell>
                      <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                      <TableCell className="whitespace-normal break-words min-w-[130px]">{r.subName || "-"}</TableCell>
                      <TableCell className="whitespace-normal break-words min-w-[180px] max-w-[300px] text-xs">{r.subAdd || "-"}</TableCell>
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
                      <TableCell>{r.fiberBlock || "-"}</TableCell>
                      <TableCell>{r.fiberOut || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap text-emerald-700">{fmtPoDt(r.lastPoRaiseAt)}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap text-orange-700">{fmtPoDt(r.lastPoStopAt)}</TableCell>
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
                <PageJump page={page} totalPages={totalPages} onJump={setPage} />
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

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer, Repeat, Radar } from "lucide-react";
import { Measurement138Button, type Measurement138 } from "@/components/Measurement138Button";
import { format } from "date-fns";

interface CurrentFault extends Measurement138 {
  ticketId: string | null;
  centralName: string | null;
  phoneShort: string | null;
  repeatStatus: string;
  statusCode: string | null;
  msanCode: string | null;
  frame: string | null;
  cabinetNo: string | null;
  boxNo: string | null;
  dpTerminal: string | null;
  complainTime: string | null;
  complainTypeName: string | null;
  customerName: string | null;
  faultClass: string | null;
  closeDate: string | null;
  onu: string | null;
  workerCode: string | null;
  techName: string | null;
  hayaKarima: string | null;
  faultType: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  shelf: string | null;
  slot: string | null;
  portNumber: string | null;
  centralCode: string | null;
}

// الأوقات قادمة من ملف TicketQueue بتوقيت القاهرة لكنها مخزَّنة كـ UTC — نعرضها
// كما هى (UTC) دون إزاحة توقيت المتصفح حتى تطابق الملف (مثل 22:00 وليس 01:00).
const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

// يختصر الـ status code: "DSL-هوائية-160160" → "DSL-160"
// (يشيل كلمة "هوائية" ويصغّر الكود المضاعف 160160→160) لتصغير عرض العمود.
const shortStatusCode = (s: string | null) => {
  if (!s) return s;
  // كود السنترال: رقم مضاعف (160160→160) أو أول رقم 3 خانات (مثل 173 فى "Re-open TTS 173").
  const doubled = s.match(/(\d{3})\1/);
  const three = s.match(/\b(\d{3})\b/);
  const code = doubled ? doubled[1] : three ? three[1] : "";
  if (code) return `DSL-${code}`;
  // fallback: شيل "هوائية" وصغّر أى كود مضاعف.
  return s
    .split("-")
    .map((p) => p.trim())
    .filter((p) => p && p !== "هوائية")
    .map((p) =>
      /^\d+$/.test(p) && p.length % 2 === 0 && p.slice(0, p.length / 2) === p.slice(p.length / 2)
        ? p.slice(0, p.length / 2)
        : p,
    )
    .join("-");
};

// رابط بوابة DZS expresse — يُفتح في تاب جديد ويُمرَّر أرقام الأكونت فى الـ hash
// (cross-origin: الـ Tampermonkey script فى تاب DZS يقرأ location.hash لأن
// localStorage محجوز لكل origin لوحده).
const DZS_URL = "https://10.42.187.101:8080/expresse/";

// يبنى رابط DZS: sf_accounts = أرقام الأكونت (lineIds للقياس)، sf_meta = خريطة
// أكونت~شكوى~تليفون~تليفون-كامل ليكتبها الـ Tampermonkey فى الشيت بنفس ترتيب 138.
type DZSItem = { account: string; complaint?: string | null; short?: string | null; full?: string | null };
const buildDZSUrl = (items: DZSItem[]) => {
  const accounts = items.map((it) => it.account);
  const meta = items
    .map((it) => [it.account, it.complaint ?? "", it.short ?? "", it.full ?? ""].join("~"))
    .join(";");
  return `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}&sf_meta=${encodeURIComponent(meta)}`;
};

const faultBadge = (cls: string | null) => {
  if (!cls) return null;
  const map: Record<string, string> = {
    "اعطال 24 ساعه": "bg-green-100 text-green-800",
    "اعطال 48 ساعه": "bg-yellow-100 text-yellow-800",
    "المتبقيات":     "bg-red-100 text-red-800",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[cls] ?? "bg-gray-100 text-gray-700"}`}>
      {cls}
    </span>
  );
};

export function CurrentFaultsReport() {
  const [central, setCentral] = useState("");
  const [q, setQ] = useState("");
  const [repeatedOnly, setRepeatedOnly] = useState(false);

  const { data: faults = [], isFetching } = useQuery<CurrentFault[]>({
    queryKey: ["/api/reports/current-faults", central, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (central) p.set("central", central);
      if (q) p.set("q", q);
      const res = await fetch(`/api/reports/current-faults?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const displayed = repeatedOnly
    ? faults.filter((f) => f.repeatStatus === "مكرر")
    : faults;

  // يجمع أرقام الأكونت من الأعطال المعروضة (يحذف المكرر ويتجاهل اللى مالهاش
  // أكونت) ويفتح تاب DZS واحد يمرّر الأرقام فى الـ hash ليقيسها الـ Tampermonkey.
  const toItem = (f: CurrentFault): DZSItem => ({
    account: (f.accountNo ?? "").toString().trim(),
    complaint: f.ticketId ?? "",
    short: f.phoneShort ?? "",
    full: f.phoneShort ? "88" + f.phoneShort : "",
  });

  const handleMeasureDZS = () => {
    const seen = new Set<string>();
    const items = displayed
      .map(toItem)
      .filter((it) => it.account && !seen.has(it.account) && seen.add(it.account));
    if (items.length === 0) {
      alert("لا توجد أرقام أكونت فى الأعطال المعروضة — لا شىء للقياس");
      return;
    }
    window.open(buildDZSUrl(items), "_blank");
  };

  // يفتح تاب DZS لخط واحد (الزر بجوار كل خط).
  const openDZSSingle = (f: CurrentFault) => {
    window.open(buildDZSUrl([toItem(f)]), "_blank");
  };

  const handleExportExcel = () => {
    const rows = displayed.map((f, i) => ({
      "#": i + 1,
      "Field1": f.centralName,
      "رقم التلفون": f.phoneShort,
      "رقم الأكونت": f.accountNo,
      "القياس الحالى (نفس الشكوى)": f.curMeasScore,
      "آخر قياس للرقم": f.lastMeasScore,
      "موقف التكرار": f.repeatStatus,
      "Status Code": f.statusCode,
      "MSAN Code": f.msanCode,
      "Frame": f.frame,
      "رقم كابينه نهائى": f.cabinetNo,
      "رقم البكس نهائى": f.boxNo,
      "ترمنال": f.dpTerminal,
      "وقت الشكوي": fmtDt(f.complainTime),
      "ComplainTypeName": f.complainTypeName,
      "تصنيف الاعطال": f.faultClass,
      "اسم الفنى": f.techName,
      "Onu": f.onu,
      "كود العامل": f.workerCode,
      "حياة كريمة ام لا": f.hayaKarima,
      "نوع العطل": f.faultType,
      "LastOfVoice Status": f.voiceStatus,
      "LastOfData Status": f.dataStatus,
      "LastOfShelf": f.shelf,
      "LastOfSlot": f.slot,
      "LastOfPort number": f.portNumber,
      "كود السنترال": f.centralCode,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "اعطال حاليه بالبورت");
    XLSX.writeFile(wb, `current-faults-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const title = `تقرير الأعطال الحالية — ${format(new Date(), "yyyy/MM/dd HH:mm")}`;
    const esc = (v: any) =>
      String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 10;
    const totalPages = Math.max(1, Math.ceil(displayed.length / ROWS_PER_PAGE));
    const headRow = `<tr>
      <th>#</th><th>السنترال</th><th>التليفون</th><th>الأكونت</th><th>قياس حالى</th><th>آخر قياس</th><th>تكرار</th><th>Status</th>
      <th>MSAN</th><th>Frame</th>
      <th>الكابينة</th><th>البكس</th><th>ترمنال</th><th>وقت الشكوى</th><th>نوع الشكوى</th>
      <th>تصنيف</th><th>كود العامل</th><th>اسم الفنى</th><th>نوع العطل</th><th>Voice</th><th>Data</th>
    </tr>`;
    let pages = "";
    for (let p = 0; p < totalPages; p++) {
      const chunk = displayed.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const body = chunk.map((f, ci) => `
        <tr class="${(f.faultClass === 'المتبقيات') ? 'red' : (f.faultClass === 'اعطال 48 ساعه') ? 'yellow' : ''}">
          <td>${p * ROWS_PER_PAGE + ci + 1}</td>
          <td>${esc(f.centralName)}</td>
          <td>${esc(f.phoneShort)}</td>
          <td>${esc(f.accountNo)}</td>
          <td>${esc(f.curMeasScore)}</td>
          <td>${esc(f.lastMeasScore)}</td>
          <td>${esc(f.repeatStatus)}</td>
          <td style="font-size:9px">${esc(f.statusCode)}</td>
          <td style="font-size:9px">${esc(f.msanCode)}</td>
          <td>${esc(f.frame)}</td>
          <td>${esc(f.cabinetNo)}</td>
          <td>${esc(f.boxNo)}</td>
          <td>${esc(f.dpTerminal)}</td>
          <td style="font-size:9px">${esc(fmtDt(f.complainTime))}</td>
          <td style="font-size:9px">${esc(f.complainTypeName)}</td>
          <td>${esc(f.faultClass)}</td>
          <td>${esc(f.workerCode)}</td>
          <td>${esc(f.techName)}</td>
          <td>${esc(f.faultType)}</td>
          <td>${esc(f.voiceStatus)}</td>
          <td>${esc(f.dataStatus)}</td>
        </tr>`).join("");
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          <div class="pageno">صفحة ${p + 1} من ${totalPages} — إجمالي: ${displayed.length} عطل</div>
          <table><thead>${headRow}</thead><tbody>${body}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(title)}</title>
      <style>
        body { font-family: Arial, "Segoe UI", sans-serif; font-size: 10px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 13px; margin: 0 0 3px; }
        .pageno { text-align: center; font-size: 9px; color: #64748b; margin-bottom: 6px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 5px 3px; border: 1px solid #15407f; font-size: 10px; }
        td { border: 1px solid #ccc; padding: 4px 3px; text-align: right; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        tbody tr.red td { background: #fee2e2 !important; }
        tbody tr.yellow td { background: #fef9c3 !important; }
        .page { background: #fff; padding: 10px; margin: 10px auto; max-width: 1200px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0;
          padding: 8px 12px; display: flex; gap: 10px; align-items: center; z-index: 10; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px;
          padding: 7px 14px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .toolbar span { color: #475569; font-size: 11px; }
        @media print {
          body { background: #fff; }
          .toolbar { display: none; }
          .page { box-shadow: none; margin: 0; padding: 0; max-width: none; page-break-after: always; }
          .page:last-child { page-break-after: auto; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>في نافذة الطباعة اختر &quot;حفظ بصيغة PDF&quot; كوجهة الطباعة.</span>
      </div>
      ${pages}
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
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
          placeholder="بحث برقم التليفون / الكابينة / البكس / status"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:max-w-xs text-sm"
          dir="rtl"
        />
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <Button
          variant={repeatedOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setRepeatedOnly((v) => !v)}
          className={`gap-1 ${repeatedOnly ? "bg-orange-600 hover:bg-orange-700 text-white" : "text-orange-700 border-orange-200"}`}
        >
          <Repeat className="w-4 h-4" /> {repeatedOnly ? "عرض الكل" : "المكرر فقط"}
        </Button>
        <span className="text-sm text-muted-foreground">إجمالي: <strong>{displayed.length}</strong> عطل</span>
        <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-100 text-yellow-800">
          48 ساعة: <strong>{displayed.filter((f) => f.faultClass === "اعطال 48 ساعه").length}</strong>
        </span>
        <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-800">
          المتبقيات: <strong>{displayed.filter((f) => f.faultClass === "المتبقيات").length}</strong>
        </span>
        <Button
          variant="outline" size="sm"
          onClick={handleMeasureDZS}
          disabled={displayed.filter((f) => (f.accountNo ?? "").toString().trim() !== "").length === 0}
          className="text-blue-700 border-blue-200 gap-1"
          title="فتح DZS وقياس أرقام الأكونت المعروضة"
        >
          <Radar className="w-4 h-4" /> قياس DZS
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={handleExportExcel}
          disabled={displayed.length === 0}
          className="text-green-700 border-green-200 gap-1"
        >
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={handleExportPDF}
          disabled={displayed.length === 0}
          className="text-red-700 border-red-200 gap-1"
        >
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      {/* Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-xs" dir="rtl">
            <TableHeader className="bg-blue-900">
              <TableRow>
                <TableHead className="text-right font-bold text-white w-8">#</TableHead>
                <TableHead className="text-right font-bold text-white">السنترال</TableHead>
                <TableHead className="text-right font-bold text-white">التليفون</TableHead>
                <TableHead className="text-right font-bold text-white">تكرار</TableHead>
                <TableHead className="text-right font-bold text-white">Status Code</TableHead>
                <TableHead className="text-right font-bold text-white">MSAN</TableHead>
                <TableHead className="text-right font-bold text-white">Frame</TableHead>
                <TableHead className="text-right font-bold text-white">الكابينة</TableHead>
                <TableHead className="text-right font-bold text-white">البكس</TableHead>
                <TableHead className="text-right font-bold text-white">ترمنال</TableHead>
                <TableHead className="text-right font-bold text-white">وقت الشكوى</TableHead>
                <TableHead className="text-right font-bold text-white">نوع الشكوى</TableHead>
                <TableHead className="text-right font-bold text-white">تصنيف</TableHead>
                <TableHead className="text-right font-bold text-white">اسم الفنى</TableHead>
                <TableHead className="text-right font-bold text-white">رقم الأكونت</TableHead>
                <TableHead className="text-right font-bold text-white">قياس</TableHead>
                <TableHead className="text-right font-bold text-white">ONU</TableHead>
                <TableHead className="text-right font-bold text-white">كود العامل</TableHead>
                <TableHead className="text-right font-bold text-white">حياة كريمة</TableHead>
                <TableHead className="text-right font-bold text-white">نوع العطل</TableHead>
                <TableHead className="text-right font-bold text-white">Voice</TableHead>
                <TableHead className="text-right font-bold text-white">Data</TableHead>
                <TableHead className="text-right font-bold text-white">Shelf</TableHead>
                <TableHead className="text-right font-bold text-white">Slot</TableHead>
                <TableHead className="text-right font-bold text-white">Port</TableHead>
                <TableHead className="text-right font-bold text-white">كود السنترال</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={26} className="text-center py-16 text-muted-foreground">
                    {isFetching
                      ? "جاري التحميل..."
                      : repeatedOnly
                        ? "لا توجد أعطال مكررة حالياً"
                        : "لا توجد أعطال حالية — تأكد من رفع ملف شكاوى DSL الحالى"}
                  </TableCell>
                </TableRow>
              ) : displayed.map((f, i) => {
                const rowClass =
                  f.faultClass === "المتبقيات"     ? "bg-red-50 hover:bg-red-100" :
                  f.faultClass === "اعطال 48 ساعه" ? "bg-yellow-50 hover:bg-yellow-100" :
                  "hover:bg-muted/30";
                return (
                  <TableRow key={i} className={rowClass}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>{f.centralName || "-"}</TableCell>
                    <TableCell dir="ltr" className="text-left font-mono">{f.phoneShort || "-"}</TableCell>
                    <TableCell>
                      {f.repeatStatus === "مكرر" ? (
                        <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">مكرر</span>
                      ) : ""}
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate">{shortStatusCode(f.statusCode) || "-"}</TableCell>
                    <TableCell dir="ltr" className="text-left">{f.msanCode || "-"}</TableCell>
                    <TableCell>{f.frame || "-"}</TableCell>
                    <TableCell>{f.cabinetNo || "-"}</TableCell>
                    <TableCell>{f.boxNo || "-"}</TableCell>
                    <TableCell>{f.dpTerminal || "-"}</TableCell>
                    <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(f.complainTime)}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{f.complainTypeName || "-"}</TableCell>
                    <TableCell>{faultBadge(f.faultClass)}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{f.techName || "-"}</TableCell>
                    <TableCell dir="ltr" className="text-left font-mono">
                      {f.accountNo ? (
                        <span className="inline-flex items-center gap-1">
                          {f.accountNo}
                          <button
                            type="button"
                            onClick={() => openDZSSingle(f)}
                            title="فتح DZS وقياس هذا الرقم"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Radar className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ) : "-"}
                    </TableCell>
                    <TableCell><Measurement138Button m={f} /></TableCell>
                    <TableCell>{f.onu || "-"}</TableCell>
                    <TableCell>{f.workerCode || "-"}</TableCell>
                    <TableCell className="max-w-[100px] truncate">{f.hayaKarima || "-"}</TableCell>
                    <TableCell>{f.faultType || "-"}</TableCell>
                    <TableCell className="text-xs">{f.voiceStatus || "-"}</TableCell>
                    <TableCell className="text-xs">{f.dataStatus || "-"}</TableCell>
                    <TableCell>{f.shelf || "-"}</TableCell>
                    <TableCell>{f.slot || "-"}</TableCell>
                    <TableCell>{f.portNumber || "-"}</TableCell>
                    <TableCell>{f.centralCode || "-"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

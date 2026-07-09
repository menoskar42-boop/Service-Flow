import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, FileSpreadsheet, Printer, Phone, Radar, IdCard, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { openCustomer360 } from "@/lib/customer360";
import { openProfileOptimization } from "@/lib/profile-optimization";
import { Gauge } from "lucide-react";
import { maintStatusBadge, boxCoords, type MaintRow } from "@/components/MaintenanceComprehensiveReport";

// بوابة DZS expresse — تُفتح فى تاب جديد ويُمرَّر رقم الأكونت فى الـ hash ليقيسه
// الـ Tampermonkey script (dzs-expresse-v10.user.js) ويرفع النتيجة لشيت 138.
const DZS_URL = "https://10.42.187.101:8080/expresse/";
const buildDZSUrl = (accounts: string[]) =>
  `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;

interface LineData {
  telNo: string;
  central: string;
  cabinNumber: string | null;
  boxNumber: string | null;
  frame: string | null;
  msanCode: string | null;
  techName: string | null;
  iduNo: string | null;
  oduNo: string | null;
  primaryBlockNo: string | null;
  cabinetIn: string | null;
  secBlockNo: string | null;
  cabinetOut: string | null;
  dpTerminal: string | null;
  port: string | null;
  len: string | null;
  fiberBlock: string | null;
  fiberOut: string | null;
  fullPhone: string;
  accountNo: string | null;
  currentSpeed: string | null;
  maxSpeed: string | null;
  score: number | null;
  lastMeasTime: string | null;
  lastPoRaiseAt: string | null;
  lastPoStopAt: string | null;
  lastComplaintAt: string | null;
  portType: string | null;
  rowNo: string | null;
  columnNo: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  operator: string | null;
  shelf: string | null;
  slot: string | null;
}

const dash = (v: unknown) =>
  v === null || v === undefined || String(v).trim() === "" ? "-" : String(v);

const fmtDate = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const scoreBadge = (v: number | null) => {
  if (v == null) return <span className="text-gray-400">-</span>;
  const n = Number(v);
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-sm px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

// الحقول الفنية الباقية تُعرض كامل العرض (صف لكل حقل) بعد الصفوف المزدوجة (زى عمود الإكسيل اليمين)
const FULL_WIDTH_FIELDS = new Set<string>([
  "إحداثيات البكس",
  "operator", "shelf", "slot", "Port", "IDU", "ODU",
  "Primary Block", "Cabinet In", "Sec Block", "Cabinet Out", "Fiber Block", "Fiber Out",
]);

export function PhoneLookupReport() {
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState("");
  // عدّاد يتزايد مع كل ضغطة «بحث» — يدخل فى queryKey لإجبار إعادة التحميل حتى لو الرقم
  // نفسه لم يتغيّر (مثلاً بعد جلب الأكونت من Customer360 فى تاب تانى نرجع ونبحث فيتحدّث).
  const [searchSeq, setSearchSeq] = useState(0);

  const { data, isFetching, error } = useQuery({
    queryKey: ["/api/phone-lines/lookup", phone, searchSeq],
    queryFn: async () => {
      const res = await fetch(`/api/phone-lines/lookup?phone=${encodeURIComponent(phone)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("فشل البحث");
      return res.json() as Promise<{ found: boolean; line?: LineData }>;
    },
    enabled: !!phone,
    staleTime: 0,
  });

  const line = data?.found ? (data.line as LineData) : null;
  const search = () => { setPhone(input.trim()); setSearchSeq((s) => s + 1); };

  // حالة صيانة البكس من تقرير الصيانة الشامل (تطابق بالسنترال + الكابينة + البكس، الأحدث)
  const { data: boxMaint, isFetching: maintLoading } = useQuery({
    queryKey: ["/api/proxy/maintenance-comprehensive", line?.cabinNumber, line?.boxNumber, line?.central],
    enabled: !!line?.boxNumber,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (line?.cabinNumber) p.set("cabin", String(line.cabinNumber));
      if (line?.boxNumber) p.set("box", String(line.boxNumber));
      const res = await fetch(`/api/proxy/maintenance-comprehensive?${p}`, { credentials: "include" });
      if (!res.ok) return null;
      const j = await res.json();
      const rows: MaintRow[] = Array.isArray(j?.data) ? j.data : [];
      const bx = String(line?.boxNumber ?? "").trim();
      const cb = String(line?.cabinNumber ?? "").trim();
      const cn = String(line?.central ?? "").trim();
      const matches = rows.filter((r) =>
        String(r.box_number).trim() === bx &&
        (!cb || String(r.cabin_number).trim() === cb) &&
        (!cn || (r.central || "").includes(cn) || cn.includes(r.central || "")),
      );
      matches.sort((a, b) => String(b.inspection_date || "").localeCompare(String(a.inspection_date || "")));
      return matches[0] || null;
    },
  });
  const boxMaintCell: ReactNode = line?.boxNumber
    ? (boxMaint ? maintStatusBadge(boxMaint.maintenance_status, boxMaint.maintenance_status_ar)
                : (maintLoading ? <span className="text-gray-400">…</span> : <span className="text-gray-400">لا يوجد</span>))
    : <span className="text-gray-400">-</span>;

  // هل البكس له تذكرة عطل شبكة أرضية (CFM) مفتوحة؟
  const { data: boxGround, isFetching: groundLoading } = useQuery({
    queryKey: ["/api/proxy/box-ground-ticket", line?.central, line?.cabinNumber, line?.boxNumber],
    enabled: !!line?.boxNumber,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (line?.central) p.set("central", String(line.central));
      if (line?.cabinNumber) p.set("cabin", String(line.cabinNumber));
      if (line?.boxNumber) p.set("box", String(line.boxNumber));
      const res = await fetch(`/api/proxy/box-ground-ticket?${p}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ hasOpenTicket: boolean }>;
    },
  });
  const groundCell: ReactNode = line?.boxNumber
    ? (groundLoading && !boxGround ? <span className="text-gray-400">…</span>
       : boxGround?.hasOpenTicket
         ? <span className="text-sm px-2 py-0.5 rounded font-semibold bg-red-100 text-red-800">نعم</span>
         : <span className="text-sm px-2 py-0.5 rounded font-semibold bg-green-100 text-green-800">لا</span>)
    : <span className="text-gray-400">-</span>;

  // إحداثيات البكس من بيانات الصيانة (لو رقم البكس معروف)
  const coords = boxMaint ? boxCoords(boxMaint as any) : { text: "" };
  const coordsCell: ReactNode = !line?.boxNumber
    ? <span className="text-gray-400">-</span>
    : (coords.text
        ? ((coords.url || (coords.lat && coords.lng))
            ? <a className="text-blue-600 underline text-sm" href={coords.url || `https://www.google.com/maps?q=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">{coords.text} 📍</a>
            : <span className="text-sm">{coords.text}</span>)
        : (maintLoading ? <span className="text-gray-400">…</span> : <span className="text-gray-400">-</span>));

  // فتح بوابة DZS وقياس رقم الأكونت الخاص بالخط
  const measureDZS = () => {
    const acc = (line?.accountNo ?? "").toString().trim();
    if (!acc) { alert("لا يوجد رقم أكونت لهذا الخط — لا يمكن القياس"); return; }
    window.open(buildDZSUrl([acc]), "_blank");
  };

  // الترتيب مطابق للإكسيل: الشبكة RTL تملأ الخلية اليمنى ثم اليسرى فى كل صف —
  // فالمصفوفة مرتّبة: (يمين1, شمال1, يمين2, شمال2 …) للصفوف 1–12، ثم الحقول الفنية الباقية كامل العرض (صف لكل حقل).
  const fields: [string, ReactNode][] = line
    ? [
        // صف1: يمين | شمال
        ["رقم التليفون الكامل", dash(line.fullPhone)], ["رقم التليفون", dash(line.telNo)],
        ["السنترال", dash(line.central)],               ["اسم الفنى", dash(line.techName)],
        ["رقم الكابينة", dash(line.cabinNumber)],        ["رقم الأكونت", dash(line.accountNo)],
        ["رقم البكس", dash(line.boxNumber)],             ["السرعة الحالية", dash(line.currentSpeed)],
        ["DP Terminal", dash(line.dpTerminal)],          ["أقصى سرعة", dash(line.maxSpeed)],
        ["كود الكابينة (MSAN)", dash(line.msanCode)],    ["الاسكور", scoreBadge(line.score)],
        ["رقم الفريم", dash(line.frame)],                ["تاريخ آخر قياس", fmtDate(line.lastMeasTime)],
        ["Port Type", dash(line.portType)],              ["آخر رفع سرعة", fmtDate(line.lastPoRaiseAt)],
        ["voice status", dash(line.voiceStatus)],        ["آخر إيقاف PO", fmtDate(line.lastPoStopAt)],
        ["data status", dash(line.dataStatus)],          ["تاريخ آخر شكوى", fmtDate(line.lastComplaintAt)],
        ["Row", dash(line.rowNo)],                       ["حالة صيانة البكس", boxMaintCell],
        ["Column", dash(line.columnNo)],                 ["هل البكس له تكت أرضية", groundCell],
        // الحقول الفنية الباقية — كامل العرض (صف لكل حقل، عمود يمين فقط زى الإكسيل)
        ["إحداثيات البكس", coordsCell],
        ["operator", dash(line.operator)],
        ["shelf", dash(line.shelf)],
        ["slot", dash(line.slot)],
        ["Port", dash(line.port)],
        ["IDU", dash(line.iduNo)],
        ["ODU", dash(line.oduNo)],
        ["Primary Block", dash(line.primaryBlockNo)],
        ["Cabinet In", dash(line.cabinetIn)],
        ["Sec Block", dash(line.secBlockNo)],
        ["Cabinet Out", dash(line.cabinetOut)],
        ["Fiber Block", dash(line.fiberBlock)],
        ["Fiber Out", dash(line.fiberOut)],
      ]
    : [];

  const handleExportExcel = () => {
    if (!line) return;
    const row = {
      "رقم التليفون الكامل": line.fullPhone,
      "رقم التليفون": line.telNo,
      "السنترال": line.central,
      "اسم الفنى": line.techName ?? "",
      "رقم الكابينة": line.cabinNumber ?? "",
      "رقم الأكونت": line.accountNo ?? "",
      "رقم البكس": line.boxNumber ?? "",
      "السرعة الحالية": line.currentSpeed ?? "",
      "DP Terminal": line.dpTerminal ?? "",
      "أقصى سرعة": line.maxSpeed ?? "",
      "كود الكابينة (MSAN)": line.msanCode ?? "",
      "الاسكور": line.score ?? "",
      "رقم الفريم": line.frame ?? "",
      "تاريخ آخر قياس": fmtDate(line.lastMeasTime),
      "Port Type": line.portType ?? "",
      "آخر رفع سرعة": fmtDate(line.lastPoRaiseAt),
      "Row": line.rowNo ?? "",
      "آخر إيقاف PO": fmtDate(line.lastPoStopAt),
      "Column": line.columnNo ?? "",
      "تاريخ آخر شكوى": fmtDate(line.lastComplaintAt),
      "voice status": line.voiceStatus ?? "",
      "حالة صيانة البكس": boxMaint?.maintenance_status_ar ?? "",
      "data status": line.dataStatus ?? "",
      "هل البكس له تكت أرضية": line.boxNumber ? (boxGround?.hasOpenTicket ? "نعم" : "لا") : "",
      "operator": line.operator ?? "",
      "shelf": line.shelf ?? "",
      "slot": line.slot ?? "",
      "Port": line.port ?? "",
      "IDU": line.iduNo ?? "",
      "ODU": line.oduNo ?? "",
      "Primary Block": line.primaryBlockNo ?? "",
      "Cabinet In": line.cabinetIn ?? "",
      "Sec Block": line.secBlockNo ?? "",
      "Cabinet Out": line.cabinetOut ?? "",
      "Fiber Block": line.fiberBlock ?? "",
      "Fiber Out": line.fiberOut ?? "",
      "LEN": line.len ?? "",
    };
    const ws = XLSX.utils.json_to_sheet([row]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيانات الخط");
    XLSX.writeFile(wb, `line_${line.fullPhone}.xlsx`);
  };

  const handleExportPDF = () => {
    if (!line) return;
    printTablePDF({
      title: `بيانات الخط ${line.fullPhone}`,
      columns: ["السنترال", "الكابينة", "البكس", "حالة صيانة البكس", "تكت أرضية", "كود MSAN", "اسم الفنى", "الفريم", "الأكونت", "سرعة حالية", "أقصى سرعة", "الاسكور", "آخر قياس", "Port Type", "Row", "Column", "voice", "data", "operator", "shelf", "slot", "IDU", "ODU", "Primary Block", "Cabinet In", "Sec Block", "Cabinet Out", "DP Terminal", "Port", "LEN", "Fiber Block", "Fiber Out", "آخر رفع سرعة", "آخر إيقاف PO", "آخر شكوى"],
      rows: [[
        line.central, line.cabinNumber ?? "-", line.boxNumber ?? "-", boxMaint?.maintenance_status_ar ?? "-", line.boxNumber ? (boxGround?.hasOpenTicket ? "نعم" : "لا") : "-", line.msanCode ?? "-", line.techName ?? "-", line.frame ?? "-", line.accountNo ?? "-",
        line.currentSpeed ?? "-", line.maxSpeed ?? "-", line.score ?? "-", fmtDate(line.lastMeasTime),
        line.portType ?? "-", line.rowNo ?? "-", line.columnNo ?? "-", line.voiceStatus ?? "-", line.dataStatus ?? "-", line.operator ?? "-", line.shelf ?? "-", line.slot ?? "-",
        line.iduNo ?? "-", line.oduNo ?? "-", line.primaryBlockNo ?? "-", line.cabinetIn ?? "-", line.secBlockNo ?? "-",
        line.cabinetOut ?? "-", line.dpTerminal ?? "-", line.port ?? "-", line.len ?? "-", line.fiberBlock ?? "-", line.fiberOut ?? "-",
        fmtDate(line.lastPoRaiseAt), fmtDate(line.lastPoStopAt), fmtDate(line.lastComplaintAt),
      ]],
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Phone className="w-4 h-4 text-blue-600" />
            بحث برقم التليفون
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            اكتب رقم التليفون (كامل 88… أو القصير) لعرض بياناته الفنية وآخر قياس
          </p>
        </div>

        <div className="p-4 flex flex-wrap items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder="رقم التليفون…"
            className="w-full sm:w-64 text-sm"
            inputMode="numeric"
          />
          <Button onClick={search} disabled={!input.trim() || isFetching} className="gap-2">
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            بحث
          </Button>
          <Button
            variant="outline"
            onClick={() => setSearchSeq((s) => s + 1)}
            disabled={!phone || isFetching}
            className="gap-2"
            title="إعادة تحميل بيانات هذا الرقم من السيرفر (بعد جلب الأكونت أو قياس جديد)"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            تحديث
          </Button>
          {line && (
            <div className="flex items-center gap-2 sm:mr-auto">
              {line.accountNo ? (
                <>
                  <Button
                    variant="outline"
                    onClick={measureDZS}
                    className="bg-white gap-2 text-blue-700 border-blue-200"
                    title="فتح DZS وقياس هذا الرقم"
                  >
                    <Radar className="w-4 h-4" />
                    قياس DZS
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const afterStop = window.confirm("رفع السرعة والإيقاف؟\n\nموافق = رفع السرعة ثم إيقاف الـ Nightly الناتج\nإلغاء = رفع السرعة فقط");
                      openProfileOptimization([line.accountNo], { afterStop });
                    }}
                    className="bg-white gap-2 text-emerald-700 border-emerald-200"
                    title="تشغيل Profile Optimization (رفع السرعة) لهذا الرقم"
                  >
                    <Gauge className="w-4 h-4" />
                    رفع سرعة
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => openProfileOptimization([line.accountNo], { stopOnly: true })}
                    className="bg-white gap-2 text-orange-700 border-orange-200"
                    title="إيقاف الـ Nightly PO فقط (يرجّع الحالة Not Started) لهذا الرقم"
                  >
                    <Gauge className="w-4 h-4" />
                    إيقاف PO
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => openCustomer360([line.fullPhone])}
                  className="bg-white gap-2 text-purple-700 border-purple-200"
                  title="لا يوجد رقم أكونت — فتح Customer360 لجلب رقم الأكونت تلقائياً"
                >
                  <IdCard className="w-4 h-4" />
                  جلب الأكونت من Customer360
                </Button>
              )}
              <Button variant="outline" onClick={handleExportExcel} className="bg-white gap-2">
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                Excel
              </Button>
              <Button variant="outline" onClick={handleExportPDF} className="bg-white gap-2">
                <Printer className="w-4 h-4 text-red-600" />
                PDF
              </Button>
            </div>
          )}
        </div>
      </Card>

      {error && (
        <Card className="p-4 text-sm text-red-600 border-0 shadow-sm">حدث خطأ أثناء البحث</Card>
      )}

      {phone && !isFetching && data && !data.found && (
        <Card className="p-6 text-center text-muted-foreground border-0 shadow-sm">
          لا يوجد خط بالرقم <span className="font-semibold">{phone}</span>
        </Card>
      )}

      {line && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-gray-100">
            {fields.map(([label, value]) => {
              const fullWidth = FULL_WIDTH_FIELDS.has(label as string);
              return (
                <div
                  key={label}
                  className={`flex items-center justify-between gap-3 bg-white px-4 py-3 ${fullWidth ? "sm:col-span-2" : ""}`}
                >
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-sm font-semibold text-left">{value}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

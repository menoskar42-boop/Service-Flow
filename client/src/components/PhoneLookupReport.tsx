import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, FileSpreadsheet, Printer, Phone, Radar, IdCard } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { openCustomer360 } from "@/lib/customer360";

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
  dpTerminal: string | null;
  fullPhone: string;
  accountNo: string | null;
  currentSpeed: string | null;
  maxSpeed: string | null;
  score: number | null;
  lastMeasTime: string | null;
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

export function PhoneLookupReport() {
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState("");

  const { data, isFetching, error } = useQuery({
    queryKey: ["/api/phone-lines/lookup", phone],
    queryFn: async () => {
      const res = await fetch(`/api/phone-lines/lookup?phone=${encodeURIComponent(phone)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("فشل البحث");
      return res.json() as Promise<{ found: boolean; line?: LineData }>;
    },
    enabled: !!phone,
  });

  const line = data?.found ? (data.line as LineData) : null;
  const search = () => setPhone(input.trim());

  // فتح بوابة DZS وقياس رقم الأكونت الخاص بالخط
  const measureDZS = () => {
    const acc = (line?.accountNo ?? "").toString().trim();
    if (!acc) { alert("لا يوجد رقم أكونت لهذا الخط — لا يمكن القياس"); return; }
    window.open(buildDZSUrl([acc]), "_blank");
  };

  const fields: [string, ReactNode][] = line
    ? [
        ["رقم التليفون الكامل", dash(line.fullPhone)],
        ["رقم التليفون", dash(line.telNo)],
        ["السنترال", dash(line.central)],
        ["رقم الكابينة", dash(line.cabinNumber)],
        ["رقم البكس", dash(line.boxNumber)],
        ["رقم الفريم", dash(line.frame)],
        ["رقم الأكونت", dash(line.accountNo)],
        ["السرعة الحالية", dash(line.currentSpeed)],
        ["أقصى سرعة", dash(line.maxSpeed)],
        ["الاسكور", scoreBadge(line.score)],
        ["تاريخ آخر قياس", fmtDate(line.lastMeasTime)],
      ]
    : [];

  const handleExportExcel = () => {
    if (!line) return;
    const row = {
      "رقم التليفون الكامل": line.fullPhone,
      "رقم التليفون": line.telNo,
      "السنترال": line.central,
      "رقم الكابينة": line.cabinNumber ?? "",
      "رقم البكس": line.boxNumber ?? "",
      "رقم الفريم": line.frame ?? "",
      "السرعة الحالية": line.currentSpeed ?? "",
      "أقصى سرعة": line.maxSpeed ?? "",
      "الاسكور": line.score ?? "",
      "تاريخ آخر قياس": fmtDate(line.lastMeasTime),
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
      columns: ["السنترال", "الكابينة", "البكس", "الفريم", "سرعة حالية", "أقصى سرعة", "الاسكور", "آخر قياس"],
      rows: [[
        line.central, line.cabinNumber ?? "-", line.boxNumber ?? "-", line.frame ?? "-",
        line.currentSpeed ?? "-", line.maxSpeed ?? "-", line.score ?? "-", fmtDate(line.lastMeasTime),
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
          {line && (
            <div className="flex items-center gap-2 sm:mr-auto">
              {line.accountNo ? (
                <Button
                  variant="outline"
                  onClick={measureDZS}
                  className="bg-white gap-2 text-blue-700 border-blue-200"
                  title="فتح DZS وقياس هذا الرقم"
                >
                  <Radar className="w-4 h-4" />
                  قياس DZS
                </Button>
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
            {fields.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 bg-white px-4 py-3">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-semibold text-left">{value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

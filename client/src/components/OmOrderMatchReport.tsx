import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Check, Undo2, FileSpreadsheet, Printer, Link2 } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { arNorm } from "@shared/ar-norm";

// «ربط الطلبات بالمتعذرات الحالية» — سوبر أدمن فقط.
// بيطابق بالاسم (نسبة ≥ العتبة) وبيعرض الجهتين جنب بعض، وزر «تأكيد التطابق»
// بيزامن سبب الرد بين النظامين ويخلّى الاتنين يتحسبوا متعذر واحد على البكس.
interface Side {
  name: string | null; address: string | null; mobile: string | null;
  reason: string | null; notes: string | null; central: string | null;
  cabin: string | null; box: string | null; tech: string | null;
}
interface Pair {
  order: Side & { id: number; status: string; createdAt: string | null };
  om: (Side & { serial: string; phone: string | null; msan: string | null }) | null;
  score: number;
  matched?: number;
  confirmed: { serial: string; confirmedBy: string | null; confirmedAt: string | null } | null;
}

const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;

export function OmOrderMatchReport() {
  const qc = useQueryClient();
  const [minScore, setMinScore] = useState("0.7");
  const [q, setQ] = useState("");
  // فلتر ثلاثى: الكل / اللى اتضغط عليه تطابق / اللى لسه
  const [confFilter, setConfFilter] = useState<"all" | "done" | "todo">("all");
  const [busy, setBusy] = useState<number | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["/api/reports/om-order-match", minScore],
    queryFn: async () => {
      const res = await fetch(`/api/reports/om-order-match?minScore=${encodeURIComponent(minScore)}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json() as Promise<{ data: Pair[]; orders: number; omCases: number }>;
    },
    refetchOnMount: "always",
  });

  const all = data?.data ?? [];
  const rows = all.filter((p) => {
    if (confFilter === "done" && !p.confirmed) return false;
    if (confFilter === "todo" && p.confirmed) return false;
    if (!q.trim()) return true;
    const needle = arNorm(q);
    return [p.order.name, p.order.address, p.order.mobile, p.om?.name, p.om?.address, p.om?.serial]
      .some((v) => arNorm(v ?? "").includes(needle));
  });

  // بنقرا رسالة السيرفر الحقيقية ونعرضها. قبل كده كانت أى مشكلة بتطلع
  // «تعذّر تأكيد التطابق» من غير سبب — والمستخدم مايعرفش إن المتعذر مثلاً
  // مربوط بطلب تانى.
  const failMsg = async (res: Response, fallback: string) => {
    try { const j = await res.json(); return String(j?.message || fallback); }
    catch { return `${fallback} (${res.status})`; }
  };

  const confirm = async (p: Pair) => {
    if (!p.om) return;
    setBusy(p.order.id);
    try {
      const res = await fetch("/api/reports/om-order-match/confirm", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: p.order.id, serialNumber: p.om.serial, score: p.score }),
      });
      if (!res.ok) {
        const msg = await failMsg(res, "تعذّر تأكيد التطابق");
        // التقرير بقى قديم (حد تانى ربط المتعذر) → نحدّثه عشان الترشيح يتصحّح
        if (res.status === 409) qc.invalidateQueries({ queryKey: ["/api/reports/om-order-match"] });
        alert(msg);
        return;
      }
      // مش بننتظر إعادة التحميل — التقرير بيحسب المطابقة لكل الطلبات وبياخد وقت،
      // ولو استنيناه زر التأكيد يفضل بيلف. بنحدّث الصف محلياً والتحديث بيكمّل ورا.
      markConfirmed(p);
      qc.invalidateQueries({ queryKey: ["/api/reports/om-order-match"] });
    } catch (e: any) {
      alert(`تعذّر تأكيد التطابق: ${e?.message || "مشكلة فى الاتصال"}`);
    } finally { setBusy(null); }
  };

  // تحديث فورى للصف فى الكاش — عشان المستخدم يشوف النتيجة على طول
  const markConfirmed = (p: Pair) => {
    qc.setQueriesData<{ data: Pair[]; orders: number; omCases: number }>(
      { queryKey: ["/api/reports/om-order-match"] }, (old) => old && ({
        ...old,
        data: old.data.map((r) => r.order.id === p.order.id && p.om
          ? { ...r, confirmed: { serial: p.om.serial, confirmedBy: null, confirmedAt: null } } : r),
      }));
  };

  const unconfirm = async (p: Pair) => {
    setBusy(p.order.id);
    try {
      const res = await fetch(`/api/reports/om-order-match/${p.order.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { alert(await failMsg(res, "تعذّر إلغاء التطابق")); return; }
      qc.setQueriesData<{ data: Pair[]; orders: number; omCases: number }>(
        { queryKey: ["/api/reports/om-order-match"] }, (old) => old && ({
          ...old, data: old.data.map((r) => r.order.id === p.order.id ? { ...r, confirmed: null } : r),
        }));
      qc.invalidateQueries({ queryKey: ["/api/reports/om-order-match"] });
    } catch (e: any) {
      alert(`تعذّر إلغاء التطابق: ${e?.message || "مشكلة فى الاتصال"}`);
    } finally { setBusy(null); }
  };

  const excelRows = () => rows.map((p, i) => ({
    "#": i + 1,
    "نسبة التطابق": pct(p.score),
    "مستوى التطابق": p.matched ? (p.matched >= 4 ? "رباعى" : p.matched === 3 ? "ثلاثى" : "ثنائى") : "",
    "مؤكَّد": p.confirmed ? "نعم" : "لا",
    "العميل (طلبات)": p.order.name ?? "",
    "العنوان (طلبات)": p.order.address ?? "",
    "الموبايل (طلبات)": p.order.mobile ?? "",
    "الرد (طلبات)": p.order.reason ?? "",
    "العميل (متعذرات)": p.om?.name ?? "",
    "العنوان (متعذرات)": p.om?.address ?? "",
    "الموبايل (متعذرات)": p.om?.mobile ?? "",
    "الرد (متعذرات)": p.om?.reason ?? "",
    "المسلسل": p.om?.serial ?? "",
  }));

  const handleExcel = () => {
    const ws = XLSX.utils.json_to_sheet(excelRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ربط الطلبات بالمتعذرات");
    XLSX.writeFile(wb, "om-order-match.xlsx");
  };
  const handlePDF = () => printTablePDF({
    title: "ربط الطلبات بالمتعذرات الحالية",
    columns: ["#", "النسبة", "مؤكَّد", "العميل (طلبات)", "الرد (طلبات)", "العميل (متعذرات)", "الرد (متعذرات)", "المسلسل"],
    rows: rows.map((p, i) => [i + 1, pct(p.score), p.confirmed ? "نعم" : "لا",
      p.order.name ?? "", p.order.reason ?? "", p.om?.name ?? "", p.om?.reason ?? "", p.om?.serial ?? ""]),
  });

  const Cell = ({ v }: { v: any }) => <span className={v ? "" : "text-gray-400"}>{v || "—"}</span>;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              <Link2 className="w-4 h-4 text-indigo-600" /> ربط الطلبات بالمتعذرات الحالية
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              مطابقة بالاسم بالترتيب (الأقصر لازم يكون بادئة من الأطول) — {rows.length.toLocaleString("ar-EG")} تطابق
              {data ? ` (من ${data.orders.toLocaleString("ar-EG")} طلب و ${data.omCases.toLocaleString("ar-EG")} متعذر)` : ""}
              {" "}— «تأكيد التطابق» بينقل سبب الرد بين النظامين ويخلّيهم متعذر واحد على البكس
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">أقل نسبة</span>
              <select value={minScore} onChange={(e) => setMinScore(e.target.value)}
                      className="border rounded-md px-2 py-1.5 text-sm bg-white" dir="rtl">
                {["0.5", "0.6", "0.7", "0.8", "0.9", "1"].map((v) => (
                  <option key={v} value={v}>{pct(parseFloat(v))}</option>
                ))}
              </select>
            </div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم/العنوان/المسلسل…"
                   className="w-full sm:w-56 text-sm h-9" dir="rtl" />
            {/* الصفوف المؤكَّدة بتفضل ظاهرة (بزر تراجع) — الفلتر ده بيوضّح
                اللى خلص واللى لسه من غير ما يخفى حاجة نهائياً. */}
            <div className="flex items-center rounded-md border overflow-hidden">
              {([["all", `الكل (${all.length})`],
                 ["done", `تم التطابق (${all.filter((x) => x.confirmed).length})`],
                 ["todo", `لسه (${all.filter((x) => !x.confirmed).length})`]] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setConfFilter(k as any)}
                  className={`px-3 py-1.5 text-xs whitespace-nowrap ${
                    confFilter === k ? "bg-indigo-600 text-white font-semibold" : "bg-white hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={handleExcel} className="text-green-700 border-green-200 gap-1">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handlePDF} className="text-red-700 border-red-200 gap-1">
              <Printer className="w-4 h-4" /> PDF
            </Button>
          </div>
        </div>

        {isFetching ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold">النسبة</TableHead>
                  <TableHead className="text-right font-bold bg-blue-50">العميل (طلبات)</TableHead>
                  <TableHead className="text-right font-bold bg-blue-50">العنوان</TableHead>
                  <TableHead className="text-right font-bold bg-blue-50">الموبايل</TableHead>
                  <TableHead className="text-right font-bold bg-blue-50">الرد</TableHead>
                  <TableHead className="text-right font-bold bg-amber-50">العميل (متعذرات)</TableHead>
                  <TableHead className="text-right font-bold bg-amber-50">العنوان</TableHead>
                  <TableHead className="text-right font-bold bg-amber-50">الموبايل</TableHead>
                  <TableHead className="text-right font-bold bg-amber-50">الرد</TableHead>
                  <TableHead className="text-right font-bold">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">لا توجد تطابقات بالنسبة دى</TableCell></TableRow>
                ) : rows.map((p) => (
                  <TableRow key={p.order.id} className={p.confirmed ? "bg-emerald-50/60" : "hover:bg-muted/30"}>
                    <TableCell className="text-center font-bold whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded ${p.score >= 0.9 ? "bg-green-100 text-green-800" : p.score >= 0.7 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700"}`}>
                        {pct(p.score)}
                      </span>
                      {/* مستوى التطابق: كام اسم متتالى اتطابقوا من الأول */}
                      {p.matched ? (
                        <span className="block mt-0.5 text-[10px] font-normal text-muted-foreground">
                          {p.matched >= 4 ? "رباعى" : p.matched === 3 ? "ثلاثى" : "ثنائى"}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-[140px]"><Cell v={p.order.name} /></TableCell>
                    <TableCell className="min-w-[160px] max-w-[240px] break-words"><Cell v={p.order.address} /></TableCell>
                    <TableCell dir="ltr" className="text-left whitespace-nowrap"><Cell v={p.order.mobile} /></TableCell>
                    <TableCell className="min-w-[110px]"><Cell v={p.order.reason} /></TableCell>
                    <TableCell className="min-w-[140px]"><Cell v={p.om?.name} /></TableCell>
                    <TableCell className="min-w-[160px] max-w-[240px] break-words"><Cell v={p.om?.address} /></TableCell>
                    <TableCell dir="ltr" className="text-left whitespace-nowrap"><Cell v={p.om?.mobile} /></TableCell>
                    <TableCell className="min-w-[110px]"><Cell v={p.om?.reason} /></TableCell>
                    <TableCell className="whitespace-nowrap">
                      {p.confirmed ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">مؤكَّد</span>
                          <button onClick={() => unconfirm(p)} disabled={busy === p.order.id}
                                  title="إلغاء تأكيد التطابق" className="text-gray-500 hover:text-gray-700 disabled:opacity-40">
                            {busy === p.order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => confirm(p)} disabled={busy === p.order.id || !p.om}
                                title="تأكيد إن ده نفس العميل — بينقل سبب الرد بين النظامين"
                                className="inline-flex items-center gap-1 text-xs text-indigo-700 border border-indigo-300 rounded px-2 py-1 hover:bg-indigo-50 disabled:opacity-40">
                          {busy === p.order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          تأكيد التطابق
                        </button>
                      )}
                    </TableCell>
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

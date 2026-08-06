import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/RefreshButton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { Loader2, FileSpreadsheet, Printer, Ticket, PlayCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// تقريران فى ملف واحد لأنهما وجهان لنفس الميزة:
//   mode="backfill" → معاينة الطلبات/المتعذرات القديمة اللى فيها «بوكس معطل» + زر تنفيذ
//   mode="repaired" → المتعذرات اللى تكتها اتقفلت (اتصلحت فعلاً)
type Mode = "backfill" | "repaired";

const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const ACTION_LABEL: Record<string, { txt: string; cls: string }> = {
  will_open: { txt: "هيتفتحله تكت", cls: "bg-green-100 text-green-800" },
  covered:   { txt: "مغطّى بتكت مفتوحة", cls: "bg-amber-100 text-amber-800" },
  done:      { txt: "اتفتحت قبل كده", cls: "bg-gray-100 text-gray-700" },
  blocked:   { txt: "متعذّر — شوف السبب", cls: "bg-red-100 text-red-800" },
};

export function BoxFaultTicketsReport({ mode }: { mode: Mode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuper = user?.role === ROLES.SUPER_ADMIN;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [running, setRunning] = useState(false);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  // فلتر «اللى الفنى قال إن الإصلاح ماتمّش» — دى اللى الشئون الخارجية والأدمن
  // ومهندس الكوابل بيشوفوها عشان يعيدوا فتح التكت.
  const [onlyRejected, setOnlyRejected] = useState(false);

  const url = mode === "backfill"
    ? "/api/box-tickets/backfill-preview"
    : `/api/box-tickets/repaired?from=${from}&to=${to}`;

  const { data, isLoading, refetch } = useQuery({
    queryKey: [url],
    queryFn: async () => {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "تعذّر التحميل");
      return r.json() as Promise<any>;
    },
    refetchOnMount: "always",
  });

  const allRows: any[] = data?.data ?? [];
  const rows: any[] = mode === "repaired" && onlyRejected
    ? allRows.filter((r) => r.repairConfirm === "rejected")
    : allRows;

  // ردود الفنى على الإصلاح — الفنى (وكل مين ليه صلاحية) يقدر يقول اتصلح ولا لأ
  const canRespond = ([ROLES.TECH, ROLES.EXTERNAL, ROLES.ADMIN, ROLES.SUPER_ADMIN] as string[]).includes(user?.role ?? "");
  const canReopen = ([ROLES.EXTERNAL, ROLES.ADMIN, ROLES.SUPER_ADMIN] as string[]).includes(user?.role ?? "");

  const post = async (path: string, body: any, okMsg: string) => {
    setBusyRef(`${body.source}|${body.refKey}`);
    try {
      const r = await fetch(path, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message || "فشل الحفظ");
      toast({ title: d?.message || okMsg });
      refetch();
    } catch (e: any) {
      toast({ title: e?.message || "فشل الحفظ", variant: "destructive" });
    } finally { setBusyRef(null); }
  };

  const COLS: [string, (r: any) => any][] = mode === "backfill"
    ? [
        ["المصدر", (r) => r.source],
        ["المرجع", (r) => r.refKey],
        ["السنترال", (r) => r.central],
        ["الكابينة", (r) => r.cabinet],
        ["البكس", (r) => r.box],
        ["الفنى", (r) => r.techName],
        ["تاريخ رد الفنى", (r) => fmtDt(r.respondedAt)],
        ["الحالة", (r) => ACTION_LABEL[r.action]?.txt ?? r.action],
        ["التكت", (r) => r.ticketNumber ?? "-"],
        ["السبب", (r) => r.why ?? "-"],
      ]
    : [
        ["المصدر", (r) => r.source],
        ["المرجع", (r) => r.refKey],
        ["السنترال", (r) => r.central],
        ["الكابينة", (r) => r.cabinet],
        ["البكس", (r) => r.box],
        ["الفنى", (r) => r.techName],
        ["تاريخ رد الفنى", (r) => fmtDt(r.respondedAt)],
        ["رقم التكت", (r) => r.ticketNumber],
        ["نوع العطل", (r) => r.faultType],
        ["تاريخ الإغلاق", (r) => fmtDt(r.closedAt)],
        ["أغلقها", (r) => r.closedBy],
        ["وصف الإصلاح", (r) => r.repairDescription],
        ["رد الفنى على الإصلاح", (r) =>
          r.repairConfirm === "confirmed" ? `تم الإصلاح — ${r.repairConfirmBy ?? ""}`
          : r.repairConfirm === "rejected" ? `لسه معطّل — ${r.repairConfirmBy ?? ""}`
          : "لسه مارّدش"],
        ["ملاحظة الفنى", (r) => r.repairConfirmNote],
        ["تكت إعادة الفتح", (r) => r.reopenedTicketNumber],
        ["إجراء", () => ""],
      ];

  const title = mode === "backfill"
    ? "فحص «بوكس معطل» بأثر رجعى"
    : "متعذرات على بكسيات معطلة تم إصلاحها";

  const handleExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(COLS.map(([h, f]) => [h, f(r) ?? ""]))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيانات");
    XLSX.writeFile(wb, `${title}.xlsx`);
  };
  const handlePDF = () => printTablePDF({
    title, columns: COLS.map(([h]) => h), rows: rows.map((r) => COLS.map(([, f]) => f(r) ?? "-")),
  });

  // التنفيذ الفعلى — بيفتح تكتات حقيقية، فبنطلب تأكيد صريح بعدد اللى هيتفتح
  const runBackfill = async () => {
    const n = data?.counts?.willOpen ?? 0;
    if (!n) { toast({ title: "مفيش حاجة محتاجة تكت" }); return; }
    if (!window.confirm(`هيتفتح ${n} تكت جديدة على برنامج الكوابل. متأكد؟`)) return;
    setRunning(true);
    try {
      const r = await fetch("/api/box-tickets/backfill-run", { method: "POST", credentials: "include" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message || "فشل التنفيذ");
      // لو فيه فشل بنعرض سبب أول واحد — عشان مايفضلش الفشل صامت
      const firstWhy = d?.details?.failed?.[0]?.why;
      toast({
        title: `اتفتح ${d.opened} تكت — اتخطّى ${d.skipped}${d.failed ? ` — فشل ${d.failed}` : ""}`,
        description: firstWhy ? `سبب أول فشل: ${firstWhy}` : undefined,
        variant: d.failed ? "destructive" : undefined,
      });
      refetch();
    } catch (e: any) {
      toast({ title: e?.message || "فشل التنفيذ", variant: "destructive" });
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2"><Ticket className="w-4 h-4" /> {title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mode === "backfill" ? (
                <>
                  كل الطلبات والمتعذرات اللى الفنى سجّل فيها «بوكس معطل». الفحص ده <b>مابيفتحش حاجة</b> —
                  شوف القايمة الأول وبعدين اضغط «نفّذ».
                  {data?.counts && (
                    <span> {" "}— <b className="text-green-700">{data.counts.willOpen} هيتفتحلهم</b>،
                      {" "}{data.counts.covered} مغطّى بتكت مفتوحة، {data.counts.done} اتفتح قبل كده
                      {data.counts.blocked ? <>، <b className="text-red-700">{data.counts.blocked} متعذّر (شوف عمود السبب)</b></> : null}.</span>
                  )}
                </>
              ) : (
                <>التكتات اللى اتفتحت من Service-Flow ومهندس الكوابل نظّمها والشئون الخارجية أكّدتها (بقت مغلقة).
                  {data && <span> {" "}({data.total} تكت)</span>}</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "repaired" && (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 text-sm" />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 text-sm" />
                {/* اللى الفنى قال إن الإصلاح ماتمّش — دى اللى محتاجة إعادة فتح تكت */}
                <Button variant={onlyRejected ? "default" : "outline"} size="sm"
                  onClick={() => setOnlyRejected((v) => !v)}
                  className={`gap-1 ${onlyRejected ? "bg-red-700 hover:bg-red-800 text-white" : "text-red-700 border-red-300"}`}
                  title="الأعطال اللى الفنى رد وقال إن الإصلاح ماتمّش">
                  {onlyRejected
                    ? `لسه معطّلة فقط ✓ (${allRows.filter((r) => r.repairConfirm === "rejected").length})`
                    : `لسه معطّلة (${allRows.filter((r) => r.repairConfirm === "rejected").length})`}
                </Button>
              </>
            )}
            {mode === "backfill" && isSuper && (
              <Button size="sm" onClick={runBackfill} disabled={running || !data?.counts?.willOpen}
                className="gap-1 bg-green-700 hover:bg-green-800 text-white">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                نفّذ وافتح التكتات ({data?.counts?.willOpen ?? 0})
              </Button>
            )}
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExcel} className="gap-1 text-green-700 border-green-200">
              <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handlePDF} className="gap-1 text-red-700 border-red-200">
              <Printer className="w-4 h-4" /> تصدير PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-auto">
        {isLoading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">مفيش بيانات</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>{COLS.map(([h]) => <TableHead key={h} className="text-right whitespace-nowrap">{h}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.source}-${r.refKey}-${i}`}>
                  {COLS.map(([h, f]) => (
                    <TableCell key={h} className="whitespace-nowrap text-sm">
                      {h === "إجراء" ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {canRespond && r.repairConfirm !== "confirmed" && (
                            <Button variant="outline" size="sm" disabled={busyRef === `${r.source}|${r.refKey}`}
                              className="h-7 px-2 text-xs text-green-700 border-green-300"
                              onClick={() => post("/api/box-tickets/repair-confirm",
                                { source: r.source, refKey: r.refKey, confirm: "confirmed" }, "اتسجّل: تم الإصلاح")}>
                              تم الإصلاح
                            </Button>
                          )}
                          {canRespond && r.repairConfirm !== "rejected" && (
                            <Button variant="outline" size="sm" disabled={busyRef === `${r.source}|${r.refKey}`}
                              className="h-7 px-2 text-xs text-red-700 border-red-300"
                              onClick={() => {
                                const note = window.prompt("ليه لسه معطّل؟ (اختيارى)", "");
                                if (note === null) return;
                                post("/api/box-tickets/repair-confirm",
                                  { source: r.source, refKey: r.refKey, confirm: "rejected", note }, "اتسجّل: لسه معطّل");
                              }}>
                              لسه معطّل
                            </Button>
                          )}
                          {/* إعادة فتح التكت — بعد ما الفنى يقول إن الإصلاح ماتمّش */}
                          {canReopen && r.repairConfirm === "rejected" && !r.reopenedTicketNumber && (
                            <Button size="sm" disabled={busyRef === `${r.source}|${r.refKey}`}
                              className="h-7 px-2 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                              onClick={() => {
                                if (!window.confirm(`هيتفتح تكت جديدة على كابينة ${r.cabinet} بكس ${r.box}. متأكد؟`)) return;
                                post("/api/box-tickets/reopen", { source: r.source, refKey: r.refKey }, "اتفتحت تكت جديدة");
                              }}>
                              إعادة فتح تكت الكوابل
                            </Button>
                          )}
                          {r.reopenedTicketNumber && (
                            <span className="text-[11px] text-muted-foreground">اتفتحت: {r.reopenedTicketNumber}</span>
                          )}
                        </div>
                      ) : h === "الحالة" && mode === "backfill" ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ACTION_LABEL[r.action]?.cls ?? ""}`}>
                          {ACTION_LABEL[r.action]?.txt ?? r.action}
                        </span>
                      ) : (f(r) ?? "-")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight, ChevronLeft, Loader2, CalendarDays, Eye } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ROLES, SHIFT_STATES, SHIFT_COVER_STATES } from "@shared/schema";
import { CoverageGrantsPanel } from "@/components/CoverageGrantsPanel";

// «جدول الورديات» — جدول أسبوعى لورديات الفنيين. تنقّل بين الأسابيع بالأسهم،
// وكل خلية دروب ليست (عمل / راحه / إجازة / تكليف عمل / مأمورية). الفنى يشوف بدون تعديل؛
// الأدمن/السوبر أدمن/الشئون الخارجية يعدّلون. الحفظ تلقائى لكل صف فنى.

// الحالات مشتركة مع السيرفر (shared/schema.ts) — الحالة اللى فيها الفنى مش على كابينته
// بتفتح ليست «القائم بالعمل»، والسيرفر بيستخدم نفس القائمة فى مسئولية الأعطال وصلاحية
// الوصول لخطوط الزميل. لو اتعرّفت هنا بس، «القائم بالعمل» كان هيتسجّل والسيرفر يتجاهله.
const OPTIONS = [...SHIFT_STATES];            // الافتراضى: عمل
const COVER_STATES: readonly string[] = SHIFT_COVER_STATES;
const OPT_STYLE: Record<string, string> = {
  "عمل": "text-green-700 bg-green-50",
  "راحه": "text-amber-700 bg-amber-50",
  "إجازة": "text-red-700 bg-red-50",
  "تكليف عمل": "text-blue-700 bg-blue-50",
  "مأمورية": "text-purple-700 bg-purple-50",
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// جمعة الأسبوع (بداية الأسبوع)
const fridayOf = (d: Date) => { const x = new Date(d); const diff = (x.getDay() - 5 + 7) % 7; x.setDate(x.getDate() - diff); x.setHours(0, 0, 0, 0); return x; };
const arWeekday = new Intl.DateTimeFormat("ar-EG", { weekday: "long" });
const arDate = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long" });

interface WeekData {
  weekStart: string;
  techs: string[];
  rows: Record<string, { days: string[]; covers?: string[]; notes: string }>;
  canEdit: boolean;
}
type Row = { days: string[]; covers: string[]; notes: string };
const emptyRow = (): Row => ({ days: ["", "", "", "", "", "", ""], covers: ["", "", "", "", "", "", ""], notes: "" });

export function ShiftScheduleReport() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const [weekStart, setWeekStart] = useState(() => fridayOf(new Date()));
  const weekISO = isoLocal(weekStart);
  const isCurrentWeek = weekISO === isoLocal(fridayOf(new Date()));

  const { data, isFetching } = useQuery<WeekData>({
    queryKey: ["/api/shift-schedule", weekISO],
    queryFn: async () => {
      const r = await fetch(`/api/shift-schedule?weekStart=${weekISO}`, { credentials: "include" });
      if (!r.ok) throw new Error("فشل التحميل");
      return r.json();
    },
  });

  const canEdit = !!data?.canEdit;
  const techs = data?.techs ?? [];

  // نسخة محلية قابلة للتعديل (تُعاد تهيئتها مع كل تغيير أسبوع)
  const [draft, setDraft] = useState<Record<string, Row>>({});
  useEffect(() => {
    if (!data) return;
    const d: Record<string, Row> = {};
    for (const t of data.techs) {
      const row = data.rows[t];
      const days = (row?.days ?? []).slice(0, 7);
      while (days.length < 7) days.push("");
      const covers = (row?.covers ?? []).slice(0, 7);
      while (covers.length < 7) covers.push("");
      d[t] = { days, covers, notes: row?.notes ?? "" };
    }
    setDraft(d);
  }, [data]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const x = new Date(weekStart); x.setDate(x.getDate() + i); return x; }),
    [weekStart],
  );

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const save = (tech: string, row: Row, debounce = false) => {
    const doPut = () => {
      fetch("/api/shift-schedule", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: weekISO, techName: tech, days: row.days, covers: row.covers, notes: row.notes }),
      }).catch(() => {});
    };
    if (debounce) {
      if (saveTimers.current[tech]) clearTimeout(saveTimers.current[tech]);
      saveTimers.current[tech] = setTimeout(doPut, 700);
    } else doPut();
  };

  const setDay = (tech: string, i: number, val: string) => {
    setDraft((prev) => {
      const row = { ...(prev[tech] || emptyRow()) };
      const dd = [...row.days]; dd[i] = val;
      const cc = [...row.covers];
      if (!COVER_STATES.includes(val)) cc[i] = "";   // رجوعه لـ«عمل» يحذف الفنى القائم بالعمل
      const nr = { ...row, days: dd, covers: cc };
      save(tech, nr);
      return { ...prev, [tech]: nr };
    });
  };
  const setCover = (tech: string, i: number, val: string) => {
    setDraft((prev) => {
      const row = { ...(prev[tech] || emptyRow()) };
      const cc = [...row.covers]; cc[i] = val;
      const nr = { ...row, covers: cc };
      save(tech, nr);
      return { ...prev, [tech]: nr };
    });
  };
  const setNotes = (tech: string, val: string) => {
    setDraft((prev) => {
      const row = { ...(prev[tech] || emptyRow()) };
      const nr = { ...row, notes: val };
      save(tech, nr, true);
      return { ...prev, [tech]: nr };
    });
  };

  const prevWeek = () => setWeekStart((d) => { const x = new Date(d); x.setDate(x.getDate() - 7); return x; });
  const nextWeek = () => setWeekStart((d) => { const x = new Date(d); x.setDate(x.getDate() + 7); return x; });
  const thisWeek = () => setWeekStart(fridayOf(new Date()));

  return (
    <div className="space-y-4">
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-indigo-600" /> جدول الورديات
            {!canEdit && <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1 border rounded px-1.5 py-0.5"><Eye className="w-3 h-3" /> عرض فقط</span>}
          </h2>
          <p className="text-xs text-muted-foreground">جدول أسبوعى لورديات الفنيين — تنقّل بين الأسابيع بالأسهم. الحفظ تلقائى.</p>
        </div>
        {/* التنقّل بين الأسابيع */}
        <div className="flex items-center gap-2">
          <Button onClick={prevWeek} variant="outline" size="sm" className="gap-1" title="الأسبوع السابق"><ChevronRight className="w-4 h-4" /></Button>
          <div className="text-center min-w-[210px]">
            <div className="text-sm font-bold">{arDate.format(days[0])} — {arDate.format(days[6])}</div>
            {isCurrentWeek
              ? <span className="text-[11px] text-muted-foreground">الأسبوع الحالى</span>
              : <button onClick={thisWeek} className="text-[11px] text-indigo-600 hover:underline">↩ الرجوع للأسبوع الحالى</button>}
          </div>
          <Button onClick={nextWeek} variant="outline" size="sm" className="gap-1" title="الأسبوع التالى"><ChevronLeft className="w-4 h-4" /></Button>
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      <div className="rounded-md border max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-muted/60 z-10">
            <TableRow>
              <TableHead className="text-right whitespace-nowrap font-bold sticky right-0 bg-muted/60 z-20">الفنى</TableHead>
              {days.map((d, i) => (
                <TableHead key={i} className="text-center whitespace-nowrap font-bold min-w-[110px]">
                  <div>{arWeekday.format(d)}</div>
                  <div className="text-[11px] text-muted-foreground font-normal">{arDate.format(d)}</div>
                </TableHead>
              ))}
              <TableHead className="text-right whitespace-nowrap font-bold min-w-[160px]">ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {techs.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center h-24 text-muted-foreground">{isFetching ? "جارِ التحميل..." : "لا توجد أسماء فنيين"}</TableCell></TableRow>
            ) : techs.map((t) => {
              const row = draft[t] || emptyRow();
              return (
                <TableRow key={t}>
                  <TableCell className="whitespace-nowrap font-medium sticky right-0 bg-background z-10">{t}</TableCell>
                  {row.days.map((val, i) => (
                    <TableCell key={i} className="text-center p-1 align-top">
                      {canEdit ? (
                        <select
                          value={val || "عمل"}
                          onChange={(e) => setDay(t, i, e.target.value)}
                          className={`w-full text-xs rounded border px-1 py-1.5 text-center cursor-pointer ${OPT_STYLE[val || "عمل"] || "bg-background"}`}
                          dir="rtl"
                        >
                          {OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-block w-full text-xs rounded px-1 py-1.5 ${OPT_STYLE[val || "عمل"] || ""}`}>{val || "عمل"}</span>
                      )}
                      {/* عند راحه/إجازة/تكليف عمل/مأمورية: الفنى القائم بالعمل بدلاً منه */}
                      {COVER_STATES.includes(val) && (
                        canEdit ? (
                          <select
                            value={row.covers[i] || ""}
                            onChange={(e) => setCover(t, i, e.target.value)}
                            className="w-full mt-1 text-[11px] rounded border border-dashed px-1 py-1 text-center cursor-pointer bg-slate-50"
                            dir="rtl"
                            title="الفنى القائم بالعمل"
                          >
                            <option value="">القائم بالعمل…</option>
                            {techs.filter((x) => x !== t).map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                        ) : row.covers[i] ? (
                          <div className="mt-1 text-[11px] text-slate-600" title="الفنى القائم بالعمل">↩ {row.covers[i]}</div>
                        ) : null
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="p-1">
                    {canEdit ? (
                      <input
                        value={row.notes}
                        onChange={(e) => setNotes(t, e.target.value)}
                        className="w-full text-xs rounded border px-2 py-1.5 bg-background"
                        dir="rtl"
                        placeholder="—"
                      />
                    ) : (
                      <span className="text-xs">{row.notes || "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
    {isSuperAdmin && <CoverageGrantsPanel />}
    </div>
  );
}

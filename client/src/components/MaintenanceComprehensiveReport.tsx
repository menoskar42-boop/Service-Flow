import { useEffect, useState, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, AlertCircle, FileSpreadsheet, FileText, Check, X } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

export interface MaintChecklistItem {
  key: string; label: string; type: string; value: string | null;
  is_issue: boolean; is_done: boolean; notes: string | null;
  extra_type: string | null; extra_distance: number | null;
}
export interface MaintRow {
  inspection_id: number;
  central: string;
  central_prefix: string;
  cabin_number: string;
  box_number: string;
  inspection_date: string | null;
  work_date: string | null;
  inspector_name: string | null;
  technician_name: string | null;
  maintenance_status: string | null;
  maintenance_status_ar: string | null;
  box_status: string | null;
  prelim_confirmed: boolean;
  inspection_notes: string | null;
  maintenance_notes: string | null;
  has_issues: boolean;
  checklist: MaintChecklistItem[];
  completed_items: string[];
}

// لون شارة حالة الصيانة
export function maintStatusBadge(status: string | null, ar: string | null) {
  const cls =
    status === "completed"        ? "bg-green-100 text-green-800" :
    status === "in_progress"      ? "bg-blue-100 text-blue-700" :
    status === "pending"          ? "bg-amber-100 text-amber-700" :
    status === "pending_approval" ? "bg-purple-100 text-purple-700" :
                                    "bg-gray-100 text-gray-600";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold whitespace-nowrap ${cls}`}>{ar || "—"}</span>;
}

// يستخرج إحداثيات البكس من صف الصيانة (عمود «الإحداثيات» — قد يكون lat/lng أو لينك خرايط أو نص)
export function boxCoords(r: any): { text: string; lat?: string; lng?: string; url?: string } {
  if (!r || typeof r !== "object") return { text: "" };
  const norm = (k: string) => k.toLowerCase().replace(/[_\s-]/g, "");
  const findVal = (pred: (nk: string) => boolean) => {
    for (const k of Object.keys(r)) {
      if (pred(norm(k))) { const v = r[k]; if (v != null && String(v).trim() !== "" && String(v).trim() !== "0") return String(v).trim(); }
    }
    return "";
  };
  let lat = findVal((nk) => ["latitude", "lat", "boxlat", "boxlatitude", "خطالعرض"].includes(nk));
  let lng = findVal((nk) => ["longitude", "lng", "lon", "long", "boxlng", "boxlongitude", "خطالطول"].includes(nk));
  // حقل «الإحداثيات» المجمّع (لينك خرايط أو نص lat,lng)
  const raw = findVal((nk) => /(coordinate|احداثيات|إحداثيات|latlng|latlong|gps|geolocation|maplocation|mapurl|googlemap|gmap|maplink|location|map)/.test(nk));
  let url = "";
  if (raw && /^https?:\/\//i.test(raw)) {
    url = raw;
    const m = raw.match(/[?&]q=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/) || raw.match(/@(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/) || raw.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (m) { lat = lat || m[1]; lng = lng || m[2]; }
  } else if (raw && (!lat || !lng)) {
    const m = raw.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
    if (m) { lat = lat || m[1]; lng = lng || m[2]; }
  }
  if (lat && lng) return { text: `${lat}, ${lng}`, lat, lng, url: url || undefined };
  if (url) return { text: "فتح على الخريطة", url };
  if (raw) return { text: raw };
  return { text: "" };
}

interface Props {
  /** فلتر مبدئى اختيارى (لفتح التقرير على بكس واحد من زر التفاصيل) */
  initialCentral?: string;
  initialCabin?: string;
  initialBox?: string;
  embedded?: boolean; // داخل مودال (بدون عنوان كبير)
}

export function MaintenanceComprehensiveReport({ initialCentral = "", initialCabin = "", initialBox = "", embedded = false }: Props = {}) {
  const [rows, setRows] = useState<MaintRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCentral, setFilterCentral] = useState(initialCentral);
  const [filterCabinet, setFilterCabinet] = useState(initialCabin);
  const [filterBox, setFilterBox] = useState(initialBox);
  const [detailRow, setDetailRow] = useState<MaintRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/proxy/maintenance-comprehensive", { credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error((j as any).message || `خطأ ${res.status}`);
      setRows((j.data as MaintRow[]) ?? []);
    } catch (e: any) {
      setError(e.message || "تعذّر التحميل");
      setRows([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const centrals = useMemo(() => [...new Set(rows.map((r) => r.central).filter(Boolean))].sort(), [rows]);
  const cabinets = useMemo(
    () => [...new Set(rows.filter((r) => !filterCentral || r.central === filterCentral).map((r) => r.cabin_number).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ar", { numeric: true })),
    [rows, filterCentral],
  );

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterCentral && r.central !== filterCentral) return false;
    if (filterCabinet && r.cabin_number !== filterCabinet) return false;
    if (filterBox && String(r.box_number).trim() !== String(filterBox).trim()) return false;
    return true;
  }), [rows, filterCentral, filterCabinet, filterBox]);

  const handleExportExcel = () => {
    const data = filtered.map((r) => ({
      "السنترال": r.central, "الكابينه": r.cabin_number, "البكس": r.box_number,
      "التاريخ": r.inspection_date ?? "", "المراقب": r.inspector_name ?? "", "الفنى": r.technician_name ?? "",
      "حالة الصيانة": r.maintenance_status_ar ?? "", "به ملاحظات": r.has_issues ? "نعم" : "لا",
      "ملاحظات الفحص": r.inspection_notes ?? "", "ملاحظات الصيانة": r.maintenance_notes ?? "",
      "بنود بها مشاكل": r.checklist.filter((c) => c.is_issue).map((c) => c.label).join("، "),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الصيانة الشامل");
    XLSX.writeFile(wb, "maintenance-comprehensive.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "تقرير الصيانة الشامل",
      columns: ["#", "السنترال", "الكابينه", "البكس", "التاريخ", "المراقب", "الفنى", "حالة الصيانة", "ملاحظات"],
      rows: filtered.map((r, i) => [
        i + 1, r.central, r.cabin_number, r.box_number, r.inspection_date ?? "",
        r.inspector_name ?? "", r.technician_name ?? "", r.maintenance_status_ar ?? "",
        r.checklist.filter((c) => c.is_issue).map((c) => c.label).join("، "),
      ]),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            {!embedded && <h3 className="font-semibold text-base">تقرير الصيانة الشامل</h3>}
            <p className="text-xs text-muted-foreground mt-0.5">
              من نظام صيانة البوكسات — {filtered.length.toLocaleString("ar-EG")} بكس
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableCombobox
              options={centrals} value={filterCentral}
              onChange={(v) => { setFilterCentral(v); setFilterCabinet(""); }}
              placeholder="كل السنترالات" searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={cabinets} value={filterCabinet} onChange={setFilterCabinet}
              placeholder="كل الكباين" searchPlaceholder="ابحث في الكباين..."
              disabled={!filterCentral} className="w-full sm:w-36 text-sm"
            />
            <Input
              value={filterBox} onChange={(e) => setFilterBox(e.target.value)}
              placeholder="رقم البكس" className="w-28 h-9 text-sm" dir="ltr"
            />
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
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الكابينه</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">البكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">التاريخ</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">المراقب</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الفنى</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">حالة الصيانة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">بنود بها مشاكل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">تفاصيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-10">لا توجد بيانات صيانة</TableCell></TableRow>
                ) : filtered.map((r, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="whitespace-nowrap">{r.central}</TableCell>
                    <TableCell className="font-medium">{r.cabin_number}</TableCell>
                    <TableCell className="font-medium">{r.box_number}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.inspection_date ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.inspector_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.technician_name ?? "—"}</TableCell>
                    <TableCell>{maintStatusBadge(r.maintenance_status, r.maintenance_status_ar)}</TableCell>
                    <TableCell className="text-xs max-w-[220px] truncate text-red-700" title={r.checklist.filter((c) => c.is_issue).map((c) => c.label).join("، ")}>
                      {r.checklist.filter((c) => c.is_issue).map((c) => c.label).join("، ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDetailRow(r)}>تفاصيل</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {detailRow && <MaintBoxDetail row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  );
}

// مودال تفاصيل صيانة بكس واحد
export function MaintBoxDetail({ row, onClose }: { row: MaintRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-base">
              تفاصيل صيانة البكس {row.box_number} — كابينة {row.cabin_number} — {row.central}
            </h3>
            <div className="mt-1">{maintStatusBadge(row.maintenance_status, row.maintenance_status_ar)}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-muted-foreground">تاريخ الفحص:</span> {row.inspection_date ?? "—"}</div>
            <div><span className="text-muted-foreground">تاريخ الصيانة:</span> {row.work_date ?? "—"}</div>
            <div><span className="text-muted-foreground">المراقب:</span> {row.inspector_name ?? "—"}</div>
            <div><span className="text-muted-foreground">الفنى:</span> {row.technician_name ?? "—"}</div>
            {(() => {
              const c = boxCoords(row as any);
              if (!c.text) return null;
              return (
                <div className="col-span-2">
                  <span className="text-muted-foreground">إحداثيات البكس:</span>{" "}
                  {(c.url || (c.lat && c.lng))
                    ? <a className="text-blue-600 underline" href={c.url || `https://www.google.com/maps?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">{c.text} 📍</a>
                    : c.text}
                </div>
              );
            })()}
          </div>
          {row.inspection_notes && <div><span className="text-muted-foreground">ملاحظات الفحص:</span> {row.inspection_notes}</div>}
          {row.maintenance_notes && <div><span className="text-muted-foreground">ملاحظات الصيانة:</span> {row.maintenance_notes}</div>}

          <div>
            <h4 className="font-semibold mb-2">بنود الفحص</h4>
            <div className="overflow-x-auto">
              <Table className="text-right text-xs" dir="rtl">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-right font-bold">البند</TableHead>
                    <TableHead className="text-right font-bold">الحالة</TableHead>
                    <TableHead className="text-right font-bold">تفاصيل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {row.checklist.map((c, i) => (
                    <TableRow key={i} className={c.is_issue ? "bg-red-50" : ""}>
                      <TableCell className="whitespace-nowrap">{c.label}</TableCell>
                      <TableCell>
                        {c.is_issue
                          ? <span className="inline-flex items-center gap-1 text-red-700"><X className="w-3 h-3" /> مشكلة</span>
                          : <span className="inline-flex items-center gap-1 text-green-700"><Check className="w-3 h-3" /> سليم</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {[c.notes, c.extra_type, c.extra_distance != null ? `${c.extra_distance}م` : ""].filter(Boolean).join(" — ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

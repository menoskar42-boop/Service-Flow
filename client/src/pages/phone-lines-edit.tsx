import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { ROLES } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ArrowRight, RotateCcw, CheckCircle2, Pencil, X, LogOut } from "lucide-react";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { format } from "date-fns";

type EditStatus = "pending" | "completed" | "rolled_back";

interface PhoneLineEdit {
  id: number;
  phoneLineId: number;
  fullPhone: string;
  central: string;
  oldCabinNumber: string | null;
  newCabinNumber: string | null;
  oldBoxNumber: string | null;
  newBoxNumber: string | null;
  oldDpTerminal: string | null;
  newDpTerminal: string | null;
  status: EditStatus;
  editedById: number;
  editedByName: string;
  editedAt: string;
  confirmedByName: string | null;
  confirmedAt: string | null;
  rolledBackByName: string | null;
  rolledBackAt: string | null;
}

interface PhoneLine {
  id: number;
  telNo: string;
  central: string;
  cabinNumber: string | null;
  boxNumber: string | null;
  dpTerminal: string | null;
  fullPhone: string;
}

type ReportTab = "pending" | "completed" | "all";

export default function PhoneLinesEditPage() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<ReportTab>("pending");
  const [searchLine, setSearchLine] = useState("");
  const [searchEdits, setSearchEdits] = useState("");

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCentral, setEditCentral] = useState("");
  const [originalCabin, setOriginalCabin] = useState("");
  const [editCabin, setEditCabin] = useState("");
  const [editBox, setEditBox] = useState("");
  const [editDp, setEditDp] = useState("");
  const [editCabinetIn, setEditCabinetIn] = useState("");

  // الشئون الخارجية تشوف وتعمل زى الفنى بالظبط فى صفحة البيانات الفنية
  const isTechLike = user?.role === ROLES.TECH || user?.role === ROLES.EXTERNAL;
  const canEdit = isTechLike || user?.role === ROLES.ADMIN;
  const canRollback = isTechLike || user?.role === ROLES.ADMIN;
  const canConfirm = user?.role === ROLES.DATA_MANAGER;

  // --- Phone lines search ---
  const { data: linesData, isFetching: linesFetching } = useQuery({
    queryKey: ["/api/phone-lines", searchLine],
    queryFn: async () => {
      if (!searchLine.trim()) return { data: [], total: 0 };
      const res = await fetch(
        `/api/phone-lines?search=${encodeURIComponent(searchLine)}&limit=30`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: PhoneLine[]; total: number }>;
    },
    enabled: !!searchLine.trim(),
  });

  // --- Edits list ---
  const statusParam = activeTab === "all" ? "" : activeTab;
  const { data: edits, isLoading: editsLoading } = useQuery({
    queryKey: ["/api/phone-lines/edits", statusParam, searchEdits],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusParam) params.set("status", statusParam);
      if (searchEdits.trim()) params.set("search", searchEdits.trim());
      const res = await fetch(`/api/phone-lines/edits?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch edits");
      return res.json() as Promise<PhoneLineEdit[]>;
    },
  });

  // --- Field options: cabins + boxes + cabinetIns (keyed on central+cabin only, stable when box changes) ---
  const { data: fieldOptions, isFetching: optsFetching } = useQuery({
    queryKey: ["/api/phone-lines/field-options", editCentral, editCabin],
    queryFn: async () => {
      if (!editCentral) return { cabins: [] as string[], boxes: [] as string[], cabinetIns: [] as string[] };
      const params = new URLSearchParams({ central: editCentral });
      if (editCabin) params.set("cabin", editCabin);
      const res = await fetch(`/api/phone-lines/field-options?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ cabins: string[]; boxes: string[]; cabinetIns: string[] }>;
    },
    enabled: !!editCentral,
  });

  // DP Terminal validation: numeric 1-100
  const isDpValid = (v: string) => /^\d+$/.test(v) && parseInt(v) >= 1 && parseInt(v) <= 100;
  const dpError = (v: string) => v && !isDpValid(v) ? "يجب أن يكون رقماً من 1 إلى 100" : "";
  const handleDpChange = (raw: string) => setEditDp(raw.replace(/\D/g, ""));

  // --- Mutations ---
  const editMutation = useMutation({
    mutationFn: async ({ id, cabin, box, dp, cabinetIn }: { id: number; cabin: string; box: string; dp: string; cabinetIn?: string }) => {
      const res = await fetch(`/api/phone-lines/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cabinNumber: cabin, boxNumber: box, dpTerminal: dp, cabinetIn }),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* non-JSON response */ }
      if (!res.ok) {
        const err = Object.assign(new Error(data.message || `خطأ ${res.status}`), { data, status: res.status });
        throw err;
      }
      return data;
    },
    onSuccess: () => {
      toast({ title: "تم حفظ التعديل بنجاح" });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/edits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/phone-lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/box-summary"] });
    },
    onError: (err: any) => {
      const conflict = err.data?.conflictLine;
      if (conflict) {
        toast({
          variant: "destructive",
          title: "تعارض في البيانات",
          description: `هذه البيانات مستخدمة مع الخط: ${conflict.fullPhone}`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "فشل حفظ التعديل",
          description: err.message,
        });
      }
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (editId: number) => {
      const res = await fetch(`/api/phone-lines/edits/${editId}/rollback`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "فشل التراجع");
      return data;
    },
    onSuccess: () => {
      toast({ title: "تم التراجع عن التعديل" });
      queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/edits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/phone-lines", searchLine] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "خطأ", description: err.message }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (editId: number) => {
      const res = await fetch(`/api/phone-lines/edits/${editId}/confirm`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "فشل التأكيد");
      return data;
    },
    onSuccess: () => {
      toast({ title: "تم تأكيد الانتهاء" });
      queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/edits"] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "خطأ", description: err.message }),
  });

  const startEdit = (line: PhoneLine) => {
    setEditingId(line.id);
    setEditCentral(line.central);
    setOriginalCabin(line.cabinNumber || "");
    setEditCabin(line.cabinNumber || "");
    setEditBox(line.boxNumber || "");
    setEditDp(line.dpTerminal || "");
    setEditCabinetIn("");
  };

  const statusBadge = (s: EditStatus) => {
    if (s === "pending") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">تحت التنفيذ</Badge>;
    if (s === "completed") return <Badge className="bg-green-100 text-green-800 border-green-200">تم التنفيذ</Badge>;
    return <Badge className="bg-gray-100 text-gray-600 border-gray-200">تم التراجع</Badge>;
  };

  const tabBtn = (tab: ReportTab, label: string) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
            <ArrowRight className="w-4 h-4 ml-1" />
            رجوع
          </Button>
          <h1 className="font-bold text-base">إدارة البيانات الفنية للخطوط</h1>
        </div>
        {user?.role === ROLES.DATA_MANAGER && (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => logout()}>
            <LogOut className="w-4 h-4 ml-1" />
            تسجيل خروج
          </Button>
        )}
      </header>

      <main className="max-w-6xl mx-auto p-4 space-y-6">

        {/* ── Search & Edit Section (tech + admin only) ── */}
        {canEdit && (
          <Card className="p-4 space-y-3">
            <h2 className="font-semibold text-sm">البحث وتعديل خط</h2>
            <Input
              placeholder="ابحث برقم الخط كاملاً أو جزء منه..."
              value={searchLine}
              onChange={(e) => { setSearchLine(e.target.value); setEditingId(null); }}
              className="max-w-sm text-sm"
            />
            {linesFetching && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> جاري البحث...
              </div>
            )}
            {linesData && linesData.data.length > 0 && isMobile && (
              <div className="space-y-2">
                {linesData.data.map((line) => (
                  <div key={line.id} className="border rounded-lg p-3 space-y-2 bg-white">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono font-semibold text-sm">{line.fullPhone}</div>
                      {editingId === line.id ? (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingId(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="h-7" onClick={() => startEdit(line)}>
                          <Pencil className="w-3 h-3 ml-1" /> تعديل
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{line.central}</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><span className="text-muted-foreground">كابينه:</span> <span className="font-medium">{line.cabinNumber || "—"}</span></div>
                      <div><span className="text-muted-foreground">بكس:</span> <span className="font-medium">{line.boxNumber || "—"}</span></div>
                      <div><span className="text-muted-foreground">DP Terminal:</span> <span className="font-medium">{line.dpTerminal || "—"}</span></div>
                    </div>
                    {editingId === line.id && (
                      <div className="space-y-2 pt-2 border-t bg-blue-50 -mx-3 px-3 pb-3 mt-2 rounded-b-lg">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">الكابينه</label>
                          <SearchableCombobox
                            options={fieldOptions?.cabins || []}
                            value={editCabin}
                            onChange={(val) => { setEditCabin(val); setEditBox(""); setEditDp(""); setEditCabinetIn(""); }}
                            placeholder="اختر الكابينه"
                            searchPlaceholder="ابحث..."
                          />
                        </div>
                        {editCabin && editCabin !== originalCabin && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-orange-700">قيمة الدخل (cabinet_in) *</label>
                            <SearchableCombobox
                              options={fieldOptions?.cabinetIns || []}
                              value={editCabinetIn}
                              onChange={setEditCabinetIn}
                              placeholder="اختر قيمة الدخل"
                              searchPlaceholder="ابحث..."
                            />
                          </div>
                        )}
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">البكس {optsFetching && "(جارٍ التحميل...)"}</label>
                          <SearchableCombobox
                            options={fieldOptions?.boxes || []}
                            value={editBox}
                            onChange={(val) => { setEditBox(val); setEditDp(""); }}
                            placeholder={optsFetching ? "جارٍ التحميل..." : "اختر البكس"}
                            searchPlaceholder="ابحث..."
                            disabled={!editCabin || optsFetching}
                          />
                          {!optsFetching && editCabin && (fieldOptions?.boxes?.length || 0) === 0 && (
                            <p className="text-xs text-amber-600">⚠️ لا توجد بكسيات لهذه الكابينه في قاعدة البيانات</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">DP Terminal (1-100)</label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={editDp}
                            onChange={(e) => handleDpChange(e.target.value)}
                            placeholder="رقم من 1 إلى 100"
                            className={`h-9 text-sm ${dpError(editDp) ? "border-destructive focus-visible:ring-destructive" : ""}`}
                            disabled={!editBox}
                          />
                          {dpError(editDp) && <p className="text-xs text-destructive">{dpError(editDp)}</p>}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            disabled={editMutation.isPending || !isDpValid(editDp) || (editCabin !== originalCabin && !editCabinetIn)}
                            onClick={() => editMutation.mutate({ id: line.id, cabin: editCabin, box: editBox, dp: editDp, cabinetIn: editCabinetIn || undefined })}
                            className="flex-1 h-9"
                          >
                            {editMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ"}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-9" onClick={() => setEditingId(null)}>
                            إلغاء
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {linesData.total > 30 && (
                  <p className="text-xs text-muted-foreground mt-2 px-1">يظهر أول 30 نتيجة من {linesData.total.toLocaleString("ar-EG")} — دقق في البحث</p>
                )}
              </div>
            )}
            {linesData && linesData.data.length > 0 && !isMobile && (
              <div className="overflow-x-auto">
                <Table className="text-sm text-right">
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-right">رقم الخط</TableHead>
                      <TableHead className="text-right">السنترال</TableHead>
                      <TableHead className="text-right">الكابينه</TableHead>
                      <TableHead className="text-right">البكس</TableHead>
                      <TableHead className="text-right">DP Terminal</TableHead>
                      <TableHead className="text-right w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linesData.data.map((line) => (
                      <>
                        <TableRow key={line.id} className="hover:bg-muted/20">
                          <TableCell className="font-mono">{line.fullPhone}</TableCell>
                          <TableCell>{line.central}</TableCell>
                          <TableCell>{line.cabinNumber || "—"}</TableCell>
                          <TableCell>{line.boxNumber || "—"}</TableCell>
                          <TableCell>{line.dpTerminal || "—"}</TableCell>
                          <TableCell>
                            {editingId === line.id ? (
                              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                <X className="w-4 h-4" />
                              </Button>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => startEdit(line)}>
                                <Pencil className="w-3 h-3 ml-1" /> تعديل
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>

                        {/* Inline edit form */}
                        {editingId === line.id && (
                          <TableRow key={`edit-${line.id}`} className="bg-blue-50">
                            <TableCell colSpan={6}>
                              <div className="flex flex-wrap gap-3 items-end py-2">
                                <div className="space-y-1 w-40">
                                  <label className="text-xs text-muted-foreground">الكابينه</label>
                                  <SearchableCombobox
                                    options={fieldOptions?.cabins || []}
                                    value={editCabin}
                                    onChange={(val) => { setEditCabin(val); setEditBox(""); setEditDp(""); setEditCabinetIn(""); }}
                                    placeholder="اختر الكابينه"
                                    searchPlaceholder="ابحث..."
                                  />
                                </div>
                                {editCabin && editCabin !== originalCabin && (
                                  <div className="space-y-1 w-40">
                                    <label className="text-xs font-medium text-orange-700">قيمة الدخل *</label>
                                    <SearchableCombobox
                                      options={fieldOptions?.cabinetIns || []}
                                      value={editCabinetIn}
                                      onChange={setEditCabinetIn}
                                      placeholder="اختر قيمة الدخل"
                                      searchPlaceholder="ابحث..."
                                    />
                                  </div>
                                )}
                                <div className="space-y-1 w-36">
                                  <label className="text-xs text-muted-foreground">البكس {optsFetching && "..."}</label>
                                  <SearchableCombobox
                                    options={fieldOptions?.boxes || []}
                                    value={editBox}
                                    onChange={(val) => { setEditBox(val); setEditDp(""); }}
                                    placeholder={optsFetching ? "جارٍ التحميل..." : "اختر البكس"}
                                    searchPlaceholder="ابحث..."
                                    disabled={!editCabin || optsFetching}
                                  />
                                  {!optsFetching && editCabin && (fieldOptions?.boxes?.length || 0) === 0 && (
                                    <p className="text-xs text-amber-600">⚠️ لا توجد بكسيات</p>
                                  )}
                                </div>
                                <div className="space-y-1 w-36">
                                  <label className="text-xs text-muted-foreground">DP Terminal (1-100)</label>
                                  <Input
                                    type="text"
                                    inputMode="numeric"
                                    value={editDp}
                                    onChange={(e) => handleDpChange(e.target.value)}
                                    placeholder="1-100"
                                    className={`h-9 text-sm ${dpError(editDp) ? "border-destructive focus-visible:ring-destructive" : ""}`}
                                    disabled={!editBox}
                                  />
                                  {dpError(editDp) && <p className="text-xs text-destructive mt-1">{dpError(editDp)}</p>}
                                </div>
                                <Button
                                  size="sm"
                                  disabled={editMutation.isPending || !isDpValid(editDp) || (editCabin !== originalCabin && !editCabinetIn)}
                                  onClick={() => editMutation.mutate({ id: line.id, cabin: editCabin, box: editBox, dp: editDp, cabinetIn: editCabinetIn || undefined })}
                                  className="h-9"
                                >
                                  {editMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "حفظ"}
                                </Button>
                                <Button variant="ghost" size="sm" className="h-9" onClick={() => setEditingId(null)}>
                                  إلغاء
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
                {linesData.total > 30 && (
                  <p className="text-xs text-muted-foreground mt-2 px-1">يظهر أول 30 نتيجة من {linesData.total.toLocaleString("ar-EG")} — دقق في البحث</p>
                )}
              </div>
            )}
            {linesData && linesData.data.length === 0 && searchLine.trim() && !linesFetching && (
              <p className="text-sm text-muted-foreground">لا توجد نتائج</p>
            )}
          </Card>
        )}

        {/* ── Edits Reports ── */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-sm">سجل التعديلات الفنية</h2>
            <div className="flex items-center gap-2">
              <Input
                placeholder="بحث برقم الخط..."
                value={searchEdits}
                onChange={(e) => setSearchEdits(e.target.value)}
                className="w-44 h-8 text-sm"
              />
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="px-4 py-2 border-b bg-muted/30 flex gap-1">
            {tabBtn("pending", "تحت التنفيذ")}
            {tabBtn("completed", "تم التنفيذ")}
            {tabBtn("all", "جميع التعديلات")}
          </div>

          {editsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !edits || edits.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">لا توجد بيانات</p>
          ) : isMobile ? (
            <div className="p-3 space-y-3">
              {edits.map((edit, idx) => (
                <div key={edit.id} className="border rounded-lg p-3 bg-white space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono font-semibold text-sm">{edit.fullPhone}</div>
                    {statusBadge(edit.status)}
                  </div>
                  <div className="text-xs text-muted-foreground">{edit.central}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                    <div className="space-y-0.5 bg-gray-50 p-2 rounded">
                      <div className="text-muted-foreground font-medium mb-1">القديم</div>
                      <div>كابينه: <span dir="ltr" className="inline-block">{edit.oldCabinNumber || "—"}</span></div>
                      <div>بكس: <span dir="ltr" className="inline-block">{edit.oldBoxNumber || "—"}</span></div>
                      <div>DP Terminal: <span dir="ltr" className="inline-block">{edit.oldDpTerminal || "—"}</span></div>
                    </div>
                    <div className="space-y-0.5 bg-blue-50 p-2 rounded">
                      <div className="text-muted-foreground font-medium mb-1">الجديد</div>
                      <div className="font-medium">كابينه: <span dir="ltr" className="inline-block">{edit.newCabinNumber || "—"}</span></div>
                      <div className="font-medium">بكس: <span dir="ltr" className="inline-block">{edit.newBoxNumber || "—"}</span></div>
                      <div className="font-medium">DP Terminal: <span dir="ltr" className="inline-block">{edit.newDpTerminal || "—"}</span></div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-between pt-1 border-t">
                    <span>{edit.editedByName}</span>
                    <span>{format(new Date(edit.editedAt), "yyyy-MM-dd HH:mm")}</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    {canRollback && edit.status === "pending" && (user?.role === ROLES.ADMIN || edit.editedById === user?.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50 h-8 text-xs flex-1"
                        disabled={rollbackMutation.isPending}
                        onClick={() => rollbackMutation.mutate(edit.id)}
                      >
                        <RotateCcw className="w-3 h-3 ml-1" /> تراجع
                      </Button>
                    )}
                    {canConfirm && edit.status === "pending" && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 h-8 text-xs flex-1"
                        disabled={confirmMutation.isPending}
                        onClick={() => confirmMutation.mutate(edit.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 ml-1" /> تأكيد الانتهاء
                      </Button>
                    )}
                    {edit.status === "completed" && (
                      <span className="text-xs text-green-700">✓ تم التأكيد بواسطة {edit.confirmedByName}</span>
                    )}
                    {edit.status === "rolled_back" && (
                      <span className="text-xs text-gray-500">↩ تم التراجع بواسطة {edit.rolledBackByName}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-sm text-right">
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-right">#</TableHead>
                    <TableHead className="text-right">رقم الخط</TableHead>
                    <TableHead className="text-right">السنترال</TableHead>
                    <TableHead className="text-right">البيان القديم</TableHead>
                    <TableHead className="text-right">البيان الجديد</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">الفني</TableHead>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-right w-36"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {edits.map((edit, idx) => (
                    <TableRow key={edit.id} className="hover:bg-muted/20">
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{edit.fullPhone}</TableCell>
                      <TableCell className="whitespace-nowrap">{edit.central}</TableCell>
                      <TableCell>
                        <div className="text-xs space-y-0.5 text-muted-foreground">
                          <div>كابينه: <span dir="ltr" className="inline-block">{edit.oldCabinNumber || "—"}</span></div>
                          <div>بكس: <span dir="ltr" className="inline-block">{edit.oldBoxNumber || "—"}</span></div>
                          <div>DP Terminal: <span dir="ltr" className="inline-block">{edit.oldDpTerminal || "—"}</span></div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs space-y-0.5 font-medium">
                          <div>كابينه: <span dir="ltr" className="inline-block">{edit.newCabinNumber || "—"}</span></div>
                          <div>بكس: <span dir="ltr" className="inline-block">{edit.newBoxNumber || "—"}</span></div>
                          <div>DP Terminal: <span dir="ltr" className="inline-block">{edit.newDpTerminal || "—"}</span></div>
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(edit.status)}</TableCell>
                      <TableCell>{edit.editedByName}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {format(new Date(edit.editedAt), "yyyy-MM-dd HH:mm")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {canRollback && edit.status === "pending" && (user?.role === ROLES.ADMIN || edit.editedById === user?.id) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 border-red-200 hover:bg-red-50 h-7 text-xs"
                              disabled={rollbackMutation.isPending}
                              onClick={() => rollbackMutation.mutate(edit.id)}
                            >
                              <RotateCcw className="w-3 h-3 ml-1" /> تراجع
                            </Button>
                          )}
                          {canConfirm && edit.status === "pending" && (
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 h-7 text-xs"
                              disabled={confirmMutation.isPending}
                              onClick={() => confirmMutation.mutate(edit.id)}
                            >
                              <CheckCircle2 className="w-3 h-3 ml-1" /> تأكيد الانتهاء
                            </Button>
                          )}
                          {edit.status === "completed" && (
                            <span className="text-xs text-green-700">
                              ✓ {edit.confirmedByName}
                            </span>
                          )}
                          {edit.status === "rolled_back" && (
                            <span className="text-xs text-gray-500">
                              ↩ {edit.rolledBackByName}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

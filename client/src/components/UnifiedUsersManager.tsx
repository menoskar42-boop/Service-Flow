import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, UsersRound, UserPlus, KeyRound, Trash2 } from "lucide-react";

// بوابة إدارة المستخدمين الموحّدة (سوبر أدمن فقط):
// حساب واحد للموقعين — الدور الموحّد يحدّد دور الطلبات ودور الكوابل، والدخول موحّد (SSO).
interface UnifiedRoleOpt { key: string; labelAr: string; sf: string | null; cfm: string | null; }
interface PortalUser {
  sfId: number | null; username: string; sfRole: string | null; workerCode: string | null;
  suspended: boolean; cfmId: string | null; cfmRole: string | null; unifiedRole: string;
}

const api = async (url: string, opts?: RequestInit) => {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || "خطأ");
  return data;
};

export function UnifiedUsersManager() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: roles = [] } = useQuery<UnifiedRoleOpt[]>({
    queryKey: ["/api/portal/roles"], enabled: open,
    queryFn: () => api("/api/portal/roles"),
  });
  const { data: users = [], isLoading } = useQuery<PortalUser[]>({
    queryKey: ["/api/portal/users"], enabled: open,
    queryFn: () => api("/api/portal/users"),
  });

  const roleLabel = (key: string) => roles.find((r) => r.key === key)?.labelAr || key || "—";
  const sites = (u: PortalUser) => {
    const s: string[] = [];
    if (u.sfRole) s.push("الطلبات");
    if (u.cfmRole) s.push("الكوابل");
    return s.join(" + ") || "—";
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/portal/users"] });

  // إضافة مستخدم
  const [form, setForm] = useState({ username: "", password: "", role: "", workerCode: "", name: "" });
  const createUser = useMutation({
    mutationFn: () => api("/api/portal/users", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { invalidate(); setForm({ username: "", password: "", role: "", workerCode: "", name: "" }); },
    onError: (e: any) => alert(e.message),
  });

  // تغيير الدور
  const changeRole = useMutation({
    mutationFn: ({ username, role }: { username: string; role: string }) =>
      api(`/api/portal/users/${encodeURIComponent(username)}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: invalidate,
    onError: (e: any) => alert(e.message),
  });

  const resetPassword = useMutation({
    mutationFn: ({ username, newPassword }: { username: string; newPassword: string }) =>
      api(`/api/portal/users/${encodeURIComponent(username)}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
    onSuccess: () => alert("تم تغيير كلمة السر"),
    onError: (e: any) => alert(e.message),
  });

  const deleteUser = useMutation({
    mutationFn: (username: string) => api(`/api/portal/users/${encodeURIComponent(username)}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e: any) => alert(e.message),
  });

  const needsWorker = form.role === "tech";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-primary text-primary hover:bg-primary/10">
          <UsersRound className="w-4 h-4 mr-2" />
          إدارة المستخدمين (الموقعين)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[820px] max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-right">بوابة المستخدمين الموحّدة — الطلبات والكوابل</DialogTitle>
        </DialogHeader>

        {/* إضافة مستخدم */}
        <form
          onSubmit={(e) => { e.preventDefault(); createUser.mutate(); }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 border rounded-lg p-3 bg-muted/30 text-right"
        >
          <div className="sm:col-span-2 font-semibold text-sm flex items-center gap-2"><UserPlus className="w-4 h-4" /> إضافة مستخدم جديد (حساب واحد للموقعين)</div>
          <div className="space-y-1">
            <Label>اسم المستخدم</Label>
            <Input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="text-right" />
          </div>
          <div className="space-y-1">
            <Label>كلمة المرور</Label>
            <Input required type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="text-right" />
          </div>
          <div className="space-y-1">
            <Label>الدور الموحّد</Label>
            <Select required value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger className="text-right" dir="rtl"><SelectValue placeholder="اختر الدور" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key} className="text-right">
                    {r.labelAr} — {[r.sf ? "طلبات" : null, r.cfm ? "كوابل" : null].filter(Boolean).join(" + ") || "—"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsWorker && (
            <div className="space-y-1">
              <Label>رقم العامل (للفنى)</Label>
              <Input value={form.workerCode} onChange={(e) => setForm({ ...form, workerCode: e.target.value })} className="text-right" placeholder="يربط الفنى بكباينه" />
            </div>
          )}
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={createUser.isPending}>
              {createUser.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              إنشاء
            </Button>
          </div>
        </form>

        {/* قائمة المستخدمين */}
        <div className="mt-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /> جارٍ التحميل…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right border-collapse">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2">المستخدم</th>
                    <th className="p-2">الدور</th>
                    <th className="p-2">المواقع</th>
                    <th className="p-2">تغيير الدور</th>
                    <th className="p-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.username} className="border-b hover:bg-muted/20">
                      <td className="p-2 font-medium">{u.username}{u.workerCode ? <span className="text-xs text-muted-foreground"> ({u.workerCode})</span> : null}</td>
                      <td className="p-2">{roleLabel(u.unifiedRole)}</td>
                      <td className="p-2 text-muted-foreground">{sites(u)}</td>
                      <td className="p-2">
                        <Select value={u.unifiedRole} onValueChange={(v) => { if (v !== u.unifiedRole && confirm(`تغيير دور ${u.username} إلى «${roleLabel(v)}»؟`)) changeRole.mutate({ username: u.username, role: v }); }}>
                          <SelectTrigger className="text-right h-8 w-[150px]" dir="rtl"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {roles.map((r) => <SelectItem key={r.key} value={r.key} className="text-right">{r.labelAr}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" className="h-8 px-2 text-amber-700 border-amber-200" title="تغيير كلمة السر"
                            onClick={() => { const p = prompt(`كلمة سر جديدة لـ ${u.username}:`); if (p) resetPassword.mutate({ username: u.username, newPassword: p }); }}>
                            <KeyRound className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 px-2 text-red-700 border-red-200" title="حذف"
                            onClick={() => { if (confirm(`حذف المستخدم ${u.username} من الموقعين؟`)) deleteUser.mutate(u.username); }}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا يوجد مستخدمون</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

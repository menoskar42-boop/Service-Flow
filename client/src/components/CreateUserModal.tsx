import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUsers } from "@/hooks/use-users";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, UserPlus } from "lucide-react";
import { ROLES } from "@shared/schema";

export function CreateUserModal() {
  const [open, setOpen] = useState(false);
  const { createUser, isCreating } = useUsers();
  const { user } = useAuth();
  // الأدمن العادى يقدر ينشئ الأدوار الأساسية فقط؛ الأدمن الأعلى يقدر ينشئ كمان مديرين ومديرين أعلى
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    role: "",
    workerCode: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createUser(formData, {
      onSuccess: () => {
        setOpen(false);
        setFormData({ username: "", password: "", role: "", workerCode: "" });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-primary text-primary hover:bg-primary/10">
          <UserPlus className="w-4 h-4 mr-2" />
          مستخدم جديد
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-right">إضافة مستخدم جديد</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 text-right" dir="rtl">
          <div className="space-y-2">
            <Label>اسم المستخدم</Label>
            <Input
              required
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="text-right"
            />
          </div>
          <div className="space-y-2">
            <Label>كلمة المرور</Label>
            <Input
              required
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="text-right"
            />
          </div>
          <div className="space-y-2">
            <Label>الدور</Label>
            <Select required value={formData.role} onValueChange={(val) => setFormData({ ...formData, role: val })}>
              <SelectTrigger className="text-right" dir="rtl">
                <SelectValue placeholder="اختر الدور" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROLES.SALES} className="text-right">موظف مبيعات</SelectItem>
                <SelectItem value={ROLES.TECH} className="text-right">فني</SelectItem>
                <SelectItem value={ROLES.EXTERNAL} className="text-right">مراقب الشئون الخارجية</SelectItem>
                <SelectItem value={ROLES.DATA_MANAGER} className="text-right">مسئول البيانات</SelectItem>
                {isSuperAdmin && <SelectItem value={ROLES.ADMIN} className="text-right">مدير</SelectItem>}
                {isSuperAdmin && <SelectItem value={ROLES.SUPER_ADMIN} className="text-right">مدير أعلى (Super Admin)</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {formData.role === ROLES.TECH && (
            <div className="space-y-2">
              <Label>رقم العامل (للفني)</Label>
              <Input
                value={formData.workerCode}
                onChange={(e) => setFormData({ ...formData, workerCode: e.target.value })}
                className="text-right"
                placeholder="مثال: 12345 — يربط حساب الفني ببياناته فى التقارير"
              />
            </div>
          )}
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              إنشاء
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

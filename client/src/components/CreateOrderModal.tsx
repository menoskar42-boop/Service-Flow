import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrders } from "@/hooks/use-orders";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";

export function CreateOrderModal() {
  const [open, setOpen] = useState(false);
  const { createOrder, isCreating } = useOrders();
  const { toast } = useToast();
  const [warnedSerial, setWarnedSerial] = useState<string | null>(null);
  const [assignedTechId, setAssignedTechId] = useState(""); // "" = الكل (غير مُسنَد)
  const { data: techs = [] } = useQuery<{ id: number; username: string }[]>({
    queryKey: ["/api/techs"],
    queryFn: () => fetch("/api/techs", { credentials: "include" }).then((r) => (r.ok ? r.json() : [])),
  });
  const [formData, setFormData] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    nationalId: "",
    serialNumber: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const serial = formData.serialNumber.trim();
    if (serial && !/^\d+$/.test(serial) && warnedSerial !== serial) {
      setWarnedSerial(serial);
      toast({
        variant: "destructive",
        title: "تنبيه: رقم المسلسل",
        description:
          "رقم المسلسل يحتوي على حروف أو رموز. اضغط حفظ مرة أخرى لتأكيد الحفظ بنفس الشكل.",
      });
      return;
    }
    createOrder(
      { ...formData, assignedTechId: assignedTechId ? Number(assignedTechId) : null } as any,
      {
        onSuccess: () => {
          setOpen(false);
          setWarnedSerial(null);
          setAssignedTechId("");
          setFormData({ customerName: "", customerPhone: "", customerAddress: "", nationalId: "", serialNumber: "" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90 shadow-md hover:shadow-lg transition-all">
          <Plus className="w-4 h-4 mr-2" />
          طلب جديد
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-right">إضافة طلب جديد</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 text-right" dir="rtl">
          <div className="space-y-2">
            <Label htmlFor="name">اسم العميل</Label>
            <Input
              id="name"
              required
              value={formData.customerName}
              onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
              className="text-right"
              placeholder="الاسم الثلاثي"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">رقم التليفون</Label>
            <Input
              id="phone"
              required
              value={formData.customerPhone}
              onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
              className="text-right"
              placeholder="01xxxxxxxxx"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">العنوان بالتفصيل</Label>
            <Input
              id="address"
              required
              value={formData.customerAddress}
              onChange={(e) => setFormData({ ...formData, customerAddress: e.target.value })}
              className="text-right"
              placeholder="الشارع - المنطقة - علامة مميزة"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nationalId">الرقم القومي</Label>
            <Input
              id="nationalId"
              value={formData.nationalId}
              onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
              className="text-right"
              placeholder="الرقم القومي (14 رقم)"
              maxLength={14}
              data-testid="input-national-id"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="serialNumber">رقم المسلسل (إن وجد)</Label>
            <Input
              id="serialNumber"
              inputMode="numeric"
              value={formData.serialNumber}
              onChange={(e) => {
                const v = e.target.value;
                if (warnedSerial && v !== warnedSerial) setWarnedSerial(null);
                setFormData({ ...formData, serialNumber: v });
              }}
              className="text-right"
              placeholder="أرقام فقط"
              data-testid="input-serial-number"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignedTech">الفني المسند (اختياري)</Label>
            <select
              id="assignedTech"
              value={assignedTechId}
              onChange={(e) => setAssignedTechId(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-white text-right"
              dir="rtl"
              data-testid="select-assign-tech"
            >
              <option value="">الكل — متاح لكل الفنيين</option>
              {techs.map((t) => (
                <option key={t.id} value={t.id}>{t.username}</option>
              ))}
            </select>
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              حفظ الطلب
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

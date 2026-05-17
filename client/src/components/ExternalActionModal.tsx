import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useOrders } from "@/hooks/use-orders";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { REJECTION_REASONS, CENTRAL_NAMES, type RejectionReason, type CentralName, type Order } from "@shared/schema";

interface ExternalActionModalProps {
  order: Order;
  action: "feasible" | "not_feasible";
}

export function ExternalActionModal({ order, action }: ExternalActionModalProps) {
  const [open, setOpen] = useState(false);
  const { externalResponse, isSubmittingExternal } = useOrders();

  const [cabinNumber, setCabinNumber] = useState("");
  const [boxNumber, setBoxNumber] = useState("");
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [distance, setDistance] = useState("");
  const [notes, setNotes] = useState("");
  const [centralName, setCentralName] = useState<CentralName | "">("");
  const [notFeasibleCabin, setNotFeasibleCabin] = useState("");
  const [notFeasibleBox, setNotFeasibleBox] = useState("");

  const showCentralAndBoxFields = reason === REJECTION_REASONS.BOX_BROKEN || reason === REJECTION_REASONS.BOX_FULL;
  const isFeasible = action === "feasible";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isFeasible) {
      externalResponse({
        orderId: order.id,
        data: {
          isFeasibleExternal: true,
          externalRejectionReason: null,
          externalCabinNumber: cabinNumber || null,
          externalBoxNumber: boxNumber || null,
          externalNearestBoxDistance: null,
          externalAdditionalNotes: null,
          externalCentralName: null,
        }
      }, { onSuccess: () => setOpen(false) });
    } else {
      externalResponse({
        orderId: order.id,
        data: {
          isFeasibleExternal: false,
          externalRejectionReason: reason || null,
          externalCabinNumber: showCentralAndBoxFields ? (notFeasibleCabin || null) : null,
          externalBoxNumber: showCentralAndBoxFields ? (notFeasibleBox || null) : null,
          externalCentralName: showCentralAndBoxFields ? (centralName || null) : null,
          externalNearestBoxDistance: reason === REJECTION_REASONS.BOX_FULL ? (distance || null) : null,
          externalAdditionalNotes: reason === REJECTION_REASONS.OTHER ? (notes || null) : null,
        }
      }, { onSuccess: () => setOpen(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={isFeasible ? "default" : "destructive"}
          size="sm"
          className={isFeasible ? "bg-green-600 hover:bg-green-700" : ""}
        >
          {isFeasible ? (
            <><CheckCircle2 className="w-4 h-4 mr-1" /> يمكن التنفيذ</>
          ) : (
            <><XCircle className="w-4 h-4 mr-1" /> لا يمكن</>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-right">
            {isFeasible ? "تأكيد إمكانية التنفيذ (شئون خارجية)" : "تسجيل عدم إمكانية التنفيذ (شئون خارجية)"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 text-right" dir="rtl">

          {isFeasible ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="ext-cabin">رقم الكابينة (اختياري)</Label>
                <Input
                  id="ext-cabin"
                  value={cabinNumber}
                  onChange={(e) => setCabinNumber(e.target.value)}
                  className="text-right"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ext-box">رقم البوكس (اختياري)</Label>
                <Input
                  id="ext-box"
                  value={boxNumber}
                  onChange={(e) => setBoxNumber(e.target.value)}
                  className="text-right"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>سبب الرفض</Label>
                <Select value={reason} onValueChange={(val) => setReason(val as RejectionReason)}>
                  <SelectTrigger className="text-right" dir="rtl">
                    <SelectValue placeholder="اختر السبب" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(REJECTION_REASONS).map((r) => (
                      <SelectItem key={r} value={r} className="text-right" dir="rtl">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {showCentralAndBoxFields && (
                <>
                  <div className="space-y-2">
                    <Label>اسم السنترال *</Label>
                    <Select value={centralName} onValueChange={(val) => setCentralName(val as CentralName)}>
                      <SelectTrigger className="text-right" dir="rtl">
                        <SelectValue placeholder="اختر السنترال" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(CENTRAL_NAMES).map((c) => (
                          <SelectItem key={c} value={c} className="text-right" dir="rtl">{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>رقم الكابينة *</Label>
                    <Input
                      required
                      value={notFeasibleCabin}
                      onChange={(e) => setNotFeasibleCabin(e.target.value)}
                      className="text-right"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>رقم البوكس *</Label>
                    <Input
                      required
                      value={notFeasibleBox}
                      onChange={(e) => setNotFeasibleBox(e.target.value)}
                      className="text-right"
                    />
                  </div>
                </>
              )}

              {reason === REJECTION_REASONS.BOX_FULL && (
                <div className="space-y-2">
                  <Label>بعد أقرب بوكس (متر) *</Label>
                  <Input
                    required
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                    className="text-right"
                    placeholder="مثال: 50 متر"
                  />
                </div>
              )}

              {reason === REJECTION_REASONS.OTHER && (
                <div className="space-y-2">
                  <Label>ملاحظات إضافية</Label>
                  <Textarea
                    required
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="text-right"
                    placeholder="اكتب تفاصيل الرفض..."
                  />
                </div>
              )}
            </>
          )}

          <div className="pt-4 flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmittingExternal ||
                (!isFeasible && !reason) ||
                (!isFeasible && showCentralAndBoxFields && (!centralName || !notFeasibleCabin || !notFeasibleBox)) ||
                (!isFeasible && reason === REJECTION_REASONS.BOX_FULL && !distance) ||
                (!isFeasible && reason === REJECTION_REASONS.OTHER && !notes)
              }
              className={isFeasible ? "bg-green-600 hover:bg-green-700" : "bg-destructive hover:bg-destructive/90"}
            >
              {isSubmittingExternal ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              تأكيد
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { useOrders } from "@/hooks/use-orders";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { REJECTION_REASONS, CENTRAL_NAMES, type RejectionReason, type CentralName, type Order } from "@shared/schema";
import { getCabins, getBoxes } from "@/lib/technical-data";

interface TechActionModalProps {
  order: Order;
  action: "feasible" | "not_feasible";
}

export function TechActionModal({ order, action }: TechActionModalProps) {
  const [open, setOpen] = useState(false);
  const { updateOrder, isUpdating } = useOrders();
  
  // State for feasible path
  const [feasibleCentral, setFeasibleCentral] = useState<CentralName | "">("");
  const [cabinNumber, setCabinNumber] = useState("");
  const [boxNumber, setBoxNumber] = useState("");

  // State for not feasible path
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [distance, setDistance] = useState("");
  const [notes, setNotes] = useState("");
  const [centralName, setCentralName] = useState<CentralName | "">("");
  const [notFeasibleCabin, setNotFeasibleCabin] = useState("");
  const [notFeasibleBox, setNotFeasibleBox] = useState("");

  // Show central name, cabin, and box for broken or full box reasons
  const showCentralAndBoxFields = reason === REJECTION_REASONS.BOX_BROKEN || reason === REJECTION_REASONS.BOX_FULL;

  const isFeasible = action === "feasible";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isFeasible) {
      updateOrder({
        id: order.id,
        updates: {
          isFeasible: true,
          rejectionReason: null,
          centralName: feasibleCentral || null,
          cabinNumber: cabinNumber || null,
          boxNumber: boxNumber || null,
          nearestBoxDistance: null,
          additionalNotes: null,
        }
      }, {
        onSuccess: () => setOpen(false)
      });
    } else {
      updateOrder({
        id: order.id,
        updates: {
          isFeasible: false,
          rejectionReason: reason || null,
          cabinNumber: showCentralAndBoxFields ? (notFeasibleCabin || null) : null,
          boxNumber: showCentralAndBoxFields ? (notFeasibleBox || null) : null,
          centralName: showCentralAndBoxFields ? (centralName || null) : null,
          nearestBoxDistance: reason === REJECTION_REASONS.BOX_FULL ? (distance || null) : null,
          additionalNotes: reason === REJECTION_REASONS.OTHER ? (notes || null) : null,
        }
      }, {
        onSuccess: () => setOpen(false)
      });
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
            {isFeasible ? "تأكيد إمكانية التنفيذ" : "تسجيل عدم إمكانية التنفيذ"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 text-right" dir="rtl">
          
          {isFeasible ? (
            <>
              <div className="space-y-2">
                <Label>اسم السنترال (اختياري)</Label>
                <Select
                  value={feasibleCentral}
                  onValueChange={(val) => {
                    setFeasibleCentral(val as CentralName);
                    setCabinNumber("");
                    setBoxNumber("");
                  }}
                >
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
                <Label>رقم الكابينة (اختياري)</Label>
                <SearchableCombobox
                  options={feasibleCentral ? getCabins(feasibleCentral) : []}
                  value={cabinNumber}
                  onChange={(val) => {
                    setCabinNumber(val);
                    setBoxNumber("");
                  }}
                  placeholder="اختر الكابينة"
                  searchPlaceholder="ابحث عن كابينة..."
                  disabled={!feasibleCentral}
                />
              </div>
              <div className="space-y-2">
                <Label>رقم البوكس (اختياري)</Label>
                <SearchableCombobox
                  options={feasibleCentral && cabinNumber ? getBoxes(feasibleCentral, cabinNumber) : []}
                  value={boxNumber}
                  onChange={setBoxNumber}
                  placeholder="اختر البوكس"
                  searchPlaceholder="ابحث عن بوكس..."
                  disabled={!feasibleCentral || !cabinNumber}
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
                    <Select
                      value={centralName}
                      onValueChange={(val) => {
                        setCentralName(val as CentralName);
                        setNotFeasibleCabin("");
                        setNotFeasibleBox("");
                      }}
                    >
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
                    <SearchableCombobox
                      options={centralName ? getCabins(centralName) : []}
                      value={notFeasibleCabin}
                      onChange={(val) => {
                        setNotFeasibleCabin(val);
                        setNotFeasibleBox("");
                      }}
                      placeholder="اختر الكابينة"
                      searchPlaceholder="ابحث عن كابينة..."
                      disabled={!centralName}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>رقم البوكس *</Label>
                    <SearchableCombobox
                      options={centralName && notFeasibleCabin ? getBoxes(centralName, notFeasibleCabin) : []}
                      value={notFeasibleBox}
                      onChange={setNotFeasibleBox}
                      placeholder="اختر البوكس"
                      searchPlaceholder="ابحث عن بوكس..."
                      disabled={!centralName || !notFeasibleCabin}
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
                isUpdating || 
                (!isFeasible && !reason) ||
                (!isFeasible && showCentralAndBoxFields && (!centralName || !notFeasibleCabin || !notFeasibleBox)) ||
                (!isFeasible && reason === REJECTION_REASONS.BOX_FULL && !distance) ||
                (!isFeasible && reason === REJECTION_REASONS.OTHER && !notes)
              } 
              className={isFeasible ? "bg-green-600 hover:bg-green-700" : "bg-destructive hover:bg-destructive/90"}
            >
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              تأكيد
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateOrderSchema, type UpdateOrder, REJECTION_REASONS } from "@shared/schema";
import { useOrders } from "@/hooks/use-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Check, X } from "lucide-react";
import { type Order } from "@shared/schema";

interface TechResponseDialogProps {
  order: Order | null;
  mode: "feasible" | "not_feasible" | null;
  onClose: () => void;
}

export function TechResponseDialog({ order, mode, onClose }: TechResponseDialogProps) {
  const { updateOrder, isUpdating } = useOrders();

  const form = useForm<UpdateOrder>({
    resolver: zodResolver(updateOrderSchema),
    defaultValues: {
      cabinNumber: "",
      boxNumber: "",
      rejectionReason: "",
      nearestBoxDistance: "",
      additionalNotes: "",
    },
  });

  const rejectionReason = form.watch("rejectionReason");

  const onSubmit = (data: UpdateOrder) => {
    if (!order) return;

    const payload: UpdateOrder = {
      isFeasible: mode === "feasible",
    };

    if (mode === "feasible") {
      payload.cabinNumber = data.cabinNumber;
      payload.boxNumber = data.boxNumber;
    } else {
      payload.rejectionReason = data.rejectionReason;
      if (data.rejectionReason === REJECTION_REASONS.BOX_FULL) {
        payload.nearestBoxDistance = data.nearestBoxDistance;
      }
      if (data.rejectionReason === REJECTION_REASONS.OTHER) {
        payload.additionalNotes = data.additionalNotes;
      }
    }

    updateOrder(
      { id: order.id, updates: payload },
      {
        onSuccess: () => {
          onClose();
          form.reset();
        },
      }
    );
  };

  const isOpen = !!order && !!mode;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className={mode === "feasible" ? "text-green-600" : "text-red-600"}>
            {mode === "feasible" ? "Mark as Feasible" : "Mark as Not Feasible"}
          </DialogTitle>
          <DialogDescription>
            Reviewing Order #{order?.id} for {order?.customerName}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {mode === "feasible" ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="cabinNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cabin Number</FormLabel>
                        <FormControl>
                          <Input placeholder="C-123" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="boxNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Box Number</FormLabel>
                        <FormControl>
                          <Input placeholder="B-456" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="rejectionReason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason for Rejection</FormLabel>
                      <Select 
                        onValueChange={field.onChange} 
                        defaultValue={field.value || ""}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a reason" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.values(REJECTION_REASONS).map((reason) => (
                            <SelectItem key={reason} value={reason}>
                              {reason}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {rejectionReason === REJECTION_REASONS.BOX_FULL && (
                  <FormField
                    control={form.control}
                    name="nearestBoxDistance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nearest Available Box Distance</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 50 meters" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {rejectionReason === REJECTION_REASONS.OTHER && (
                  <FormField
                    control={form.control}
                    name="additionalNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Additional Notes</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Please explain further..." 
                            {...field} 
                            value={field.value || ""} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                variant={mode === "feasible" ? "default" : "destructive"}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : mode === "feasible" ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Confirm Feasible
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4 mr-2" />
                    Confirm Rejection
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

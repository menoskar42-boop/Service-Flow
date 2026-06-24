import { type Order, ROLES } from "@shared/schema";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { TechActionModal } from "./TechActionModal";
import { MapPin, Phone, User, Calendar, Box, Activity } from "lucide-react";

interface OrderCardProps {
  order: Order;
  role: string;
}

export function OrderCard({ order, role }: OrderCardProps) {
  const isSales = role === ROLES.SALES;
  const isTech = role === ROLES.TECH;
  
  // Status Logic
  let statusBadge;
  let statusColorClass = "";
  
  if (order.status === "pending") {
    statusBadge = <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">قيد الانتظار</Badge>;
    statusColorClass = "border-l-4 border-l-yellow-400";
  } else if (order.isFeasible) {
    statusBadge = <Badge variant="default" className="bg-green-600 hover:bg-green-700">يمكن التنفيذ</Badge>;
    statusColorClass = "border-l-4 border-l-green-600";
  } else {
    statusBadge = <Badge variant="destructive">لا يمكن التنفيذ</Badge>;
    statusColorClass = "border-l-4 border-l-red-600";
  }

  return (
    <Card className={`overflow-hidden card-hover transition-all duration-300 ${statusColorClass}`}>
      <CardHeader className="p-4 pb-2 flex flex-row justify-between items-start space-y-0">
        <div>
          <h3 className="font-bold text-lg text-foreground">{order.customerName}</h3>
          <div className="flex items-center text-sm text-muted-foreground mt-1">
            <Calendar className="w-3 h-3 mr-1 ml-1" />
            {format(new Date(order.createdAt), "dd/MM/yyyy HH:mm")}
          </div>
        </div>
        {statusBadge}
      </CardHeader>
      
      <CardContent className="p-4 pt-2 space-y-3">
        {/* Customer Info */}
        <div className="space-y-2 text-sm">
          <div className="flex items-start text-muted-foreground">
            <MapPin className="w-4 h-4 mr-1 ml-2 text-primary mt-0.5 shrink-0" />
            <span className="text-foreground/90">{order.customerAddress}</span>
          </div>
          <div className="flex items-center text-muted-foreground">
            <Phone className="w-4 h-4 mr-1 ml-2 text-primary shrink-0" />
            <span className="font-mono text-foreground/90">{order.customerPhone}</span>
          </div>
          <div className="flex items-center text-muted-foreground">
            <User className="w-4 h-4 mr-1 ml-2 text-primary shrink-0" />
            <span>المبيعات: <span className="font-medium text-foreground">{order.salesName}</span></span>
          </div>
        </div>

        {/* Tech Info - Only show if not pending */}
        {order.status !== "pending" && (
          <div className="mt-4 pt-3 border-t bg-muted/30 -mx-4 px-4 pb-1">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center">
              <Activity className="w-3 h-3 ml-1" />
              تقرير الفني
            </div>
            
            {order.isFeasible ? (
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                <div className="bg-white p-2 rounded border shadow-sm">
                  <span className="text-xs text-muted-foreground block mb-0.5">الكابينه</span>
                  <span className="font-mono font-medium">{order.cabinNumber || "-"}</span>
                </div>
                <div className="bg-white p-2 rounded border shadow-sm">
                  <span className="text-xs text-muted-foreground block mb-0.5">البوكس</span>
                  <span className="font-mono font-medium">{order.boxNumber || "-"}</span>
                </div>
              </div>
            ) : (
              <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-sm mb-2">
                <div className="font-medium text-red-800 mb-1">سبب الرفض: {order.rejectionReason}</div>
                {order.nearestBoxDistance && (
                  <div className="text-red-700 text-xs">أقرب بوكس: {order.nearestBoxDistance} متر</div>
                )}
                {order.additionalNotes && (
                  <div className="text-red-700 text-xs mt-1 border-t border-red-200 pt-1">{order.additionalNotes}</div>
                )}
              </div>
            )}
            
            <div className="text-xs text-muted-foreground flex justify-between items-center mb-2">
              <span>الفني: {order.techName}</span>
              {order.techResponseAt && <span>{format(new Date(order.techResponseAt), "HH:mm")}</span>}
            </div>
          </div>
        )}
      </CardContent>

      {/* Tech Actions - Only for Tech users on pending orders */}
      {isTech && order.status === "pending" && (
        <CardFooter className="p-4 pt-0 flex gap-2 justify-end bg-muted/20 border-t">
          <div className="w-full flex gap-2 pt-3">
            <TechActionModal orderId={order.id} type="feasible" />
            <TechActionModal orderId={order.id} type="not_feasible" />
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

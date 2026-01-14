import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Order, ROLES } from "@shared/schema";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { TechActionModal } from "./TechActionModal";
import { useAuth } from "@/hooks/use-auth";
import { useOrders } from "@/hooks/use-orders";
import { Search, RotateCcw, Loader2 } from "lucide-react";

interface OrdersTableProps {
  orders: Order[];
}

export function OrdersTable({ orders }: OrdersTableProps) {
  const { user } = useAuth();
  const { resetTechResponse, isResetting } = useOrders();
  const [searchQuery, setSearchQuery] = useState("");
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "feasible":
        return <Badge variant="outline" className="status-badge status-feasible">يمكن التنفيذ</Badge>;
      case "not_feasible":
        return <Badge variant="outline" className="status-badge status-not-feasible">لا يمكن التنفيذ</Badge>;
      default:
        return <Badge variant="outline" className="status-badge status-pending">قيد الانتظار</Badge>;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "feasible": return "يمكن التنفيذ";
      case "not_feasible": return "لا يمكن التنفيذ";
      default: return "قيد الانتظار";
    }
  };

  // Filter orders based on search query
  const filteredOrders = orders.filter((order) => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    const searchableFields = [
      order.id.toString(),
      order.customerName,
      order.customerPhone,
      order.customerAddress,
      order.salesName,
      getStatusText(order.status),
      order.rejectionReason || "",
      order.cabinNumber || "",
      order.boxNumber || "",
      order.centralName || "",
      order.nearestBoxDistance || "",
      order.additionalNotes || "",
      order.techName || "",
      format(new Date(order.createdAt), "yyyy/MM/dd HH:mm"),
      order.techResponseAt ? format(new Date(order.techResponseAt), "yyyy/MM/dd HH:mm") : "",
    ];
    
    return searchableFields.some(field => 
      field.toLowerCase().includes(query)
    );
  });

  if (orders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground bg-white rounded-lg border border-dashed">
        لا توجد طلبات لعرضها
      </div>
    );
  }

  return (
    <Card className="overflow-hidden shadow-sm border-0 bg-white">
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث في جميع الحقول..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-10 text-right"
            dir="rtl"
            data-testid="input-search"
          />
        </div>
        {searchQuery && (
          <p className="text-sm text-muted-foreground mt-2">
            عدد النتائج: {filteredOrders.length} من {orders.length}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table className="text-right" dir="rtl">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="text-right font-bold w-[60px]">#</TableHead>
              <TableHead className="text-right font-bold">التاريخ</TableHead>
              <TableHead className="text-right font-bold">العميل</TableHead>
              <TableHead className="text-right font-bold">العنوان</TableHead>
              <TableHead className="text-right font-bold">رقم الهاتف</TableHead>
              {(user?.role === ROLES.ADMIN || user?.role === ROLES.TECH) && (
                <TableHead className="text-right font-bold">المندوب</TableHead>
              )}
              <TableHead className="text-right font-bold">الحالة</TableHead>
              <TableHead className="text-right font-bold">الفني</TableHead>
              <TableHead className="text-right font-bold">رد الفني</TableHead>
              {(user?.role === ROLES.TECH || user?.role === ROLES.ADMIN) && (
                <TableHead className="text-right font-bold">إجراء</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOrders.map((order) => (
              <TableRow key={order.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-medium">{order.id}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {format(new Date(order.createdAt), "yyyy/MM/dd HH:mm", { locale: ar })}
                </TableCell>
                <TableCell className="font-medium text-foreground whitespace-normal break-words min-w-[120px]">{order.customerName}</TableCell>
                <TableCell className="whitespace-normal break-words min-w-[150px] max-w-[250px]">
                  {order.customerAddress}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-normal break-words min-w-[100px]">{order.customerPhone}</TableCell>
                
                {(user?.role === ROLES.ADMIN || user?.role === ROLES.TECH) && (
                  <TableCell>{order.salesName}</TableCell>
                )}
                
                <TableCell>{getStatusBadge(order.status)}</TableCell>
                
                <TableCell className="text-sm">
                  {order.techName || <span className="text-muted-foreground">-</span>}
                </TableCell>
                
                <TableCell className="max-w-[250px] text-sm">
                  {order.status === "pending" ? (
                    <span className="text-muted-foreground">-</span>
                  ) : order.isFeasible ? (
                    <div className="space-y-1">
                      {order.cabinNumber && <div>كابينة: {order.cabinNumber}</div>}
                      {order.boxNumber && <div>بوكس: {order.boxNumber}</div>}
                    </div>
                  ) : (
                    <div className="text-destructive font-medium">
                      {order.rejectionReason}
                      {order.centralName && <span className="text-xs block text-muted-foreground">السنترال: {order.centralName}</span>}
                      {order.cabinNumber && <span className="text-xs block text-muted-foreground">كابينة: {order.cabinNumber}</span>}
                      {order.boxNumber && <span className="text-xs block text-muted-foreground">بوكس: {order.boxNumber}</span>}
                      {order.nearestBoxDistance && <span className="text-xs block text-muted-foreground">بعد: {order.nearestBoxDistance}م</span>}
                      {order.additionalNotes && <span className="text-xs block text-muted-foreground">{order.additionalNotes}</span>}
                    </div>
                  )}
                </TableCell>

                {(user?.role === ROLES.TECH || user?.role === ROLES.ADMIN) && (
                  <TableCell>
                    {user?.role === ROLES.TECH && order.status === "pending" && (
                      <div className="flex gap-2">
                        <TechActionModal order={order} action="feasible" />
                        <TechActionModal order={order} action="not_feasible" />
                      </div>
                    )}
                    {user?.role === ROLES.ADMIN && order.status !== "pending" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetTechResponse(order.id)}
                        disabled={isResetting}
                        className="text-orange-600 border-orange-300 hover:bg-orange-50"
                        data-testid={`button-reset-${order.id}`}
                      >
                        {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />}
                        إلغاء رد الفني
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

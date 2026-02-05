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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { type Order, ROLES, CONTRACT_STATUS } from "@shared/schema";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { TechActionModal } from "./TechActionModal";
import { useAuth } from "@/hooks/use-auth";
import { useOrders } from "@/hooks/use-orders";
import { Search, RotateCcw, Loader2, FileCheck, Undo2 } from "lucide-react";

interface OrdersTableProps {
  orders: Order[];
}

type StatusFilter = "all" | "pending" | "feasible" | "not_feasible";
type ContractFilter = "all" | "contracted" | "not_contracted";

export function OrdersTable({ orders }: OrdersTableProps) {
  const { user } = useAuth();
  const { resetTechResponse, isResetting, updateContractStatus, isUpdatingContract } = useOrders();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [contractFilter, setContractFilter] = useState<ContractFilter>("all");
  
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

  const getContractBadge = (contractStatus: string) => {
    if (contractStatus === CONTRACT_STATUS.CONTRACTED) {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">تم التعاقد</Badge>;
    }
    return <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">لم يتم التعاقد</Badge>;
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "feasible": return "يمكن التنفيذ";
      case "not_feasible": return "لا يمكن التنفيذ";
      default: return "قيد الانتظار";
    }
  };

  // Filter orders based on status filter, contract filter, and search query
  const filteredOrders = orders.filter((order) => {
    // First filter by status
    if (statusFilter !== "all" && order.status !== statusFilter) {
      return false;
    }
    
    // Filter by contract status (admin only)
    if (user?.role === ROLES.ADMIN && contractFilter !== "all") {
      if (contractFilter === "contracted" && order.contractStatus !== CONTRACT_STATUS.CONTRACTED) {
        return false;
      }
      if (contractFilter === "not_contracted" && order.contractStatus !== CONTRACT_STATUS.NOT_CONTRACTED) {
        return false;
      }
    }
    
    // Then filter by search query
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
      order.contractStatus || "",
      format(new Date(order.createdAt), "yyyy/MM/dd HH:mm"),
      order.techResponseAt ? format(new Date(order.techResponseAt), "yyyy/MM/dd HH:mm") : "",
    ];
    
    return searchableFields.some(field => 
      field.toLowerCase().includes(query)
    );
  });

  // Count orders by status for tab badges
  const statusCounts = {
    all: orders.length,
    pending: orders.filter(o => o.status === "pending").length,
    feasible: orders.filter(o => o.status === "feasible").length,
    not_feasible: orders.filter(o => o.status === "not_feasible").length,
  };

  // Count by contract status (admin only)
  const contractCounts = {
    all: orders.length,
    contracted: orders.filter(o => o.contractStatus === CONTRACT_STATUS.CONTRACTED).length,
    not_contracted: orders.filter(o => o.contractStatus === CONTRACT_STATUS.NOT_CONTRACTED).length,
  };

  if (orders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground bg-white rounded-lg border border-dashed">
        لا توجد طلبات لعرضها
      </div>
    );
  }

  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "الكل" },
    { key: "feasible", label: "يمكن التنفيذ" },
    { key: "not_feasible", label: "لا يمكن التنفيذ" },
    { key: "pending", label: "قيد الانتظار" },
  ];

  const contractTabs: { key: ContractFilter; label: string }[] = [
    { key: "all", label: "الكل" },
    { key: "contracted", label: "تم التعاقد" },
    { key: "not_contracted", label: "لم يتم التعاقد" },
  ];

  const handleMarkContracted = (orderId: number) => {
    updateContractStatus({ orderId, contractStatus: CONTRACT_STATUS.CONTRACTED });
  };

  const handleRevertContract = (orderId: number) => {
    updateContractStatus({ orderId, contractStatus: CONTRACT_STATUS.NOT_CONTRACTED });
  };

  return (
    <Card className="overflow-hidden shadow-sm border-0 bg-white">
      {/* Status Filter Tabs */}
      <div className="border-b overflow-x-auto">
        <div className="flex min-w-max" dir="rtl">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                statusFilter === tab.key
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              data-testid={`tab-${tab.key}`}
            >
              {tab.label}
              <span className={`mr-2 px-2 py-0.5 rounded-full text-xs ${
                statusFilter === tab.key
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}>
                {statusCounts[tab.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Contract Status Filter Tabs (Admin only) */}
      {user?.role === ROLES.ADMIN && (
        <div className="border-b overflow-x-auto bg-muted/20">
          <div className="flex min-w-max items-center gap-2 px-4 py-2" dir="rtl">
            <span className="text-sm text-muted-foreground">حالة التعاقد:</span>
            {contractTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setContractFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  contractFilter === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-white text-muted-foreground hover:bg-muted border"
                }`}
                data-testid={`contract-tab-${tab.key}`}
              >
                {tab.label}
                <span className="mr-1">({contractCounts[tab.key]})</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
        {(searchQuery || statusFilter !== "all" || contractFilter !== "all") && (
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
              {(user?.role === ROLES.ADMIN || user?.role === ROLES.SALES) && (
                <TableHead className="text-right font-bold">الرقم القومي</TableHead>
              )}
              {(user?.role === ROLES.ADMIN || user?.role === ROLES.TECH) && (
                <TableHead className="text-right font-bold">المندوب</TableHead>
              )}
              <TableHead className="text-right font-bold">الحالة</TableHead>
              {user?.role === ROLES.ADMIN && (
                <TableHead className="text-right font-bold">حالة التعاقد</TableHead>
              )}
              <TableHead className="text-right font-bold">الفني</TableHead>
              <TableHead className="text-right font-bold">رد الفني</TableHead>
              <TableHead className="text-right font-bold">إجراء</TableHead>
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
                
                {(user?.role === ROLES.ADMIN || user?.role === ROLES.SALES) && (
                  <TableCell className="font-mono text-xs">
                    {order.nationalId || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                )}
                
                {(user?.role === ROLES.ADMIN || user?.role === ROLES.TECH) && (
                  <TableCell>{order.salesName}</TableCell>
                )}
                
                <TableCell>{getStatusBadge(order.status)}</TableCell>

                {user?.role === ROLES.ADMIN && (
                  <TableCell>{getContractBadge(order.contractStatus)}</TableCell>
                )}
                
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

                <TableCell>
                  <div className="flex gap-2 flex-wrap">
                    {/* Tech actions */}
                    {user?.role === ROLES.TECH && order.status === "pending" && (
                      <>
                        <TechActionModal order={order} action="feasible" />
                        <TechActionModal order={order} action="not_feasible" />
                      </>
                    )}
                    
                    {/* Sales contract button - only show after tech response */}
                    {user?.role === ROLES.SALES && order.status !== "pending" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-green-600 border-green-300 hover:bg-green-50"
                            disabled={isUpdatingContract}
                            data-testid={`button-contract-${order.id}`}
                          >
                            {isUpdatingContract ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <FileCheck className="w-4 h-4 mr-1" />
                            )}
                            تم التعاقد
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent dir="rtl">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-right">تأكيد التعاقد</AlertDialogTitle>
                            <AlertDialogDescription className="text-right">
                              هل أنت متأكد من إتمام التعاقد؟ لا يمكن التراجع إلا عن طريق الأدمن
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter className="flex-row-reverse gap-2">
                            <AlertDialogCancel>إلغاء</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleMarkContracted(order.id)}
                              className="bg-green-600 text-white hover:bg-green-700"
                            >
                              تأكيد التعاقد
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    
                    {/* Admin actions */}
                    {user?.role === ROLES.ADMIN && (
                      <>
                        {order.status !== "pending" && (
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
                        
                        {order.contractStatus === CONTRACT_STATUS.CONTRACTED && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRevertContract(order.id)}
                            disabled={isUpdatingContract}
                            className="text-blue-600 border-blue-300 hover:bg-blue-50"
                            data-testid={`button-revert-contract-${order.id}`}
                          >
                            {isUpdatingContract ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4 mr-1" />}
                            إرجاع إلى لم يتم التعاقد
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

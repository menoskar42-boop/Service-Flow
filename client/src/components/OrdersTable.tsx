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
import { type Order, ROLES, CONTRACT_STATUS, ORDER_STATUS } from "@shared/schema";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { TechActionModal } from "./TechActionModal";
import { ExternalActionModal } from "./ExternalActionModal";
import { useAuth } from "@/hooks/use-auth";
import { useOrders } from "@/hooks/use-orders";
import { Search, RotateCcw, Loader2, FileCheck, Undo2, RefreshCw } from "lucide-react";

interface OrdersTableProps {
  orders: Order[];
}

type StatusFilter = "all" | "pending" | "feasible" | "not_feasible" | "needs_external" | "external_feasible" | "external_not_feasible";
type ContractFilter = "all" | "contracted" | "not_contracted";

export function OrdersTable({ orders }: OrdersTableProps) {
  const { user } = useAuth();
  const { resetTechResponse, isResetting, updateContractStatus, isUpdatingContract, requestExternalReview, isRequestingExternal } = useOrders();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [contractFilter, setContractFilter] = useState<ContractFilter>("all");

  const getStatusBadge = (status: string) => {
    switch (status) {
      case ORDER_STATUS.FEASIBLE:
        return <Badge variant="outline" className="status-badge status-feasible">يمكن التنفيذ</Badge>;
      case ORDER_STATUS.NOT_FEASIBLE:
        return <Badge variant="outline" className="status-badge status-not-feasible">لا يمكن التنفيذ</Badge>;
      case ORDER_STATUS.NEEDS_EXTERNAL:
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">يحتاج رد الشئون الخارجية</Badge>;
      case ORDER_STATUS.EXTERNAL_FEASIBLE:
        return <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-300">يمكن التنفيذ (شئون خارجية)</Badge>;
      case ORDER_STATUS.EXTERNAL_NOT_FEASIBLE:
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">لا يمكن التنفيذ (شئون خارجية)</Badge>;
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
      case ORDER_STATUS.FEASIBLE: return "يمكن التنفيذ";
      case ORDER_STATUS.NOT_FEASIBLE: return "لا يمكن التنفيذ";
      case ORDER_STATUS.NEEDS_EXTERNAL: return "يحتاج رد الشئون الخارجية";
      case ORDER_STATUS.EXTERNAL_FEASIBLE: return "يمكن التنفيذ شئون خارجية";
      case ORDER_STATUS.EXTERNAL_NOT_FEASIBLE: return "لا يمكن التنفيذ شئون خارجية";
      default: return "قيد الانتظار";
    }
  };

  const filteredOrders = orders.filter((order) => {
    if (statusFilter !== "all" && order.status !== statusFilter) return false;

    if (user?.role === ROLES.ADMIN && contractFilter !== "all") {
      if (contractFilter === "contracted" && order.contractStatus !== CONTRACT_STATUS.CONTRACTED) return false;
      if (contractFilter === "not_contracted" && order.contractStatus !== CONTRACT_STATUS.NOT_CONTRACTED) return false;
    }

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
      order.externalName || "",
      order.externalRejectionReason || "",
      format(new Date(order.createdAt), "yyyy/MM/dd HH:mm"),
      order.techResponseAt ? format(new Date(order.techResponseAt), "yyyy/MM/dd HH:mm") : "",
    ];
    return searchableFields.some(field => field.toLowerCase().includes(query));
  });

  const statusCounts = {
    all: orders.length,
    pending: orders.filter(o => o.status === ORDER_STATUS.PENDING).length,
    feasible: orders.filter(o => o.status === ORDER_STATUS.FEASIBLE).length,
    not_feasible: orders.filter(o => o.status === ORDER_STATUS.NOT_FEASIBLE).length,
    needs_external: orders.filter(o => o.status === ORDER_STATUS.NEEDS_EXTERNAL).length,
    external_feasible: orders.filter(o => o.status === ORDER_STATUS.EXTERNAL_FEASIBLE).length,
    external_not_feasible: orders.filter(o => o.status === ORDER_STATUS.EXTERNAL_NOT_FEASIBLE).length,
  };

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

  // Build status tabs based on role
  const buildStatusTabs = () => {
    const tabs: { key: StatusFilter; label: string }[] = [
      { key: "all", label: "الكل" },
    ];
    if (user?.role === ROLES.EXTERNAL) {
      // External only sees needs_external orders - no filter tabs needed except all
      return tabs;
    }
    tabs.push({ key: "feasible", label: "يمكن التنفيذ" });
    tabs.push({ key: "not_feasible", label: "لا يمكن التنفيذ" });
    tabs.push({ key: "pending", label: "قيد الانتظار" });
    if (user?.role === ROLES.ADMIN) {
      tabs.push({ key: "needs_external", label: "يحتاج رد الشئون الخارجية" });
      tabs.push({ key: "external_feasible", label: "يمكن (شئون خارجية)" });
      tabs.push({ key: "external_not_feasible", label: "لا يمكن (شئون خارجية)" });
    }
    if (user?.role === ROLES.SALES) {
      tabs.push({ key: "needs_external", label: "قيد المراجعة الخارجية" });
      tabs.push({ key: "external_feasible", label: "يمكن (شئون خارجية)" });
      tabs.push({ key: "external_not_feasible", label: "لا يمكن (شئون خارجية)" });
    }
    return tabs;
  };

  const statusTabs = buildStatusTabs();

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

  // Check if sales can mark as contracted (after any tech/external response)
  const canMarkContracted = (order: Order) => {
    return order.status !== ORDER_STATUS.PENDING && order.status !== ORDER_STATUS.NEEDS_EXTERNAL;
  };

  return (
    <Card className="overflow-hidden shadow-sm border-0 bg-white">
      {/* Status Filter Tabs */}
      {statusTabs.length > 1 && (
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
                  statusFilter === tab.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {statusCounts[tab.key]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

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
              {(user?.role === ROLES.ADMIN || user?.role === ROLES.TECH || user?.role === ROLES.EXTERNAL) && (
                <TableHead className="text-right font-bold">المندوب</TableHead>
              )}
              <TableHead className="text-right font-bold">الحالة</TableHead>
              {user?.role === ROLES.ADMIN && (
                <TableHead className="text-right font-bold">حالة التعاقد</TableHead>
              )}
              <TableHead className="text-right font-bold">الفني</TableHead>
              <TableHead className="text-right font-bold">رد الفني</TableHead>
              {(user?.role === ROLES.ADMIN || user?.role === ROLES.EXTERNAL) && (
                <TableHead className="text-right font-bold">رد الشئون الخارجية</TableHead>
              )}
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

                {(user?.role === ROLES.ADMIN || user?.role === ROLES.TECH || user?.role === ROLES.EXTERNAL) && (
                  <TableCell>{order.salesName}</TableCell>
                )}

                <TableCell>{getStatusBadge(order.status)}</TableCell>

                {user?.role === ROLES.ADMIN && (
                  <TableCell>{getContractBadge(order.contractStatus)}</TableCell>
                )}

                <TableCell className="text-sm">
                  {order.techName || <span className="text-muted-foreground">-</span>}
                </TableCell>

                {/* Tech Response Cell */}
                <TableCell className="max-w-[200px] text-sm">
                  {order.status === ORDER_STATUS.PENDING ? (
                    <span className="text-muted-foreground">-</span>
                  ) : order.isFeasible === true ? (
                    <div className="space-y-1">
                      {order.cabinNumber && <div>كابينة: {order.cabinNumber}</div>}
                      {order.boxNumber && <div>بوكس: {order.boxNumber}</div>}
                    </div>
                  ) : order.isFeasible === false ? (
                    <div className="text-destructive font-medium text-xs">
                      {order.rejectionReason}
                      {order.centralName && <span className="block text-muted-foreground">السنترال: {order.centralName}</span>}
                      {order.cabinNumber && <span className="block text-muted-foreground">كابينة: {order.cabinNumber}</span>}
                      {order.boxNumber && <span className="block text-muted-foreground">بوكس: {order.boxNumber}</span>}
                      {order.nearestBoxDistance && <span className="block text-muted-foreground">بعد: {order.nearestBoxDistance}م</span>}
                      {order.additionalNotes && <span className="block text-muted-foreground">{order.additionalNotes}</span>}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>

                {/* External Response Cell (Admin & External role) */}
                {(user?.role === ROLES.ADMIN || user?.role === ROLES.EXTERNAL) && (
                  <TableCell className="max-w-[200px] text-sm">
                    {!order.externalName ? (
                      <span className="text-muted-foreground">-</span>
                    ) : order.isFeasibleExternal === true ? (
                      <div className="space-y-1 text-teal-700">
                        <div className="text-xs font-medium">بواسطة: {order.externalName}</div>
                        {order.externalCabinNumber && <div>كابينة: {order.externalCabinNumber}</div>}
                        {order.externalBoxNumber && <div>بوكس: {order.externalBoxNumber}</div>}
                      </div>
                    ) : (
                      <div className="text-destructive text-xs">
                        <div className="font-medium">بواسطة: {order.externalName}</div>
                        {order.externalRejectionReason && <div>{order.externalRejectionReason}</div>}
                        {order.externalCentralName && <span className="block text-muted-foreground">السنترال: {order.externalCentralName}</span>}
                        {order.externalCabinNumber && <span className="block text-muted-foreground">كابينة: {order.externalCabinNumber}</span>}
                        {order.externalBoxNumber && <span className="block text-muted-foreground">بوكس: {order.externalBoxNumber}</span>}
                        {order.externalNearestBoxDistance && <span className="block text-muted-foreground">بعد: {order.externalNearestBoxDistance}م</span>}
                        {order.externalAdditionalNotes && <span className="block text-muted-foreground">{order.externalAdditionalNotes}</span>}
                      </div>
                    )}
                  </TableCell>
                )}

                {/* Actions Cell */}
                <TableCell>
                  <div className="flex gap-2 flex-wrap">

                    {/* Tech actions - only for pending orders */}
                    {user?.role === ROLES.TECH && order.status === ORDER_STATUS.PENDING && (
                      <>
                        <TechActionModal order={order} action="feasible" />
                        <TechActionModal order={order} action="not_feasible" />
                      </>
                    )}

                    {/* External affairs actions - only for needs_external orders */}
                    {user?.role === ROLES.EXTERNAL && order.status === ORDER_STATUS.NEEDS_EXTERNAL && (
                      <>
                        <ExternalActionModal order={order} action="feasible" />
                        <ExternalActionModal order={order} action="not_feasible" />
                      </>
                    )}

                    {/* Sales actions */}
                    {user?.role === ROLES.SALES && (
                      <>
                        {/* Re-inspection button - only for not_feasible orders */}
                        {order.status === ORDER_STATUS.NOT_FEASIBLE && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-yellow-600 border-yellow-300 hover:bg-yellow-50"
                                disabled={isRequestingExternal}
                                data-testid={`button-external-review-${order.id}`}
                              >
                                {isRequestingExternal ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4 mr-1" />
                                )}
                                إعادة معاينة
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent dir="rtl">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-right">تأكيد إعادة المعاينة</AlertDialogTitle>
                                <AlertDialogDescription className="text-right">
                                  هل تريد تحويل هذا الطلب إلى مراقب الشئون الخارجية لإعادة تقييمه؟
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter className="flex-row-reverse gap-2">
                                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => requestExternalReview(order.id)}
                                  className="bg-yellow-600 text-white hover:bg-yellow-700"
                                >
                                  تأكيد
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}

                        {/* Contract button - only after a response has been given (not pending or needs_external) */}
                        {canMarkContracted(order) && (
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
                      </>
                    )}

                    {/* Admin actions */}
                    {user?.role === ROLES.ADMIN && (
                      <>
                        {/* Re-inspection button for admin on not_feasible orders */}
                        {order.status === ORDER_STATUS.NOT_FEASIBLE && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-yellow-600 border-yellow-300 hover:bg-yellow-50"
                                disabled={isRequestingExternal}
                                data-testid={`button-external-review-admin-${order.id}`}
                              >
                                {isRequestingExternal ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4 mr-1" />
                                )}
                                إعادة معاينة
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent dir="rtl">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-right">تأكيد إعادة المعاينة</AlertDialogTitle>
                                <AlertDialogDescription className="text-right">
                                  هل تريد تحويل هذا الطلب إلى مراقب الشئون الخارجية لإعادة تقييمه؟
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter className="flex-row-reverse gap-2">
                                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => requestExternalReview(order.id)}
                                  className="bg-yellow-600 text-white hover:bg-yellow-700"
                                >
                                  تأكيد
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}

                        {order.status !== ORDER_STATUS.PENDING && (
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

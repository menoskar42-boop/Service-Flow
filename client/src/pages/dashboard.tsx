import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LogOut, Plus, Download, Check, X } from "lucide-react";
import * as XLSX from "xlsx";

type User = {
  id: number;
  username: string;
  role: string;
};

type Order = {
  id: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  salesId: number;
  salesName: string;
  status: string;
  isFeasible: boolean | null;
  rejectionReason: string | null;
  cabinNumber: string | null;
  boxNumber: string | null;
  techId: number | null;
  techName: string | null;
  techResponseAt: string | null;
  createdAt: string;
};

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showFeasibleDialog, setShowFeasibleDialog] = useState(false);
  const [showNotFeasibleDialog, setShowNotFeasibleDialog] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [newOrder, setNewOrder] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
  });

  const [feasibleData, setFeasibleData] = useState({
    cabinNumber: "",
    boxNumber: "",
  });

  const [notFeasibleData, setNotFeasibleData] = useState({
    rejectionReason: "",
    cabinNumber: "",
    boxNumber: "",
  });

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    enabled: !!user,
  });

  useEffect(() => {
    if (!userLoading && !user) {
      setLocation("/login");
    }
  }, [user, userLoading, setLocation]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    };

    return () => ws.close();
  }, []);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
    },
  });

  const createOrderMutation = useMutation({
    mutationFn: async (data: typeof newOrder) => {
      const res = await apiRequest("POST", "/api/orders", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setShowCreateDialog(false);
      setNewOrder({ customerName: "", customerPhone: "", customerAddress: "" });
      toast({ title: "تم إنشاء الطلب بنجاح" });
    },
    onError: () => {
      toast({ title: "خطأ في إنشاء الطلب", variant: "destructive" });
    },
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: {
        isFeasible: boolean;
        rejectionReason?: string;
        cabinNumber?: string;
        boxNumber?: string;
      };
    }) => {
      const res = await apiRequest("PUT", `/api/orders/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setShowFeasibleDialog(false);
      setShowNotFeasibleDialog(false);
      setSelectedOrder(null);
      setFeasibleData({ cabinNumber: "", boxNumber: "" });
      setNotFeasibleData({ rejectionReason: "", cabinNumber: "", boxNumber: "" });
      toast({ title: "تم تحديث الطلب بنجاح" });
    },
    onError: () => {
      toast({ title: "خطأ في تحديث الطلب", variant: "destructive" });
    },
  });

  const handleExport = () => {
    const exportData = orders.map((o) => ({
      "رقم الطلب": o.id,
      "اسم العميل": o.customerName,
      "رقم التليفون": o.customerPhone,
      "العنوان": o.customerAddress,
      "موظف المبيعات": o.salesName,
      "الحالة": o.status === "pending" ? "قيد الانتظار" : o.status === "feasible" ? "يمكن التنفيذ" : "لا يمكن التنفيذ",
      "سبب الرفض": o.rejectionReason || "",
      "رقم الكابينة": o.cabinNumber || "",
      "رقم البوكس": o.boxNumber || "",
      "الفني": o.techName || "",
      "تاريخ الإنشاء": new Date(o.createdAt).toLocaleString("ar-EG"),
      "تاريخ رد الفني": o.techResponseAt ? new Date(o.techResponseAt).toLocaleString("ar-EG") : "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, "orders.xlsx");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary">قيد الانتظار</Badge>;
      case "feasible":
        return <Badge className="bg-green-500 text-white">يمكن التنفيذ</Badge>;
      case "not_feasible":
        return <Badge variant="destructive">لا يمكن التنفيذ</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (userLoading || ordersLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>جاري التحميل...</p>
      </div>
    );
  }

  if (!user) return null;

  const isSales = user.role === "sales";
  const isTech = user.role === "tech";
  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-xl font-bold">نظام إدارة الطلبات</h1>
            <Badge variant="outline">{user.username} ({user.role})</Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSales && (
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-order">
                <Plus className="w-4 h-4 mr-2" />
                طلب جديد
              </Button>
            )}
            <Button variant="outline" onClick={handleExport} data-testid="button-export">
              <Download className="w-4 h-4 mr-2" />
              تصدير Excel
            </Button>
            <Button
              variant="ghost"
              onClick={() => logoutMutation.mutate()}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4 mr-2" />
              خروج
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>الطلبات ({orders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">لا توجد طلبات</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>اسم العميل</TableHead>
                      <TableHead>التليفون</TableHead>
                      <TableHead>العنوان</TableHead>
                      {(isTech || isAdmin) && <TableHead>موظف المبيعات</TableHead>}
                      <TableHead>الحالة</TableHead>
                      {(isTech || isAdmin) && <TableHead>التفاصيل</TableHead>}
                      {isTech && <TableHead>الإجراءات</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                        <TableCell>{order.id}</TableCell>
                        <TableCell>{order.customerName}</TableCell>
                        <TableCell>{order.customerPhone}</TableCell>
                        <TableCell>{order.customerAddress}</TableCell>
                        {(isTech || isAdmin) && <TableCell>{order.salesName}</TableCell>}
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                        {(isTech || isAdmin) && (
                          <TableCell className="text-sm">
                            {order.rejectionReason && <div>السبب: {order.rejectionReason}</div>}
                            {order.cabinNumber && <div>كابينة: {order.cabinNumber}</div>}
                            {order.boxNumber && <div>بوكس: {order.boxNumber}</div>}
                            {order.techName && <div>الفني: {order.techName}</div>}
                          </TableCell>
                        )}
                        {isTech && (
                          <TableCell>
                            {order.status === "pending" && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSelectedOrder(order);
                                    setShowFeasibleDialog(true);
                                  }}
                                  data-testid={`button-feasible-${order.id}`}
                                >
                                  <Check className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => {
                                    setSelectedOrder(order);
                                    setShowNotFeasibleDialog(true);
                                  }}
                                  data-testid={`button-not-feasible-${order.id}`}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنشاء طلب جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>اسم العميل</Label>
              <Input
                data-testid="input-customer-name"
                value={newOrder.customerName}
                onChange={(e) => setNewOrder({ ...newOrder, customerName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>رقم التليفون</Label>
              <Input
                data-testid="input-customer-phone"
                value={newOrder.customerPhone}
                onChange={(e) => setNewOrder({ ...newOrder, customerPhone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>العنوان</Label>
              <Textarea
                data-testid="input-customer-address"
                value={newOrder.customerAddress}
                onChange={(e) => setNewOrder({ ...newOrder, customerAddress: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createOrderMutation.mutate(newOrder)}
              disabled={createOrderMutation.isPending}
              data-testid="button-submit-order"
            >
              {createOrderMutation.isPending ? "جاري الإنشاء..." : "إنشاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFeasibleDialog} onOpenChange={setShowFeasibleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>يمكن التنفيذ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>رقم الكابينة (اختياري)</Label>
              <Input
                data-testid="input-cabin-number"
                value={feasibleData.cabinNumber}
                onChange={(e) => setFeasibleData({ ...feasibleData, cabinNumber: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>رقم البوكس (اختياري)</Label>
              <Input
                data-testid="input-box-number"
                value={feasibleData.boxNumber}
                onChange={(e) => setFeasibleData({ ...feasibleData, boxNumber: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                selectedOrder &&
                updateOrderMutation.mutate({
                  id: selectedOrder.id,
                  data: {
                    isFeasible: true,
                    cabinNumber: feasibleData.cabinNumber || undefined,
                    boxNumber: feasibleData.boxNumber || undefined,
                  },
                })
              }
              disabled={updateOrderMutation.isPending}
              data-testid="button-confirm-feasible"
            >
              {updateOrderMutation.isPending ? "جاري التحديث..." : "تأكيد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNotFeasibleDialog} onOpenChange={setShowNotFeasibleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>لا يمكن التنفيذ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>السبب (إجباري)</Label>
              <Textarea
                data-testid="input-rejection-reason"
                value={notFeasibleData.rejectionReason}
                onChange={(e) =>
                  setNotFeasibleData({ ...notFeasibleData, rejectionReason: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label>رقم الكابينة (اختياري)</Label>
              <Input
                data-testid="input-cabin-number-reject"
                value={notFeasibleData.cabinNumber}
                onChange={(e) =>
                  setNotFeasibleData({ ...notFeasibleData, cabinNumber: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>رقم البوكس (اختياري)</Label>
              <Input
                data-testid="input-box-number-reject"
                value={notFeasibleData.boxNumber}
                onChange={(e) =>
                  setNotFeasibleData({ ...notFeasibleData, boxNumber: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() =>
                selectedOrder &&
                notFeasibleData.rejectionReason &&
                updateOrderMutation.mutate({
                  id: selectedOrder.id,
                  data: {
                    isFeasible: false,
                    rejectionReason: notFeasibleData.rejectionReason,
                    cabinNumber: notFeasibleData.cabinNumber || undefined,
                    boxNumber: notFeasibleData.boxNumber || undefined,
                  },
                })
              }
              disabled={updateOrderMutation.isPending || !notFeasibleData.rejectionReason}
              data-testid="button-confirm-not-feasible"
            >
              {updateOrderMutation.isPending ? "جاري التحديث..." : "تأكيد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertOrder, type UpdateOrder, type UpdateExternalResponse } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useOrders() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: orders, isLoading, error } = useQuery({
    queryKey: [api.orders.list.path],
    queryFn: async () => {
      const res = await fetch(api.orders.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch orders");
      return api.orders.list.responses[200].parse(await res.json());
    },
  });

  const createOrderMutation = useMutation({
    mutationFn: async (newOrder: InsertOrder) => {
      const res = await fetch(api.orders.create.path, {
        method: api.orders.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOrder),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create order");
      }
      
      return api.orders.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: "تم إنشاء الطلب",
        description: "تمت إضافة الطلب بنجاح",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "خطأ",
        description: error.message,
      });
    },
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: UpdateOrder }) => {
      const url = buildUrl(api.orders.update.path, { id });
      const res = await fetch(url, {
        method: api.orders.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update order");
      }
      
      return api.orders.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: "تم تحديث الطلب",
        description: "تم تحديث حالة الطلب بنجاح",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "خطأ",
        description: error.message,
      });
    },
  });

  const resetTechResponseMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const url = buildUrl(api.orders.resetTechResponse.path, { id: orderId });
      const res = await fetch(url, {
        method: api.orders.resetTechResponse.method,
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reset order");
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: "تم إعادة الطلب",
        description: "تم إلغاء رد الفني وإعادة الطلب لقيد الانتظار",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "خطأ",
        description: error.message,
      });
    },
  });

  const updateContractStatusMutation = useMutation({
    mutationFn: async ({ orderId, contractStatus }: { orderId: number; contractStatus: string }) => {
      const url = buildUrl(api.orders.updateContractStatus.path, { id: orderId });
      const res = await fetch(url, {
        method: api.orders.updateContractStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractStatus }),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update contract status");
      }
      
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: variables.contractStatus === "تم التعاقد" ? "تم التعاقد" : "تم إلغاء التعاقد",
        description: variables.contractStatus === "تم التعاقد" 
          ? "تم تحديث حالة التعاقد بنجاح" 
          : "تم إرجاع الطلب إلى لم يتم التعاقد",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "خطأ",
        description: error.message,
      });
    },
  });

  const requestExternalReviewMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const url = buildUrl(api.orders.requestExternalReview.path, { id: orderId });
      const res = await fetch(url, {
        method: api.orders.requestExternalReview.method,
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to request external review");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: "تم طلب إعادة المعاينة",
        description: "تم تحويل الطلب إلى مراقب الشئون الخارجية",
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "خطأ", description: error.message });
    },
  });

  const assignOrderMutation = useMutation({
    mutationFn: async ({ orderId, techId }: { orderId: number; techId: number | null }) => {
      const res = await fetch(`/api/orders/${orderId}/assign`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ techId }),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to assign order");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: variables.techId == null ? "تم إلغاء التعيين" : "تم تعيين الفني",
        description: variables.techId == null
          ? "الطلب متاح الآن لكل الفنيين"
          : "تم إسناد الطلب للفني المحدد",
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "خطأ", description: error.message });
    },
  });

  const externalResponseMutation = useMutation({
    mutationFn: async ({ orderId, data }: { orderId: number; data: UpdateExternalResponse }) => {
      const url = buildUrl(api.orders.externalResponse.path, { id: orderId });
      const res = await fetch(url, {
        method: api.orders.externalResponse.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to save external response");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: "تم حفظ الرد",
        description: "تم تسجيل رد الشئون الخارجية بنجاح",
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "خطأ", description: error.message });
    },
  });

  return {
    orders,
    isLoading,
    error,
    createOrder: createOrderMutation.mutate,
    isCreating: createOrderMutation.isPending,
    updateOrder: updateOrderMutation.mutate,
    isUpdating: updateOrderMutation.isPending,
    resetTechResponse: resetTechResponseMutation.mutate,
    isResetting: resetTechResponseMutation.isPending,
    updateContractStatus: updateContractStatusMutation.mutate,
    isUpdatingContract: updateContractStatusMutation.isPending,
    requestExternalReview: requestExternalReviewMutation.mutate,
    isRequestingExternal: requestExternalReviewMutation.isPending,
    externalResponse: externalResponseMutation.mutate,
    isSubmittingExternal: externalResponseMutation.isPending,
    assignOrder: assignOrderMutation.mutate,
    isAssigning: assignOrderMutation.isPending,
  };
}

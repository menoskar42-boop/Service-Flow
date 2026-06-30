import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

export function useUsers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: users, isLoading } = useQuery({
    queryKey: [api.users.list.path],
    queryFn: async () => {
      const res = await fetch(api.users.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return api.users.list.responses[200].parse(await res.json());
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (newUser: z.infer<typeof api.users.create.input>) => {
      const res = await fetch(api.users.create.path, {
        method: api.users.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create user");
      }
      
      return api.users.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
      toast({
        title: "تم إنشاء المستخدم",
        description: "تم إضافة المستخدم الجديد بنجاح",
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

  const changePasswordMutation = useMutation({
    mutationFn: async (data: z.infer<typeof api.users.changePassword.input>) => {
      const res = await fetch(api.users.changePassword.path, {
        method: api.users.changePassword.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to change password");
      }
      
      return api.users.changePassword.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      toast({
        title: "تم تغيير كلمة المرور",
        description: "تم تحديث كلمة المرور بنجاح",
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

  const setWorkerCodeMutation = useMutation({
    mutationFn: async ({ userId, workerCode }: { userId: number; workerCode: string }) => {
      const res = await fetch(api.users.setWorkerCode.path.replace(':id', userId.toString()), {
        method: api.users.setWorkerCode.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerCode }),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to set worker code");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
      toast({ title: "تم الحفظ", description: "تم تحديث رقم العامل" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "خطأ", description: error.message });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(api.users.delete.path.replace(':id', userId.toString()), {
        method: api.users.delete.method,
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete user");
      }
      
      return api.users.delete.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
      toast({
        title: "تم حذف المستخدم",
        description: "تم حذف المستخدم بنجاح",
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

  const suspendUserMutation = useMutation({
    mutationFn: async ({ userId, suspended }: { userId: number; suspended: boolean }) => {
      const res = await fetch(api.users.suspend.path.replace(':id', userId.toString()), {
        method: api.users.suspend.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended }),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update user");
      }
      
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
      toast({
        title: variables.suspended ? "تم إيقاف المستخدم" : "تم تفعيل المستخدم",
        description: variables.suspended ? "تم إيقاف المستخدم عن العمل" : "تم إعادة تفعيل المستخدم",
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

  return {
    users,
    isLoading,
    createUser: createUserMutation.mutate,
    isCreating: createUserMutation.isPending,
    changePassword: changePasswordMutation.mutate,
    isChangingPassword: changePasswordMutation.isPending,
    setWorkerCode: setWorkerCodeMutation.mutate,
    isSettingWorkerCode: setWorkerCodeMutation.isPending,
    deleteUser: deleteUserMutation.mutate,
    isDeleting: deleteUserMutation.isPending,
    suspendUser: suspendUserMutation.mutate,
    isSuspending: suspendUserMutation.isPending,
  };
}

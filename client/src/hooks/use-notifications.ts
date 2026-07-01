import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Notification } from "@shared/schema";

interface NotificationsResponse {
  items: Notification[];
  unread: number;
}

export function useNotifications() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json() as Promise<NotificationsResponse>;
    },
    refetchInterval: 60000,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/notifications/${id}/read`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/read-all", { method: "POST", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  return {
    items: data?.items ?? [],
    unread: data?.unread ?? 0,
    markRead,
    markAllRead,
  };
}

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { WS_EVENTS } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("Connected to WebSocket");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === WS_EVENTS.ORDER_CREATE || message.type === WS_EVENTS.ORDER_UPDATE) {
            // Invalidate the orders query to trigger a refetch
            queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });

            // Show toast notification
            const title = message.type === WS_EVENTS.ORDER_CREATE
              ? "طلب جديد"
              : "تحديث طلب";

            toast({
              title: title,
              description: `الطلب #${message.payload.id} تم تحديثه`,
              duration: 3000,
            });
          }

          if (message.type === WS_EVENTS.NOTIFICATION) {
            queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message", error);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected, reconnecting in 3s...");
        setTimeout(connect, 3000);
      };
      
      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        ws.close();
      };
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [queryClient, toast]);
}

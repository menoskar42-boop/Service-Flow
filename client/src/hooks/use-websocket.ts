import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { WS_EVENTS } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAppActive } from "@/hooks/use-app-active";

// الـ WebSocket واعى للنشاط: يتوصّل وانت نشط (التاب ظاهر + بتتفاعل) عشان تحديثات الطلبات
// (إضافة طلب / إعادة فنى / إلغاء معاينة / إمكانية التنفيذ) تيجى لحظياً بدون ريفريش؛
// ويتفصل وانت خامل أو التاب فى الخلفية عشان السيرفر ينام ويوفّر. عند الرجوع يتوصّل
// ويعيد تحميل البيانات فوراً (تشوف أى تحديث فاتك وانت خامل).
export function useWebSocket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const active = useAppActive();

  useEffect(() => {
    if (!active) return; // خامل/مخفى → مفيش اتصال (السيرفر يقدر ينام)

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let closedByUs = false;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // عند (إعادة) الاتصال: حدّث البيانات عشان نلحق أى تغييرات حصلت ونحنا خاملين
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === WS_EVENTS.ORDER_CREATE || message.type === WS_EVENTS.ORDER_UPDATE) {
          queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
          toast({
            title: message.type === WS_EVENTS.ORDER_CREATE ? "طلب جديد" : "تحديث طلب",
            description: `الطلب #${message.payload?.id} تم تحديثه`,
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

    ws.onerror = () => { try { ws?.close(); } catch {} };

    return () => {
      closedByUs = true;
      try { ws?.close(); } catch {}
    };
  }, [active, queryClient, toast]);
}

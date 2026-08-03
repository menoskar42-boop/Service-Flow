import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { WS_EVENTS } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

// أسماء الملفات المرفوعة — للتوضيح فى الإشعار (المفتاح = مسار الرفع)
const IMPORT_LABELS: Record<string, string> = {
  "/api/ticket-queue/import":        "الأعطال الحالية",
  "/api/ticket-queue-ftth/import":   "أعطال FTTH الحالية",
  "/api/complaint-details/import":   "الأعطال المنتظمة (تفاصيل الشكاوى)",
  "/api/maintenance-orders/import":  "التركيبات والنقل الحالى",
  "/api/ftth-orders/import":         "متعذرات OM",
  "/api/ftth-orders/import-soy":     "متعذرات OM (بداية السنة)",
  "/api/ftth-subscribers/import":    "مشتركو FTTH",
  "/api/work-orders/import":         "أوامر الشغل",
  "/api/case-138/import":            "شيت 138 (القياسات)",
  "/api/phone-lines/import":         "بيان 131",
  "/api/phone-ports/import":         "البورتات",
  "/api/cabinet-technicians/import": "فنيو الكباين",
  "/api/cabinet-capacity/import":    "سعة الكباين",
  "/api/technician-names/import":    "أسماء الفنيين",
};

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

          // اترفع ملف جديد → نبطّل صلاحية كل الاستعلامات فالتقرير المفتوح يعيد الجلب
          // لوحده فوراً (الأعطال الحالية/المنتظمة، التركيبات والنقل، متعذرات OM، … أياً كان).
          // invalidateQueries من غير فلتر بتعيد جلب الاستعلامات النشِطة بس، فالتكلفة =
          // طلبات الصفحة المفتوحة فقط. ولازم كده لأن staleTime عندنا Infinity.
          if (message.type === WS_EVENTS.DATA_IMPORT) {
            queryClient.invalidateQueries();
            const label = IMPORT_LABELS[message.payload?.key as string];
            toast({
              title: "اتحدّثت البيانات",
              description: label ? `${label} — التقرير اتحدّث تلقائياً` : "التقارير اتحدّثت تلقائياً",
              duration: 4000,
            });
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

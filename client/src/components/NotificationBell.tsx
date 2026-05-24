import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNotifications } from "@/hooks/use-notifications";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

export function NotificationBell() {
  const { items, unread, markRead, markAllRead } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative h-8 sm:h-9 px-2 sm:px-3" aria-label="الإشعارات">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        dir="rtl"
        className="w-80 p-0 bg-white"
        style={{ backgroundColor: "white" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">الإشعارات</h3>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-primary"
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="w-3.5 h-3.5 ml-1" />
              تعليم الكل كمقروء
            </Button>
          )}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              لا توجد إشعارات
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => { if (!n.isRead) markRead.mutate(n.id); }}
                className={`w-full text-right px-4 py-3 border-b last:border-0 transition-colors hover:bg-muted/40 ${
                  n.isRead ? "" : "bg-blue-50/60"
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-600 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{n.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {format(new Date(n.createdAt), "yyyy/MM/dd HH:mm", { locale: ar })}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

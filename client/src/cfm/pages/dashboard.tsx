import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/cfm/components/ui/card";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { Ticket as TicketIcon, Activity, CheckCircle2, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { ticketsApi, type Ticket } from "@/cfm/lib/api";

export default function Dashboard() {
  const { language } = useStore();
  const t = translations[language];
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const ticketsData = await ticketsApi.getAll();
      setTickets(ticketsData);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const stats = [
    {
      label: t.totalTickets,
      value: loading ? '...' : tickets.length,
      icon: TicketIcon,
      color: "text-blue-500",
      bg: "bg-blue-500/10"
    },
    {
      label: t.openTickets,
      value: loading ? '...' : tickets.filter(t => t.status === 'open').length,
      icon: AlertTriangle,
      color: "text-orange-500",
      bg: "bg-orange-500/10"
    },
    {
      label: t.resolvedTickets,
      value: loading ? '...' : tickets.filter(t => t.status === 'closed').length,
      icon: CheckCircle2,
      color: "text-green-500",
      bg: "bg-green-500/10"
    },
    {
      label: "بانتظار التأكيد",
      value: loading ? '...' : tickets.filter(t => t.status === 'pending_confirmation').length,
      icon: Clock,
      color: "text-purple-500",
      bg: "bg-purple-500/10"
    }
  ];

  const dayNamesAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNames = language === 'ar' ? dayNamesAr : dayNamesEn;

  const getWeeklyChartData = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    const counts: number[] = [0, 0, 0, 0, 0, 0, 0];

    tickets.forEach(ticket => {
      const created = new Date(ticket.createdAt);
      if (created >= startOfWeek) {
        const day = created.getDay();
        counts[day]++;
      }
    });

    return counts.map((count, i) => ({
      name: dayNames[i],
      tickets: count,
    }));
  };

  const chartData = getWeeklyChartData();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <Card key={i} className="border-none shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">{stat.label}</p>
                <h3 className="text-2xl font-bold tracking-tight">{stat.value}</h3>
              </div>
              <div className={`p-3 rounded-full ${stat.bg} ${stat.color}`}>
                <stat.icon size={20} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Activity size={18} className="text-primary" />
              {language === 'ar' ? 'النشاط الأسبوعي' : 'Weekly Activity'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#888', fontSize: 12}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#888', fontSize: 12}} />
                  <Tooltip 
                    cursor={{fill: '#f4f4f5'}}
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} 
                  />
                  <Bar dataKey="tickets" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-medium">{language === 'ar' ? 'آخر النشاطات' : 'Recent Activity'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {tickets.slice(0, 5).map(ticket => (
                <div key={ticket.id} className="flex items-start gap-3 pb-3 border-b last:border-0 last:pb-0">
                  <div className={`w-2 h-2 mt-2 rounded-full shrink-0 
                    ${ticket.status === 'open' ? 'bg-orange-500' : 
                      ticket.status === 'closed' ? 'bg-green-500' : 'bg-blue-500'}`} 
                  />
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {ticket.ticketNumber}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {ticket.notes || "No notes"}
                    </p>
                    <span className="text-[10px] text-muted-foreground/70 font-mono">
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

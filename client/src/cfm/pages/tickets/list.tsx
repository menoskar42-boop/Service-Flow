import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { ticketsApi, masterDataApi, usersApi, type Ticket, type Central, type Cable as CableType, type FaultType, type User as UserType } from "@/cfm/lib/api";
import { Link } from "wouter";
import { Button } from "@/cfm/components/ui/button";
import { Input } from "@/cfm/components/ui/input";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/cfm/components/ui/table";
import { Badge } from "@/cfm/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/cfm/components/ui/tabs";
import { Plus, Search, Eye, FileSpreadsheet, ArrowDownUp, ArrowDown, ArrowUp } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import ExcelJS from 'exceljs';
import { arNorm, arIncludes } from "@shared/ar-norm";

export default function TicketList() {
  const { language, user } = useStore();
  const t = translations[language];
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  
  // API-fetched data
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [centrals, setCentrals] = useState<Central[]>([]);
  const [cables, setCables] = useState<CableType[]>([]);
  const [faultTypes, setFaultTypes] = useState<FaultType[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Sort direction: 'desc' = newest first, 'asc' = oldest first
  const sortKey = user ? `tickets_sort_dir_${user.id}` : 'tickets_sort_dir';
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>(() => {
    const saved = localStorage.getItem(sortKey);
    return (saved === 'asc' || saved === 'desc') ? saved : 'desc';
  });

  const toggleSort = () => {
    const next = sortDir === 'desc' ? 'asc' : 'desc';
    setSortDir(next);
    localStorage.setItem(sortKey, next);
  };

  // Fetch all data from API
  const fetchData = useCallback(async () => {
    try {
      const [ticketsData, centralsData, cablesData, faultTypesData] = await Promise.all([
        ticketsApi.getAll(),
        masterDataApi.getCentrals(),
        masterDataApi.getCables(),
        masterDataApi.getFaultTypes()
      ]);
      setTickets(ticketsData);
      setCentrals(centralsData);
      setCables(cablesData);
      setFaultTypes(faultTypesData);
      
      // Try to fetch users (admin only), but don't fail if not allowed
      try {
        const usersData = await usersApi.getAll();
        setUsers(usersData);
      } catch {
        // Non-admin users can't fetch users list, use data from tickets
        const usersFromTickets = ticketsData
          .filter((t: Ticket) => t.createdByUser)
          .map((t: Ticket) => t.createdByUser as UserType)
          .filter((u: UserType, i: number, arr: UserType[]) => arr.findIndex(x => x.id === u.id) === i);
        setUsers(usersFromTickets);
      }
    } catch (error) {
      console.error("Failed to fetch tickets data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount and window focus
  useEffect(() => {
    fetchData();
    
    const handleFocus = () => fetchData();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchData]);

  const canCreateTicket = user?.role !== 'splice_tech' && user?.role !== 'cable_engineer';

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-orange-100 text-orange-700 hover:bg-orange-100/80 border-orange-200';
      case 'pending_confirmation': return 'bg-blue-100 text-blue-700 hover:bg-blue-100/80 border-blue-200';
      case 'closed': return 'bg-green-100 text-green-700 hover:bg-green-100/80 border-green-200';
      case 'cancelled': return 'bg-gray-100 text-gray-700 hover:bg-gray-100/80 border-gray-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredTickets = tickets.filter(ticket => {
    const searchLower = arNorm(search);
    const central = centrals.find(c => c.id === ticket.centralId);
    const cable = cables.find(c => c.id === ticket.cableId);
    const fault = faultTypes.find(f => f.id === ticket.faultTypeId);
    const creator = users.find(u => u.id === ticket.createdBy);
    
    const matchesSearch = 
      arIncludes(ticket.ticketNumber, searchLower) ||
      arIncludes((central?.name?.toLowerCase() || ''), searchLower) ||
      arIncludes((cable?.number?.toLowerCase() || ''), searchLower) ||
      arIncludes((ticket.box?.toLowerCase() || ''), searchLower) ||
      arIncludes((fault?.name?.toLowerCase() || ''), searchLower) ||
      arIncludes((creator?.name?.toLowerCase() || ''), searchLower) ||
      arIncludes(t[ticket.status as keyof typeof t]?.toString(), searchLower);
    
    if (activeTab === 'all') return matchesSearch;
    
    return matchesSearch && ticket.status === activeTab;
  }).sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return sortDir === 'desc' ? -diff : diff;
  });

  const exportToExcel = async () => {
    // Define Headers
    const headers = [
      t.ticketNumber,
      t.central,
      t.cableNumber,
      t.box,
      t.faultType,
      t.status,
      t.openedBy,
      t.created,
      t.hasWorks,
      t.hasTasks,
      t.hasMeasurements,
      t.closedBy,
      t.closedAt
    ];

    // Define Data Rows
    const data = filteredTickets.map(ticket => {
      const central = centrals.find(c => c.id === ticket.centralId)?.name || '';
      const cable = cables.find(c => c.id === ticket.cableId);
      const fault = faultTypes.find(f => f.id === ticket.faultTypeId)?.name || '';
      const creator = users.find(u => u.id === ticket.createdBy)?.name || ticket.createdBy;
      const closer = ticket.closedBy ? (users.find(u => u.id === ticket.closedBy)?.name || ticket.closedBy) : '';
      
      return [
        ticket.ticketNumber,
        central,
        cable?.number || '',
        ticket.box,
        fault,
        t[ticket.status as keyof typeof t] || ticket.status,
        creator,
        new Date(ticket.createdAt).toLocaleDateString(),
        ticket.works && ticket.works.length > 0 ? t.yes : t.no,
        ticket.usedTasks && ticket.usedTasks.length > 0 ? t.yes : t.no,
        ticket.measurements && ticket.measurements.length > 0 ? t.yes : t.no,
        closer,
        ticket.closedAt ? new Date(ticket.closedAt).toLocaleDateString() : ''
      ];
    });

    // Create Worksheet from Array of Arrays
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Tickets");
    
    worksheet.addRow(headers);
    data.forEach(row => worksheet.addRow(row));
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = "tickets_export.xlsx";
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">{t.tickets}</h1>
          <p className="text-sm text-muted-foreground">Manage and track all cable faults</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToExcel} className="gap-2">
            <FileSpreadsheet size={16} /> {t.exportExcel}
          </Button>
          {canCreateTicket && (
            <Link href="/tickets/create">
              <Button className="shadow-lg shadow-primary/20">
                <Plus className="mr-2 h-4 w-4" /> {t.createTicket}
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm">
        <div className="p-4 flex flex-col md:flex-row items-center gap-4 border-b">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
            <TabsList>
              <TabsTrigger value="open">{t.open}</TabsTrigger>
              <TabsTrigger value="pending_confirmation">{t.pending_confirmation}</TabsTrigger>
              <TabsTrigger value="closed">{t.closed}</TabsTrigger>
              <TabsTrigger value="all">{t.filterAll}</TabsTrigger>
            </TabsList>
          </Tabs>
          
          <div className="flex items-center gap-2 mr-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSort}
              className="gap-1.5 whitespace-nowrap"
              title={sortDir === 'desc' ? 'الأحدث أولاً' : 'الأقدم أولاً'}
            >
              {sortDir === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              {sortDir === 'desc' ? 'الأحدث أولاً' : 'الأقدم أولاً'}
            </Button>
          </div>

          <div className="relative flex-1 w-full md:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search ticket # or central..." 
              className="pl-9 bg-secondary/50 border-transparent focus:bg-background focus:border-input transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/30">
              <TableRow>
                <TableHead className="w-[120px] font-semibold">{t.ticketNumber}</TableHead>
                <TableHead className="font-semibold whitespace-nowrap">تاريخ الإنشاء</TableHead>
                <TableHead className="font-semibold">{t.central}</TableHead>
                <TableHead className="font-semibold">{t.cableNumber}</TableHead>
                <TableHead className="font-semibold">{t.box}</TableHead>
                <TableHead className="font-semibold hidden md:table-cell">{t.faultType}</TableHead>
                <TableHead className="font-semibold">{t.status}</TableHead>
                <TableHead className="font-semibold hidden lg:table-cell">{t.openedBy}</TableHead>
                <TableHead className="font-semibold text-center text-xs px-1">{t.hasWorks}</TableHead>
                <TableHead className="font-semibold text-center text-xs px-1">{t.hasTasks}</TableHead>
                <TableHead className="font-semibold text-center text-xs px-1">{t.hasMeasurements}</TableHead>
                <TableHead className="font-semibold hidden lg:table-cell">{t.closedBy}</TableHead>
                <TableHead className="font-semibold hidden lg:table-cell">{t.closedAt}</TableHead>
                <TableHead className="text-right">{t.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="h-32 text-center text-muted-foreground">
                    No tickets found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTickets.map((ticket) => {
                  const central = centrals.find(c => c.id === ticket.centralId);
                  const cable = cables.find(c => c.id === ticket.cableId);
                  const fault = faultTypes.find(f => f.id === ticket.faultTypeId);
                  // التكتات اللى بتتفتح تلقائياً من Service-Flow بتحط اسم معروض بديل
                  // (اسم الفنى-المصدر)، وغيرها بياخد اسم الحساب اللى أنشأها.
                  const creator = (ticket as any).openedByLabel
                    || users.find(u => u.id === ticket.createdBy)?.name || ticket.createdBy;
                  const closer = ticket.closedBy ? (users.find(u => u.id === ticket.closedBy)?.name || ticket.closedBy) : null;
                  
                  return (
                    <TableRow key={ticket.id} className="group hover:bg-secondary/40 transition-colors">
                      <TableCell className="font-mono font-medium text-primary">
                        {ticket.ticketNumber}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {new Date(ticket.createdAt).toLocaleDateString('ar-EG')}
                      </TableCell>
                      <TableCell>{central?.name || 'Unknown'}</TableCell>
                      <TableCell className="font-mono">{cable?.number || '-'}</TableCell>
                      <TableCell className="font-mono">{ticket.box}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="flex items-center gap-2">
                           {fault?.name || 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${getStatusColor(ticket.status)} border capitalize font-medium`}>
                          {t[ticket.status] || ticket.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {creator}
                      </TableCell>
                      <TableCell className="text-center">
                        {(ticket.works?.length ?? 0) > 0 ? <span className="text-green-600 font-bold">✓</span> : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {(ticket.usedTasks?.length ?? 0) > 0 ? <span className="text-green-600 font-bold">✓</span> : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {(ticket.measurements?.length ?? 0) > 0 ? <span className="text-green-600 font-bold">✓</span> : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {closer || '-'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground font-mono">
                        {ticket.closedAt ? new Date(ticket.closedAt).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/tickets/${ticket.id}`}>
                          <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <Eye className="h-4 w-4 mr-1" /> {t.view}
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

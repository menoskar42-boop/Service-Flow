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
import { normCentral, normCab, normBox, expandBoxes } from "@shared/cab-norm";

export default function TicketList() {
  const { language, user } = useStore();
  const t = translations[language];
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("open");   // الافتراضى: المفتوحة
  // فلتر «به متعذرات» — التكتات اللى على بكسها متعذرات «بوكس معطل» (OM أو طلبات)
  const [onlyWithCases, setOnlyWithCases] = useState(false);
  
  // API-fetched data
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [centrals, setCentrals] = useState<Central[]>([]);
  const [cables, setCables] = useState<CableType[]>([]);
  const [faultTypes, setFaultTypes] = useState<FaultType[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  // عدد المتعذرات «بوكس معطل» على كل بكس (من Service-Flow) — سنترال|كابينة|بكس → {om, orders}
  const [boxCases, setBoxCases] = useState<Map<string, { om: number; orders: number }>>(new Map());
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
      // عدد المتعذرات على كل بكس — لو فشل مانوقفش القائمة، العمود بس هيبان فاضى
      try {
        const r = await fetch('/api/cfm/box-cases', { credentials: 'include' });
        if (r.ok) {
          const list: any[] = await r.json();
          const m = new Map<string, { om: number; orders: number }>();
          for (const x of list) {
            const k = `${normCentral(x.central)}|${normCab(x.cabinet)}|${normBox(x.box)}`;
            const cur = m.get(k) || { om: 0, orders: 0 };
            m.set(k, { om: cur.om + (x.om || 0), orders: cur.orders + (x.orders || 0) });
          }
          setBoxCases(m);
        }
      } catch {}
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

  // عدد المتعذرات «بوكس معطل» على بكس التكت = متعذرات OM + الطلبات المتعذرة، مجموعين.
  // التكت ممكن تكون على نطاق بكسيات («1:5») فبنجمع كل بكس جوّه النطاق.
  // العدد بيتحسب من بيانات Service-Flow مباشرةً — مش من ملاحظات التكت.
  const pendingCases = (ticket: Ticket, centralName?: string, cableNumber?: string) => {
    const central = normCentral(centralName ?? "");
    const cab = normCab(cableNumber ?? ticket.cabinet ?? "");
    let om = 0, orders = 0;
    for (const b of expandBoxes(ticket.box)) {
      const hit = boxCases.get(`${central}|${cab}|${b}`);
      if (hit) { om += hit.om; orders += hit.orders; }
    }
    const total = om + orders;
    const parts = [om ? `OM ${om}` : "", orders ? `طلبات ${orders}` : ""].filter(Boolean);
    return { om, orders, total, label: total ? `${total}` : "", detail: parts.join(" + ") };
  };

  const filteredTickets = tickets.filter(ticket => {
    const searchLower = arNorm(search);
    const central = centrals.find(c => c.id === ticket.centralId);
    const cable = cables.find(c => c.id === ticket.cableId);
    const fault = faultTypes.find(f => f.id === ticket.faultTypeId);
    const creator = users.find(u => u.id === ticket.createdBy);
    const closer = ticket.closedBy ? (users.find(u => u.id === ticket.closedBy)?.name || ticket.closedBy) : '';

    // البحث بيشمل **كل** الخانات الظاهرة فى الجدول — مش رقم الكابينة والبكس بس:
    // رقم التكت، التواريخ، السنترال، الكابينة، البكس، نوع العطل، الحالة،
    // «تم الفتح بواسطة» (بالاسم البديل اللى بتكتبه التكتات التلقائية زى «سامى-طلبات»)،
    // «مغلق بواسطة»، والملاحظات (وجواها المتعذرات المسجّلة بالمسلسل/الرقم القومى).
    const haystack = [
      ticket.ticketNumber,
      new Date(ticket.createdAt).toLocaleDateString('ar-EG'),
      new Date(ticket.createdAt).toLocaleDateString(),
      central?.name,
      cable?.number,
      ticket.cabinet,
      ticket.box,
      fault?.name,
      t[ticket.status as keyof typeof t]?.toString(),
      ticket.status,
      (ticket as any).openedByLabel,
      creator?.name,
      closer,
      ticket.notes,
      ticket.finalRepairDescription,
      ticket.closedAt ? new Date(ticket.closedAt).toLocaleDateString() : '',
    ].filter(Boolean).join(" | ").toLowerCase();

    const matchesSearch = !searchLower || arIncludes(haystack, searchLower);
    if (!matchesSearch) return false;

    // فلتر «به متعذرات»: التكتات اللى على بكسها متعذرات «بوكس معطل» (OM أو طلبات).
    // العدد من بيانات Service-Flow مباشرةً — نفس مصدر عمود «متعذرات» فى الجدول.
    if (onlyWithCases) {
      const central = centrals.find(c => c.id === ticket.centralId);
      const cable = cables.find(c => c.id === ticket.cableId);
      if (pendingCases(ticket, central?.name, cable?.number).total <= 0) return false;
    }

    if (activeTab === 'all') return true;
    return ticket.status === activeTab;
  }).sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return sortDir === 'desc' ? -diff : diff;
  });

  // ملخّص السطر العلوى: عدد البكسيات وعدد المتعذرات **حسب الفلتر الحالى**.
  // البكس بيتحسب مرة واحدة حتى لو ظاهر فى أكتر من تكت (المفتاح: سنترال + كابينة + بكس)،
  // وكذلك متعذراته — عشان مايتضاعفوش بعدد التكتات المفتوحة على نفس البكس.
  const summary = (() => {
    const perBox = new Map<string, number>();
    for (const ticket of filteredTickets) {
      const central = centrals.find(c => c.id === ticket.centralId);
      const cable = cables.find(c => c.id === ticket.cableId);
      const cn = normCentral(central?.name ?? "");
      const cab = normCab(cable?.number ?? ticket.cabinet ?? "");
      for (const b of expandBoxes(ticket.box)) {
        const key = `${cn}|${cab}|${b}`;
        if (perBox.has(key)) continue;
        const hit = boxCases.get(key);
        perBox.set(key, hit ? hit.om + hit.orders : 0);
      }
    }
    let cases = 0;
    for (const v of Array.from(perBox.values())) cases += v;
    return { boxes: perBox.size, cases };
  })();

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
      "متعذرات",
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
      const creator = (ticket as any).openedByLabel
        || users.find(u => u.id === ticket.createdBy)?.name || ticket.createdBy;
      const closer = ticket.closedBy ? (users.find(u => u.id === ticket.closedBy)?.name || ticket.closedBy) : '';
      
      return [
        ticket.ticketNumber,
        central,
        cable?.number || '',
        ticket.box,
        fault,
        t[ticket.status as keyof typeof t] || ticket.status,
        creator,
        pendingCases(ticket, central, cable?.number).total || '',
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
        {/* ملخّص صغير حسب الفلتر الحالى */}
        <div className="px-4 py-2 border-b bg-muted/40 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>عدد التكتات: <strong>{filteredTickets.length.toLocaleString("ar-EG")}</strong></span>
          <span>عدد البكسيات: <strong>{summary.boxes.toLocaleString("ar-EG")}</strong></span>
          <span>عدد المتعذرات: <strong className="text-amber-700">{summary.cases.toLocaleString("ar-EG")}</strong></span>
          <span className="text-muted-foreground">— البكس المكرّر فى أكتر من تكت بيتحسب مرة واحدة</span>
        </div>
        <div className="p-4 flex flex-col md:flex-row items-center gap-4 border-b">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
            <TabsList>
              <TabsTrigger value="open">{t.open}</TabsTrigger>
              <TabsTrigger value="pending_confirmation">{t.pending_confirmation}</TabsTrigger>
              <TabsTrigger value="closed">{t.closed}</TabsTrigger>
              <TabsTrigger value="all">{t.filterAll}</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* فلتر «به متعذرات» — بيشتغل مع أى تبويب حالة ومع البحث */}
          <Button
            variant={onlyWithCases ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyWithCases((v) => !v)}
            title="يعرض التكتات اللى على بكسها متعذرات «بوكس معطل» (OM أو طلبات) فقط"
            className={onlyWithCases ? "bg-amber-600 hover:bg-amber-700 gap-1" : "gap-1 text-amber-700 border-amber-300"}
          >
            به متعذرات
          </Button>

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
                <TableHead className="font-semibold whitespace-nowrap">متعذرات</TableHead>
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
                  <TableCell colSpan={15} className="h-32 text-center text-muted-foreground">
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
                  const cases = pendingCases(ticket, central?.name, cable?.number);
                  
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
                      <TableCell className="whitespace-nowrap text-sm">
                        {cases.total
                          ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800 font-medium"
                                  title={`متعذرات «بوكس معطل» على نفس البكس: ${cases.detail}`}>
                              {cases.total}
                            </span>
                          : <span className="text-muted-foreground">-</span>}
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

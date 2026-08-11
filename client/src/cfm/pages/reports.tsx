import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/cfm/components/ui/card";
import { Button } from "@/cfm/components/ui/button";
import { Input } from "@/cfm/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/cfm/components/ui/table";
import { FileSpreadsheet, FileText, Search, ArrowLeft, Users, Package, AlertTriangle, Loader2, HardHat, Ruler } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import ExcelJS from 'exceljs';
import { ticketsApi, masterDataApi, inventoryApi, type Ticket, type Contractor, type WorkType, type TaskType, type InventoryTransaction, type ExcavationWorker, type Cable } from "@/cfm/lib/api";
import { arNorm, arIncludes } from "@shared/ar-norm";

// Split a performedBy field (which may contain multiple technicians joined by
// an Arabic/Latin comma) into individual technician names.
const splitTechnicians = (performedBy?: string): string[] => {
  const parts = (performedBy || '').split(/[،,]/).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : ['-'];
};

export default function Reports() {
  const { language } = useStore();
  const t = translations[language];
  const [search, setSearch] = useState("");
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [excavationDateFrom, setExcavationDateFrom] = useState("");
  const [excavationDateTo, setExcavationDateTo] = useState("");
  const [efficiencyDateFrom, setEfficiencyDateFrom] = useState("");
  const [efficiencyDateTo, setEfficiencyDateTo] = useState("");
  const [efficiencyContractorId, setEfficiencyContractorId] = useState("");
  const [techWorksDateFrom, setTechWorksDateFrom] = useState("");
  const [techWorksDateTo, setTechWorksDateTo] = useState("");
  const [techWorksMode, setTechWorksMode] = useState<'detailed' | 'summary'>('detailed');
  const [techMeasDateFrom, setTechMeasDateFrom] = useState("");
  const [techMeasDateTo, setTechMeasDateTo] = useState("");
  const [techMeasMode, setTechMeasMode] = useState<'detailed' | 'summary'>('detailed');
  
  // API-fetched data
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [inventoryTransactions, setInventoryTransactions] = useState<InventoryTransaction[]>([]);
  const [excavationWorkers, setExcavationWorkers] = useState<ExcavationWorker[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);

  // Fetch all data from API
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [ticketsData, contractorsData, workTypesData, taskTypesData, transactionsData, excavationWorkersData, cablesData] = await Promise.all([
        ticketsApi.getAll(),
        masterDataApi.getContractors(),
        masterDataApi.getWorkTypes(),
        masterDataApi.getTaskTypes(),
        inventoryApi.getTransactions(),
        masterDataApi.getExcavationWorkers(),
        masterDataApi.getCables()
      ]);
      setTickets(ticketsData);
      setContractors(contractorsData);
      setWorkTypes(workTypesData);
      setTaskTypes([...taskTypesData].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
      setInventoryTransactions(transactionsData);
      setExcavationWorkers(excavationWorkersData);
      setCables(cablesData);
    } catch (error) {
      console.error("Failed to fetch reports data:", error);
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

  // --- Report Logic ---

  // 1. Contractor Works Report
  const getContractorData = () => {
    return tickets.flatMap(ticket => {
      const works = ticket.works || [];
      return works
        .filter(work => work.worksBy === 'contractor' && work.contractorId)
        .flatMap(work => {
          const contractor = contractors.find(c => c.id === work.contractorId);
          const items = work.items || [];
          
          return items.map(item => {
             const type = workTypes.find(wt => wt.id === item.workTypeId);
             return {
               id: `${work.id}-${item.workTypeId}`,
               contractorName: contractor?.name || 'Unknown',
               taskName: type?.name || 'Unknown',
               quantity: item.quantity,
               ticketNumber: ticket.ticketNumber,
               date: work.recordedAt // Work Entry Date (user-selected date)
             };
          });
        });
    }).filter(item => {
      const searchLower = arNorm(search);
      return (
        arIncludes(item.contractorName, searchLower) ||
        arIncludes(item.ticketNumber, searchLower) ||
        arIncludes(item.taskName, searchLower) ||
        arIncludes(String(item.quantity), searchLower)
      );
    });
  };
  
  // Show loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  // 2. Current Inventory Balance Report
  const getInventoryBalanceData = () => {
    // Groups: tasks to merge together under one display name
    // Match by checking if the task name contains specific number patterns
    // This handles any Unicode/whitespace variations in DB names
    const hasNum = (name: string, ...nums: string[]) => {
      const n = name.replace(/\s+/g, ' ');
      return nums.some(num => n.includes(` ${num} `) || n.endsWith(` ${num}`) || n.includes(` ${num}جوز`) || n.includes(`${num} جوز`));
    };
    const isWasla = (name: string) => name.includes('وصل') && name.includes('لحام');

    const GROUPS = [
      {
        displayName: 'وصله لحام كابل 10 / 20 جوز',
        matcher: (name: string) => isWasla(name) && hasNum(name, '10', '20') && !hasNum(name, '100', '200')
      },
      {
        displayName: 'وصله لحام كابل 100 / 150 جوز',
        matcher: (name: string) => isWasla(name) && hasNum(name, '100', '150') && !hasNum(name, '1000', '1500')
      },
      {
        displayName: 'وصله لحام كابل 200 / 250 جوز',
        matcher: (name: string) => isWasla(name) && hasNum(name, '200', '250') && !hasNum(name, '2000', '2500')
      },
    ];

    // Compute base data for every task type
    const allTaskData = taskTypes.map(task => {
      const transactions = inventoryTransactions.filter(tx => tx.taskTypeId === task.id);
      const incoming = transactions.filter(tx => tx.type === 'incoming').reduce((sum, tx) => sum + tx.quantity, 0);
      const outgoing = transactions.filter(tx => tx.type === 'outgoing').reduce((sum, tx) => sum + tx.quantity, 0);
      return { id: task.id, name: task.name, incoming, outgoing, balance: incoming - outgoing };
    });

    // Build grouped entries and track which IDs were consumed
    const groupedIds = new Set<string>();
    const groupedEntries: typeof allTaskData = [];

    GROUPS.forEach(group => {
      const matches = allTaskData.filter(t => group.matcher(t.name));
      if (matches.length > 0) {
        matches.forEach(t => groupedIds.add(t.id));
        groupedEntries.push({
          id: `group-${group.displayName}`,
          name: group.displayName,
          incoming: matches.reduce((s, t) => s + t.incoming, 0),
          outgoing: matches.reduce((s, t) => s + t.outgoing, 0),
          balance: matches.reduce((s, t) => s + t.balance, 0),
        });
      }
    });

    const ungrouped = allTaskData.filter(t => !groupedIds.has(t.id));
    const result = [...groupedEntries, ...ungrouped];

    return result.filter(item => {
      const searchLower = arNorm(search);
      return (
        arIncludes(item.name, searchLower) ||
        arIncludes(String(item.incoming), searchLower) ||
        arIncludes(String(item.outgoing), searchLower) ||
        arIncludes(String(item.balance), searchLower)
      );
    });
  };

  // 3. Zero Stock Report
  const getZeroStockData = () => {
    return getInventoryBalanceData().filter(item => item.balance === 0);
  };

  // 4. Excavation Workers Report - تقرير عماله الحفر
  const getExcavationWorkersData = () => {
    const resultsMap = new Map<string, any>();
    
    tickets.forEach(ticket => {
      const works = ticket.works || [];
      works.forEach(work => {
        const items = work.items || [];
        items.forEach(item => {
          if (item.excavationWorkerId) {
            const uniqueKey = `${ticket.id}-${item.excavationWorkerId}-${work.recordedAt}`;

            if (!resultsMap.has(uniqueKey)) {
              const worker = excavationWorkers.find(w => w.id === item.excavationWorkerId);
              const cable = cables.find(c => c.id === ticket.cableId);
              // المهمات المستخدمه لنفس يوم عمل الحفر فقط (لا كل مهمات التذكرة) —
              // عشان مايظهرش مهمات (زى الكابل) فى يوم حفر لم تُستخدم فيه.
              const dayOf = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : '');
              const workDay = dayOf(work.recordedAt);
              const usedTasks = (ticket.usedTasks || []).filter(ut => dayOf(ut.recordedAt) === workDay);
              const tasksUsed = usedTasks.flatMap(ut =>
                (ut.items || []).map(ti => {
                  const taskType = taskTypes.find(t => t.id === ti.taskTypeId);
                  return taskType ? `${taskType.name} (${ti.quantity})` : '';
                }).filter(Boolean)
              ).join(', ');
              
              resultsMap.set(uniqueKey, {
                id: uniqueKey,
                ticketNumber: ticket.ticketNumber,
                centralName: ticket.central?.name || '-',
                workDate: work.recordedAt,
                workerName: worker?.name || 'غير معروف',
                nationalId: worker?.nationalId || '-',
                cableNumber: cable?.cableNumber || '-',
                cabinetNumber: cable?.cabinetNumber || '-',
                boxNumber: ticket.box,
                tasksUsed: tasksUsed || '-'
              });
            }
          }
        });
      });
    });
    
    const results = Array.from(resultsMap.values());
    
    return results.filter(item => {
      const searchLower = arNorm(search);
      return (
        arIncludes(item.workerName, searchLower) ||
        arIncludes(item.ticketNumber, searchLower) ||
        item.nationalId.includes(search) ||
        arIncludes(item.centralName, searchLower) ||
        arIncludes(item.cableNumber, searchLower) ||
        arIncludes(item.cabinetNumber, searchLower) ||
        arIncludes(item.boxNumber, searchLower) ||
        arIncludes(item.tasksUsed, searchLower)
      );
    }).filter(item => {
      if (excavationDateFrom) {
        const itemDate = new Date(item.workDate).toISOString().split('T')[0];
        if (itemDate < excavationDateFrom) return false;
      }
      if (excavationDateTo) {
        const itemDate = new Date(item.workDate).toISOString().split('T')[0];
        if (itemDate > excavationDateTo) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime());
  };

  // 5. Open Tickets with Measurements Report
  const getOpenTicketsWithMeasurementsData = () => {
    return tickets
      .filter(ticket => 
        ticket.status === 'open' && 
        ticket.measurements && 
        ticket.measurements.length > 0
      )
      .map(ticket => {
        const cable = cables.find(c => c.id === ticket.cableId);
        const measurementsText = (ticket.measurements || []).map(m => {
          const directionLabel = m.direction === 'cable' ? 'من البوكس' : 'من الكابينة';
          return `المسافة: ${m.distance} م  |  الاتجاه: ${directionLabel}  |  القراءة: ${m.reading || 'N/A'}${m.notes ? `  |  ${m.notes}` : ''}`;
        }).join('\n\n');
        
        return {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          centralName: ticket.central?.name || '-',
          cabinetNumber: cable?.number || '-',
          boxNumber: ticket.box || '-',
          measurements: measurementsText
        };
      })
      .filter(item => {
        const searchLower = arNorm(search);
        return (
          arIncludes(item.ticketNumber, searchLower) ||
          arIncludes(item.centralName, searchLower) ||
          arIncludes(item.cabinetNumber, searchLower) ||
          arIncludes(item.boxNumber, searchLower) ||
          arIncludes(item.measurements, searchLower)
        );
      });
  };


  // 6. Open Tickets Needing Measurement (no measurements yet)
  const getOpenTicketsNeedingMeasurementsData = () => {
    return tickets
      .filter(ticket =>
        ticket.status === 'open' &&
        (!ticket.measurements || ticket.measurements.length === 0)
      )
      .map(ticket => {
        const cable = cables.find(c => c.id === ticket.cableId);
        return {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          centralName: ticket.central?.name || '-',
          cabinetNumber: cable?.number || '-',
          boxNumber: ticket.box || '-',
          faultType: ticket.faultType?.name || '-',
        };
      })
      .filter(item => {
        const searchLower = arNorm(search);
        return (
          arIncludes(item.ticketNumber, searchLower) ||
          arIncludes(item.centralName, searchLower) ||
          arIncludes(item.cabinetNumber, searchLower) ||
          arIncludes(item.boxNumber, searchLower) ||
          arIncludes(item.faultType, searchLower)
        );
      })
      .sort((a, b) => {
        const centralCmp = a.centralName.localeCompare(b.centralName, 'ar');
        if (centralCmp !== 0) return centralCmp;
        // Sort cabinet number numerically: "2-2" -> parse first segment then second
        const parseNum = (s: string) => s.split('-').map(n => parseInt(n) || 0);
        const [aCab, aCabSub] = parseNum(a.cabinetNumber);
        const [bCab, bCabSub] = parseNum(b.cabinetNumber);
        return aCab !== bCab ? aCab - bCab : aCabSub - bCabSub;
      });
  };

  // 7. Efficiency Report - تقرير رفع الكفاءة
  const getEfficiencyReportData = () => {
    const rows: any[] = [];
    tickets.forEach(ticket => {
      const works = ticket.works || [];
      works.forEach(work => {
        if (work.worksBy !== 'contractor') return;
        const items = work.items || [];
        items.forEach(item => {
          const wt = workTypes.find(w => w.id === item.workTypeId);
          if (!wt?.name?.includes('حفر للبحث عن اعطال')) return;
          const cable = cables.find(c => c.id === ticket.cableId);
          const contractorName = contractors.find(c => c.id === work.contractorId)?.name || '-';
          rows.push({
            id: `${work.id}-${item.workTypeId}`,
            date: work.recordedAt,
            contractorId: work.contractorId || '',
            contractorName,
            centralName: ticket.central?.name || '-',
            cableNumber: cable?.cableNumber || '-',
            cabinetNumber: cable?.number || cable?.cabinetNumber || '-',
            boxNumber: ticket.box || '-',
            excavationLength: item.excavationLength ?? '',
            excavationWidth: item.excavationWidth ?? '',
            excavationDepth: item.excavationDepth ?? '',
            notes: work.notes || '',
            technician: work.performedBy || '',
          });
        });
      });
    });

    return rows.filter(row => {
      if (efficiencyContractorId && row.contractorId !== efficiencyContractorId) return false;
      if (efficiencyDateFrom) {
        const d = new Date(row.date).toISOString().split('T')[0];
        if (d < efficiencyDateFrom) return false;
      }
      if (efficiencyDateTo) {
        const d = new Date(row.date).toISOString().split('T')[0];
        if (d > efficiencyDateTo) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  // 8. Technician Works Report - تقرير أعمال الفنيين
  const getTechWorksDetailed = () => {
    const rows: any[] = [];
    tickets.forEach(ticket => {
      (ticket.works || []).forEach(work => {
        const techNames = splitTechnicians(work.performedBy);
        (work.items || []).forEach(item => {
          const wt = workTypes.find(w => w.id === item.workTypeId);
          const d = new Date(work.recordedAt).toISOString().split('T')[0];
          if (techWorksDateFrom && d < techWorksDateFrom) return;
          if (techWorksDateTo && d > techWorksDateTo) return;
          const worksVia = work.worksBy === 'contractor'
            ? (contractors.find(c => c.id === work.contractorId)?.name || 'مقاول')
            : 'جهود ذاتية';
          // Credit each technician that performed the work
          techNames.forEach(techName => {
            rows.push({
              id: `${work.id}-${item.id}-${techName}`,
              techName,
              date: work.recordedAt,
              ticketNumber: ticket.ticketNumber,
              centralName: ticket.central?.name || '-',
              workTypeName: wt?.name || '-',
              quantity: item.quantity,
              worksVia,
            });
          });
        });
      });
    });
    return rows.sort((a, b) => a.techName.localeCompare(b.techName, 'ar') || new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const getTechWorksSummary = () => {
    const detailed = getTechWorksDetailed();
    const map = new Map<string, Map<string, number>>();
    detailed.forEach(row => {
      if (!map.has(row.techName)) map.set(row.techName, new Map());
      const inner = map.get(row.techName)!;
      inner.set(row.workTypeName, (inner.get(row.workTypeName) || 0) + row.quantity);
    });
    const rows: any[] = [];
    map.forEach((inner, techName) => {
      inner.forEach((qty, workTypeName) => {
        rows.push({ techName, workTypeName, totalQuantity: qty });
      });
    });
    return rows.sort((a, b) => a.techName.localeCompare(b.techName, 'ar'));
  };

  // 9. Technician Measurements Report - تقرير قياسات الفنيين
  const getTechMeasDetailed = () => {
    const rows: any[] = [];
    tickets.forEach(ticket => {
      (ticket.measurements || []).forEach(meas => {
        const techNames = splitTechnicians(meas.performedBy);
        const d = new Date(meas.recordedAt).toISOString().split('T')[0];
        if (techMeasDateFrom && d < techMeasDateFrom) return;
        if (techMeasDateTo && d > techMeasDateTo) return;
        const dirLabel = meas.direction === 'cable' ? 'من البوكس' : meas.direction === 'cabinet' ? 'من الكابينة' : '-';
        // Credit each technician that performed the measurement
        techNames.forEach(techName => {
          rows.push({
            id: `${meas.id}-${techName}`,
            techName,
            date: meas.recordedAt,
            ticketNumber: ticket.ticketNumber,
            centralName: ticket.central?.name || '-',
            reading: meas.reading || '-',
            distance: meas.distance ?? '-',
            direction: dirLabel,
            notes: meas.notes || '',
          });
        });
      });
    });
    return rows.sort((a, b) => a.techName.localeCompare(b.techName, 'ar') || new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const getTechMeasSummary = () => {
    const detailed = getTechMeasDetailed();
    const map = new Map<string, { count: number; tickets: Set<string> }>();
    detailed.forEach(row => {
      if (!map.has(row.techName)) map.set(row.techName, { count: 0, tickets: new Set() });
      const entry = map.get(row.techName)!;
      entry.count++;
      entry.tickets.add(row.ticketNumber);
    });
    const rows: any[] = [];
    map.forEach((val, techName) => {
      rows.push({ techName, measurementCount: val.count, ticketCount: val.tickets.size });
    });
    return rows.sort((a, b) => a.techName.localeCompare(b.techName, 'ar'));
  };

  // --- Export Logic ---
  const exportToExcel = async (data: any[], reportName: string) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Report");
    
    if (data.length > 0) {
      worksheet.columns = Object.keys(data[0]).map(key => ({
        header: key,
        key: key,
        width: 15
      }));
      worksheet.addRows(data);
    }
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportName}_export.xlsx`;
    link.click();
    window.URL.revokeObjectURL(url);
  };


  // --- Render Functions ---

  const renderContractorReport = () => {
    const data = getContractorData();
    
    const handleExport = () => {
      const exportData = data.map(row => ({
        [t.contractorName]: row.contractorName,
        [t.taskName]: row.taskName,
        [t.quantity]: row.quantity,
        [t.ticketNumber]: row.ticketNumber,
        [t.workEntryDate]: new Date(row.date).toLocaleDateString()
      }));
      exportToExcel(exportData, "Contractor_Works");
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t.contractorReport}</CardTitle>
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <FileSpreadsheet size={16} /> {t.exportExcel}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
             <Input 
               placeholder="Search contractor or ticket..." 
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.contractorName}</TableHead>
                  <TableHead>{t.taskName}</TableHead>
                  <TableHead>{t.quantity}</TableHead>
                  <TableHead>{t.ticketNumber}</TableHead>
                  <TableHead>{t.workEntryDate}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">No records.</TableCell></TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.contractorName}</TableCell>
                      <TableCell>{row.taskName}</TableCell>
                      <TableCell>{row.quantity}</TableCell>
                      <TableCell className="font-mono">{row.ticketNumber}</TableCell>
                      <TableCell>{new Date(row.date).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderInventoryReport = () => {
    const data = getInventoryBalanceData();
    
    const handleExport = () => {
      const exportData = data.map(row => ({
        [t.taskName]: row.name,
        "Incoming": row.incoming,
        "Outgoing": row.outgoing,
        "Balance": row.balance
      }));
      exportToExcel(exportData, "Inventory_Balance");
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t.inventoryReport}</CardTitle>
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <FileSpreadsheet size={16} /> {t.exportExcel}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
             <Input 
               placeholder="Search items..." 
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.taskName}</TableHead>
                  <TableHead>Incoming</TableHead>
                  <TableHead>Outgoing</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center h-24 text-muted-foreground">No records.</TableCell></TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="text-green-600">+{row.incoming}</TableCell>
                      <TableCell className="text-red-600">-{row.outgoing}</TableCell>
                      <TableCell className="text-right font-bold">{row.balance}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderZeroStockReport = () => {
    const data = getZeroStockData();
    
    const handleExport = () => {
      const exportData = data.map(row => ({
        [t.taskName]: row.name,
        "Balance": 0
      }));
      exportToExcel(exportData, "Zero_Stock");
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-red-600">{t.zeroStockReport}</CardTitle>
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <FileSpreadsheet size={16} /> {t.exportExcel}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
             <Input 
               placeholder="Search items..." 
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
          </div>
          <div className="rounded-md border border-red-100">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.taskName}</TableHead>
                  <TableHead className="text-right">Current Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="text-center h-24 text-muted-foreground">No zero-stock items found.</TableCell></TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id} className="bg-red-50/10">
                      <TableCell className="text-red-700 font-medium">{row.name}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">0</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderExcavationWorkersReport = () => {
    const data = getExcavationWorkersData();
    // «عدد العمال» = إجمالي يوميات عمال الحفر، مش عدد الأشخاص المختلفين. يعني لو
    // يوم فيه عامل شغّال ويوم فيه 3 عمال، الإجمالي فى الفترة دى = 4 يوميات — مش 1
    // (عدد الأشخاص المختلفين، اللى ممكن يكون نفس العامل اشتغل فى اليومين).
    // الحساب: نجمّع الصفوف بكل يوم، نعدّ العمال المختلفين (بالرقم القومي وإلا
    // بالاسم) فى اليوم ده وحده (لو نفس العامل ظهر على أكتر من تكت فى نفس اليوم
    // بيتحسب مرة واحدة لليوم ده)، وبعدين نجمع عدد كل يوم على التانى.
    const workerIdOf = (row: typeof data[number]) => (row.nationalId && row.nationalId !== '-' ? row.nationalId : row.workerName);
    const dayOf = (row: typeof data[number]) => new Date(row.workDate).toISOString().split('T')[0];
    const workersByDay = new Map<string, Set<string>>();
    data.forEach(row => {
      const day = dayOf(row);
      if (!workersByDay.has(day)) workersByDay.set(day, new Set());
      workersByDay.get(day)!.add(workerIdOf(row));
    });
    const uniqueWorkersCount = Array.from(workersByDay.values()).reduce((sum, workers) => sum + workers.size, 0);
    const uniqueDaysCount = workersByDay.size;

    // عدد البكسيات: البكس بيتحدّد بالسنترال + الكابينة + رقم البكس (نفس رقم البكس
    // ممكن يتكرر فى كباين/سناترل مختلفة فهو مش معرّف لوحده) — لو البكس ده اتحفر أكتر
    // من مرة (أكتر من سطر) بيتحسب مرة واحدة بس. الأسطر اللى مالهاش رقم بكس مستبعدة.
    const hasBox = (row: typeof data[number]) => !!(row.boxNumber && String(row.boxNumber).trim() && String(row.boxNumber).trim() !== '-');
    const boxKeyOf = (row: typeof data[number]) => `${row.centralName}|${row.cabinetNumber}|${row.boxNumber}`;
    const boxesByCentral = new Map<string, Set<string>>();
    data.filter(hasBox).forEach(row => {
      const central = row.centralName || '-';
      if (!boxesByCentral.has(central)) boxesByCentral.set(central, new Set());
      boxesByCentral.get(central)!.add(boxKeyOf(row));
    });
    const totalBoxesCount = Array.from(boxesByCentral.values()).reduce((sum, boxes) => sum + boxes.size, 0);
    const boxesByCentralSorted = Array.from(boxesByCentral.entries())
      .map(([central, boxes]) => ({ central, count: boxes.size }))
      .sort((a, b) => b.count - a.count);

    const handleDownloadCertificates = () => {
      // Group rows by work date
      const byDate = new Map<string, typeof data>();
      data.forEach(row => {
        const dateKey = new Date(row.workDate).toISOString().split('T')[0];
        if (!byDate.has(dateKey)) byDate.set(dateKey, []);
        byDate.get(dateKey)!.push(row);
      });

      const sortedDates = Array.from(byDate.keys()).sort();

      const toArabicNumerals = (s: string) =>
        s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[+d]);

      const formatArabicDate = (dateStr: string) => {
        const d = new Date(dateStr + 'T00:00:00');
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const day = d.getDate();
        return toArabicNumerals(`${y}/${m}/${day}`);
      };

      const pagesHtml = sortedDates.map(dateKey => {
        const rows = byDate.get(dateKey)!;
        const uniqueWorkers = new Set(rows.map(r => r.workerName)).size;
        const dateLabel = formatArabicDate(dateKey);

        const rowsHtml = rows.map(row => `
          <tr>
            <td>${row.workerName}</td>
            <td>${row.centralName}</td>
            <td>${row.nationalId}</td>
            <td></td>
            <td>${row.cableNumber}</td>
            <td>اصلاح اعطال</td>
            <td>${row.cabinetNumber}</td>
            <td>${row.boxNumber}</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>`).join('');

        return `
        <div class="page">
          <table class="header-table">
            <tr>
              <td><strong>منطقة أسيوط</strong></td>
              <td><strong>إداره الغنايم</strong></td>
              <td><strong>تاريخ الاعمال ${dateLabel}</strong></td>
              <td><strong>عدد العمالة ${toArabicNumerals(String(uniqueWorkers))}</strong></td>
            </tr>
          </table>
          <table class="main-table">
            <thead>
              <tr>
                <th rowspan="3">اسم عامل الحفر</th>
                <th rowspan="3">السنترال</th>
                <th rowspan="3">رقم قومي</th>
                <th rowspan="3">موقع العمل</th>
                <th rowspan="3">رقم الكابل</th>
                <th rowspan="3">نوع العمل<br/>اصلاح اعطال<br/>/رفع<br/>كفاءه/تزويد</th>
                <th rowspan="3">رقم الكابينه</th>
                <th colspan="4">عينه</th>
                <th rowspan="3">المهمات المنصرفه<br/>للعمل</th>
                <th rowspan="3">ملاحظات</th>
              </tr>
              <tr>
                <th rowspan="2">رقم البكس</th>
                <th colspan="3">من الخطوط</th>
              </tr>
              <tr>
                <th>المعطله<br/>لم يتم</th>
                <th>التي تم<br/>انتظامها</th>
                <th>عدد التي تم<br/>الاصلاح<br/>عليها</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div class="footer">
            <div class="sig">القائم بالاعمال</div>
            <div class="sig">مسئول مركز الصيانه</div>
            <div class="sig">مدير تشغيل الشبكه و عمليات العملاء</div>
          </div>
        </div>`;
      }).join('');

      const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <title>شهادات عمال الحفر</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; direction: rtl; background: #fff; font-size: 13px; }
    .page { width: 100%; padding: 14px 16px; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .header-table td { border: 1px solid #000; padding: 7px 10px; text-align: center; font-size: 14px; }
    .main-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .main-table th, .main-table td { border: 1px solid #000; padding: 5px 6px; text-align: center; vertical-align: middle; }
    .main-table th { background-color: #e8e8e8; font-size: 11px; line-height: 1.4; }
    .main-table tbody tr td { height: 34px; font-size: 12px; }
    .footer { display: flex; justify-content: space-between; margin-top: 50px; padding: 0 40px; }
    .sig { font-size: 14px; font-weight: bold; border-top: 1px solid #000; padding-top: 6px; min-width: 160px; text-align: center; }
    @media print {
      @page { size: A4 landscape; margin: 12mm; }
      .page { page-break-after: always; padding: 0; }
      .page:last-child { page-break-after: avoid; }
    }
  </style>
</head>
<body>${pagesHtml}</body>
</html>`;

      const win = window.open('', '_blank', 'width=900,height=700');
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.addEventListener('load', () => {
          setTimeout(() => { win.focus(); win.print(); }, 400);
        });
      }
    };

    const handleDownloadSupplySheet = () => {
      const WORKER_PRICE = 288;

      // Group by location: date + central + cable + cabinet + box, counting distinct workers
      const groupsMap = new Map<string, {
        dateKey: string;
        centralName: string;
        cableNumber: string;
        cabinetNumber: string;
        boxNumber: string;
        workers: Set<string>;
      }>();

      data.forEach(row => {
        const dateKey = new Date(row.workDate).toISOString().split('T')[0];
        const key = [dateKey, row.centralName, row.cableNumber, row.cabinetNumber, row.boxNumber].join('||');
        if (!groupsMap.has(key)) {
          groupsMap.set(key, {
            dateKey,
            centralName: row.centralName,
            cableNumber: row.cableNumber,
            cabinetNumber: row.cabinetNumber,
            boxNumber: row.boxNumber,
            workers: new Set(),
          });
        }
        const workerKey = row.nationalId && row.nationalId !== '-' ? row.nationalId : row.workerName;
        groupsMap.get(key)!.workers.add(workerKey);
      });

      const groups = Array.from(groupsMap.values()).sort((a, b) => {
        if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
        return a.centralName.localeCompare(b.centralName, 'ar');
      });

      const formatSupplyDate = (dateKey: string) => {
        const d = new Date(dateKey + 'T00:00:00');
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = String(d.getFullYear());
        return `${dd}-${mm}-${yyyy}`;
      };

      let totalWorkers = 0;
      let grandTotal = 0;
      const clean = (v: string) => (!v || v === '-' ? '' : v);

      const rowsHtml = groups.map((g, idx) => {
        const count = g.workers.size;
        const lineTotal = count * WORKER_PRICE;
        totalWorkers += count;
        grandTotal += lineTotal;
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${g.centralName}</td>
            <td>${formatSupplyDate(g.dateKey)}</td>
            <td>اصلاح اعطال</td>
            <td>${clean(g.cableNumber)}</td>
            <td>${clean(g.cabinetNumber)}</td>
            <td>${clean(g.boxNumber)}</td>
            <td>${count}</td>
            <td>${WORKER_PRICE}</td>
            <td>${lineTotal}</td>
            <td></td>
          </tr>`;
      }).join('');

      const periodHtml = (excavationDateFrom || excavationDateTo)
        ? `<p class="period">الفترة من ${excavationDateFrom || '—'} إلى ${excavationDateTo || '—'}</p>`
        : '';

      const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <title>كشف توريد عمالة الحفر</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, sans-serif; direction: rtl; background: #fff; font-size: 11px; }
    .header-info { text-align: center; margin-bottom: 10px; }
    h2 { font-size: 17px; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #333; }
    .period { font-size: 11px; color: #333; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; table-layout: fixed; }
    th, td { border: 1px solid #000; padding: 4px 3px; text-align: center; vertical-align: middle; word-wrap: break-word; overflow-wrap: break-word; font-size: 11px; }
    th { background-color: #e8e8e8; }
    td { height: 28px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    tr.totals td { font-weight: bold; background-color: #f2f2f2; font-size: 12px; }
    .footer { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 30px; gap: 20px; page-break-inside: avoid; break-inside: avoid; }
    .sig { text-align: center; font-size: 13px; font-weight: bold; flex: 1; }
    .sig p { border-top: 1px solid #000; padding-top: 6px; min-width: 160px; line-height: 1.5; }
    @media print { @page { size: A4 landscape; margin: 10mm; } }
  </style>
</head>
<body>
  <div class="header-info">
    <h2>كشف توريد عمالة الحفر</h2>
    <p class="sub">منطقة أسيوط — إدارة الغنايم</p>
    ${periodHtml}
  </div>
  <table>
    <colgroup>
      <col style="width:5%"/>
      <col style="width:15%"/>
      <col style="width:11%"/>
      <col style="width:12%"/>
      <col style="width:7%"/>
      <col style="width:7%"/>
      <col style="width:8%"/>
      <col style="width:8%"/>
      <col style="width:8%"/>
      <col style="width:9%"/>
      <col style="width:10%"/>
    </colgroup>
    <thead>
      <tr>
        <th>مسلسل</th>
        <th>اسم السنترال</th>
        <th>تاريخ التوريد</th>
        <th>وصف الأعطال</th>
        <th>كابل</th>
        <th>كابينة</th>
        <th>بنش</th>
        <th>عدد العمال</th>
        <th>سعر العامل</th>
        <th>الإجمالي</th>
        <th>ملاحظات</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="totals">
        <td colspan="7">الإجمالي</td>
        <td>${totalWorkers}</td>
        <td>${WORKER_PRICE}</td>
        <td>${grandTotal}</td>
        <td></td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    <div class="sig"><p>المكتب الفني للمقاولات والتوريدات</p></div>
    <div class="sig"><p>المصرية للاتصالات</p></div>
    <div class="sig"><p>مدير تشغيل الشبكة وعمليات العملاء</p></div>
  </div>
</body>
</html>`;

      const win = window.open('', '_blank', 'width=1000,height=700');
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.addEventListener('load', () => {
          setTimeout(() => { win.focus(); win.print(); }, 400);
        });
      }
    };

    const handleExport = () => {
      const exportData = data.map(row => ({
        "السنترال": row.centralName,
        "تاريخ الاعمال": new Date(row.workDate).toLocaleDateString('ar-EG'),
        "اسم عامل الحفر": row.workerName,
        "رقم قومي": row.nationalId,
        "رقم الكابل": row.cableNumber,
        "رقم الكابينه": row.cabinetNumber,
        "رقم البكس": row.boxNumber,
        "المهمات المستخدمه": row.tasksUsed
      }));
      exportToExcel(exportData, "Excavation_Workers_Report");
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>تقرير عماله الحفر</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDownloadCertificates} className="gap-2" disabled={data.length === 0}>
              <FileText size={16} /> تحميل الشهادات
            </Button>
            <Button variant="outline" onClick={handleDownloadSupplySheet} className="gap-2" disabled={data.length === 0}>
              <FileText size={16} /> كشف توريد العمالة
            </Button>
            <Button variant="outline" onClick={handleExport} className="gap-2">
              <FileSpreadsheet size={16} /> {t.exportExcel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-3">
             <Input
               placeholder="بحث بالاسم أو رقم التكت أو الرقم القومي..."
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
             <div className="flex items-center gap-3 flex-wrap">
               <div className="flex items-center gap-2">
                 <label className="text-sm font-medium whitespace-nowrap">من تاريخ:</label>
                 <Input type="date" value={excavationDateFrom} onChange={e => setExcavationDateFrom(e.target.value)} className="w-auto" />
               </div>
               <div className="flex items-center gap-2">
                 <label className="text-sm font-medium whitespace-nowrap">إلى تاريخ:</label>
                 <Input type="date" value={excavationDateTo} onChange={e => setExcavationDateTo(e.target.value)} className="w-auto" />
               </div>
               {(excavationDateFrom || excavationDateTo) && (
                 <Button variant="ghost" size="sm" onClick={() => { setExcavationDateFrom(""); setExcavationDateTo(""); }}>
                   مسح الفلتر
                 </Button>
               )}
             </div>
             {/* عدد العمال = إجمالى يوميات العمل (مش عدد الأشخاص المختلفين) وعدد أيام
                 العمل ضمن نتيجة البحث/الفلتر الحالية — بتتحدّث لحظياً مع أى تغيير. */}
             <div className="flex items-center gap-2 flex-wrap text-sm">
               <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary font-semibold px-3 py-1.5"
                 title="إجمالى يوميات عمال الحفر: كل عامل فى كل يوم اشتغل فيه بيتحسب مرة (لو نفس العامل اشتغل يومين بيتحسب 2)">
                 عدد العمال (يوميات): {uniqueWorkersCount}
               </span>
               <span className="inline-flex items-center gap-1.5 rounded-md bg-muted text-muted-foreground px-3 py-1.5">
                 عدد أيام العمل: {uniqueDaysCount}
               </span>
               <span className="inline-flex items-center gap-1.5 rounded-md bg-muted text-muted-foreground px-3 py-1.5">
                 عدد السطور: {data.length}
               </span>
               <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-100 text-indigo-800 font-semibold px-3 py-1.5"
                 title="عدد البكسيات المختلفة (سنترال+كابينة+بكس) — لو نفس البكس اتحفر أكتر من مرة بيتحسب مرة واحدة">
                 عدد البكسيات: {totalBoxesCount}
               </span>
             </div>
             {/* تفصيل عدد البكسيات لكل سنترال — بترتيب الأكتر أولاً */}
             {boxesByCentralSorted.length > 0 && (
               <div className="flex items-center gap-2 flex-wrap text-xs">
                 <span className="text-muted-foreground">البكسيات لكل سنترال:</span>
                 {boxesByCentralSorted.map(({ central, count }) => (
                   <span key={central} className="inline-flex items-center gap-1 rounded bg-indigo-50 text-indigo-700 px-2 py-1">
                     {central}: <b>{count}</b>
                   </span>
                 ))}
                 <span className="inline-flex items-center gap-1 rounded bg-indigo-100 text-indigo-900 font-semibold px-2 py-1">
                   الإجمالى: {totalBoxesCount}
                 </span>
               </div>
             )}
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>السنترال</TableHead>
                  <TableHead className="whitespace-nowrap">تاريخ الاعمال</TableHead>
                  <TableHead>اسم عامل الحفر</TableHead>
                  <TableHead className="whitespace-nowrap">رقم قومي</TableHead>
                  <TableHead>رقم الكابل</TableHead>
                  <TableHead>رقم الكابينه</TableHead>
                  <TableHead>رقم البكس</TableHead>
                  <TableHead>المهمات المستخدمه</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center h-24 text-muted-foreground">لا توجد تكتات بها عمال حفر</TableCell></TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="break-words">{row.centralName}</TableCell>
                      <TableCell className="whitespace-nowrap">{new Date(row.workDate).toLocaleDateString('ar-EG')}</TableCell>
                      <TableCell className="break-words">{row.workerName}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono">{row.nationalId}</TableCell>
                      <TableCell className="break-words">{row.cableNumber}</TableCell>
                      <TableCell className="break-words">{row.cabinetNumber}</TableCell>
                      <TableCell className="break-words">{row.boxNumber}</TableCell>
                      <TableCell className="break-words">{row.tasksUsed}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderOpenTicketsWithMeasurementsReport = () => {
    const data = getOpenTicketsWithMeasurementsData();
    
    const handleExport = () => {
      const exportData = data.map(row => ({
        "رقم التكت": row.ticketNumber,
        "اسم السنترال": row.centralName,
        "رقم الكابينة": row.cabinetNumber,
        "رقم البوكس": row.boxNumber,
        "القياسات المضافة": row.measurements
      }));
      exportToExcel(exportData, "Open_Tickets_With_Measurements");
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>تكتات مفتوحة بها قياسات</CardTitle>
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <FileSpreadsheet size={16} /> {t.exportExcel}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
             <Input 
               placeholder="بحث برقم التكت أو اسم السنترال..." 
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم التكت</TableHead>
                  <TableHead>اسم السنترال</TableHead>
                  <TableHead>رقم الكابينة</TableHead>
                  <TableHead>رقم البوكس</TableHead>
                  <TableHead>القياسات المضافة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">لا توجد تكتات مفتوحة بها قياسات</TableCell></TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono">{row.ticketNumber}</TableCell>
                      <TableCell>{row.centralName}</TableCell>
                      <TableCell>{row.cabinetNumber}</TableCell>
                      <TableCell>{row.boxNumber}</TableCell>
                      <TableCell className="whitespace-pre-wrap max-w-md">{row.measurements}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderOpenTicketsNeedingMeasurementsReport = () => {
    const data = getOpenTicketsNeedingMeasurementsData();

    const handleExport = () => {
      const exportData = data.map(row => ({
        "رقم التكت": row.ticketNumber,
        "اسم السنترال": row.centralName,
        "رقم الكابينة": row.cabinetNumber,
        "رقم البوكس": row.boxNumber,
        "نوع العطل": row.faultType,
      }));
      exportToExcel(exportData, "Open_Tickets_Needing_Measurements");
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>تكتات مفتوحة تحتاج قياس</CardTitle>
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <FileSpreadsheet size={16} /> {t.exportExcel}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              placeholder="بحث برقم التكت أو اسم السنترال..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم التكت</TableHead>
                  <TableHead>اسم السنترال</TableHead>
                  <TableHead>رقم الكابينة</TableHead>
                  <TableHead>رقم البوكس</TableHead>
                  <TableHead>نوع العطل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">لا توجد تكتات مفتوحة بدون قياسات</TableCell></TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono">{row.ticketNumber}</TableCell>
                      <TableCell>{row.centralName}</TableCell>
                      <TableCell>{row.cabinetNumber}</TableCell>
                      <TableCell>{row.boxNumber}</TableCell>
                      <TableCell>{row.faultType}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderTechWorksReport = () => {
    const detailed = getTechWorksDetailed();
    const summary = getTechWorksSummary();

    const handleExportExcel = async () => {
      if (techWorksMode === 'detailed') {
        await exportToExcel(detailed.map(r => ({
          "الفني": r.techName,
          "تمت الأعمال عن طريق": r.worksVia,
          "التاريخ": new Date(r.date).toLocaleDateString('ar-EG'),
          "رقم التكت": r.ticketNumber,
          "السنترال": r.centralName,
          "نوع العمل": r.workTypeName,
          "الكمية": r.quantity,
        })), "Tech_Works_Detailed");
      } else {
        await exportToExcel(summary.map(r => ({
          "الفني": r.techName,
          "نوع العمل": r.workTypeName,
          "إجمالي الكمية": r.totalQuantity,
        })), "Tech_Works_Summary");
      }
    };

    const DateFilter = () => (
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium whitespace-nowrap">من تاريخ:</label>
          <Input type="date" value={techWorksDateFrom} onChange={e => setTechWorksDateFrom(e.target.value)} className="w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium whitespace-nowrap">إلى تاريخ:</label>
          <Input type="date" value={techWorksDateTo} onChange={e => setTechWorksDateTo(e.target.value)} className="w-auto" />
        </div>
        {(techWorksDateFrom || techWorksDateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setTechWorksDateFrom(""); setTechWorksDateTo(""); }}>مسح الفلتر</Button>
        )}
      </div>
    );

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>تقرير أعمال الفنيين</CardTitle>
          <div className="flex gap-2">
            <Button variant={techWorksMode === 'detailed' ? 'default' : 'outline'} size="sm" onClick={() => setTechWorksMode('detailed')}>تفصيلي</Button>
            <Button variant={techWorksMode === 'summary' ? 'default' : 'outline'} size="sm" onClick={() => setTechWorksMode('summary')}>إجمالي</Button>
            <Button variant="outline" onClick={handleExportExcel} className="gap-2">
              <FileSpreadsheet size={16} /> {t.exportExcel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DateFilter />
          {techWorksMode === 'detailed' ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفني</TableHead>
                    <TableHead>تمت الأعمال عن طريق</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>رقم التكت</TableHead>
                    <TableHead>السنترال</TableHead>
                    <TableHead>نوع العمل</TableHead>
                    <TableHead>الكمية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailed.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center h-24 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                  ) : detailed.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.techName}</TableCell>
                      <TableCell>{row.worksVia}</TableCell>
                      <TableCell className="whitespace-nowrap">{new Date(row.date).toLocaleDateString('ar-EG')}</TableCell>
                      <TableCell className="font-mono text-xs">{row.ticketNumber}</TableCell>
                      <TableCell>{row.centralName}</TableCell>
                      <TableCell>{row.workTypeName}</TableCell>
                      <TableCell>{row.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفني</TableHead>
                    <TableHead>نوع العمل</TableHead>
                    <TableHead>إجمالي الكمية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center h-24 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                  ) : summary.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.techName}</TableCell>
                      <TableCell>{row.workTypeName}</TableCell>
                      <TableCell className="font-bold">{row.totalQuantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderTechMeasReport = () => {
    const detailed = getTechMeasDetailed();
    const summary = getTechMeasSummary();

    const handleExportExcel = async () => {
      if (techMeasMode === 'detailed') {
        await exportToExcel(detailed.map(r => ({
          "الفني": r.techName,
          "التاريخ": new Date(r.date).toLocaleDateString('ar-EG'),
          "رقم التكت": r.ticketNumber,
          "السنترال": r.centralName,
          "القراءة": r.reading,
          "المسافة": r.distance,
          "الاتجاه": r.direction,
          "ملاحظات": r.notes,
        })), "Tech_Measurements_Detailed");
      } else {
        await exportToExcel(summary.map(r => ({
          "الفني": r.techName,
          "عدد القياسات": r.measurementCount,
          "عدد التكتات": r.ticketCount,
        })), "Tech_Measurements_Summary");
      }
    };

    const DateFilter = () => (
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium whitespace-nowrap">من تاريخ:</label>
          <Input type="date" value={techMeasDateFrom} onChange={e => setTechMeasDateFrom(e.target.value)} className="w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium whitespace-nowrap">إلى تاريخ:</label>
          <Input type="date" value={techMeasDateTo} onChange={e => setTechMeasDateTo(e.target.value)} className="w-auto" />
        </div>
        {(techMeasDateFrom || techMeasDateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setTechMeasDateFrom(""); setTechMeasDateTo(""); }}>مسح الفلتر</Button>
        )}
      </div>
    );

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>تقرير قياسات الفنيين</CardTitle>
          <div className="flex gap-2">
            <Button variant={techMeasMode === 'detailed' ? 'default' : 'outline'} size="sm" onClick={() => setTechMeasMode('detailed')}>تفصيلي</Button>
            <Button variant={techMeasMode === 'summary' ? 'default' : 'outline'} size="sm" onClick={() => setTechMeasMode('summary')}>إجمالي</Button>
            <Button variant="outline" onClick={handleExportExcel} className="gap-2">
              <FileSpreadsheet size={16} /> {t.exportExcel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DateFilter />
          {techMeasMode === 'detailed' ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفني</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>رقم التكت</TableHead>
                    <TableHead>السنترال</TableHead>
                    <TableHead>القراءة</TableHead>
                    <TableHead>المسافة</TableHead>
                    <TableHead>الاتجاه</TableHead>
                    <TableHead>ملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailed.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center h-24 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                  ) : detailed.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.techName}</TableCell>
                      <TableCell className="whitespace-nowrap">{new Date(row.date).toLocaleDateString('ar-EG')}</TableCell>
                      <TableCell className="font-mono text-xs">{row.ticketNumber}</TableCell>
                      <TableCell>{row.centralName}</TableCell>
                      <TableCell>{row.reading}</TableCell>
                      <TableCell>{row.distance}</TableCell>
                      <TableCell>{row.direction}</TableCell>
                      <TableCell>{row.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفني</TableHead>
                    <TableHead>عدد القياسات</TableHead>
                    <TableHead>عدد التكتات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center h-24 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                  ) : summary.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.techName}</TableCell>
                      <TableCell className="font-bold">{row.measurementCount}</TableCell>
                      <TableCell className="font-bold">{row.ticketCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderEfficiencyReport = () => {
    const data = getEfficiencyReportData();

    const handleExportExcel = async () => {
      const exportData = data.map(row => ({
        "التاريخ": new Date(row.date).toLocaleDateString('ar-EG'),
        "الغرض من الأعمال": "الحفر للبحث عن اعطال مقاولين",
        "المقاول": row.contractorName,
        "اسم السنترال": row.centralName,
        "كابل": row.cableNumber,
        "كابينه": row.cabinetNumber,
        "بكس": row.boxNumber,
        "الطول (سم)": row.excavationLength,
        "العرض (سم)": row.excavationWidth,
        "العمق (سم)": row.excavationDepth,
        "ملاحظات": row.notes,
        "توقيع الفني": "",
      }));
      await exportToExcel(exportData, "Efficiency_Report");
    };

    const handleExportPDF = () => {
      // Group rows by contractor for separate sections
      const contractorGroups = new Map<string, typeof data>();
      data.forEach(row => {
        if (!contractorGroups.has(row.contractorName)) contractorGroups.set(row.contractorName, []);
        contractorGroups.get(row.contractorName)!.push(row);
      });

      const pagesHtml = Array.from(contractorGroups.entries()).map(([contractorName, rows]) => {
        const rowsHtml = rows.map(row => `
          <tr>
            <td>${new Date(row.date).toLocaleDateString('ar-EG')}</td>
            <td>الحفر للبحث عن اعطال مقاولين</td>
            <td>${row.centralName}</td>
            <td>${row.cableNumber}</td>
            <td>${row.cabinetNumber}</td>
            <td>${row.boxNumber}</td>
            <td>${row.excavationLength !== '' ? row.excavationLength : ''}</td>
            <td>${row.excavationWidth !== '' ? row.excavationWidth : ''}</td>
            <td>${row.excavationDepth !== '' ? row.excavationDepth : ''}</td>
            <td></td>
            <td></td>
          </tr>
        `).join('');
        const emptyRows = Array(Math.max(0, 8 - rows.length)).fill('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
        return `
          <div class="page">
            <div class="header-info">
              <h2>تقرير الحفر للبحث عن اعطال مقاولين</h2>
              <p class="contractor-label">المقاول: <strong>${contractorName}</strong></p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th><th>الغرض من الأعمال</th><th>اسم السنترال</th>
                  <th>كابل</th><th>كابينه</th><th>بكس</th>
                  <th>الطول (سم)</th><th>العرض (سم)</th><th>العمق (سم)</th>
                  <th>ملاحظات</th><th>توقيع الفني</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}${emptyRows}</tbody>
            </table>
            <div class="footer">
              <div class="sig"><p>مسئول مركز الصيانة</p></div>
              <div class="sig"><p>مدير تشغيل الشبكة وعمليات العملاء</p></div>
            </div>
          </div>`;
      }).join('');

      const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <title>تقرير الحفر للبحث عن اعطال مقاولين</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; direction: rtl; background: #fff; font-size: 12px; }
    .page { page-break-after: always; padding-bottom: 10px; }
    .page:last-child { page-break-after: avoid; }
    .header-info { text-align: center; margin-bottom: 8px; }
    h2 { font-size: 16px; margin-bottom: 4px; }
    .contractor-label { font-size: 13px; color: #333; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th, td { border: 1px solid #000; padding: 5px 6px; text-align: center; vertical-align: middle; }
    th { background-color: #e8e8e8; font-size: 11px; }
    td { height: 28px; font-size: 11px; }
    .footer { display: flex; justify-content: space-around; margin-top: 50px; }
    .sig { text-align: center; font-size: 13px; font-weight: bold; }
    .sig p { border-top: 1px solid #000; padding-top: 6px; min-width: 180px; margin-top: 40px; }
    @media print { @page { size: A4 landscape; margin: 12mm; } }
  </style>
</head>
<body>${pagesHtml}</body>
</html>`;

      const win = window.open('', '_blank', 'width=1000,height=700');
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.addEventListener('load', () => {
          setTimeout(() => { win.focus(); win.print(); }, 400);
        });
      }
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>تقرير الحفر للبحث عن اعطال مقاولين</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportPDF} className="gap-2" disabled={data.length === 0}>
              <FileText size={16} /> تصدير PDF
            </Button>
            <Button variant="outline" onClick={handleExportExcel} className="gap-2" disabled={data.length === 0}>
              <FileSpreadsheet size={16} /> {t.exportExcel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">المقاول:</label>
              <select
                value={efficiencyContractorId}
                onChange={e => setEfficiencyContractorId(e.target.value)}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                <option value="">الكل</option>
                {contractors.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">من تاريخ:</label>
              <Input type="date" value={efficiencyDateFrom} onChange={e => setEfficiencyDateFrom(e.target.value)} className="w-auto" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">إلى تاريخ:</label>
              <Input type="date" value={efficiencyDateTo} onChange={e => setEfficiencyDateTo(e.target.value)} className="w-auto" />
            </div>
            {(efficiencyDateFrom || efficiencyDateTo || efficiencyContractorId) && (
              <Button variant="ghost" size="sm" onClick={() => { setEfficiencyDateFrom(""); setEfficiencyDateTo(""); setEfficiencyContractorId(""); }}>
                مسح الفلتر
              </Button>
            )}
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الغرض من الأعمال</TableHead>
                  <TableHead>المقاول</TableHead>
                  <TableHead>اسم السنترال</TableHead>
                  <TableHead>كابل</TableHead>
                  <TableHead>كابينه</TableHead>
                  <TableHead>بكس</TableHead>
                  <TableHead>الطول (سم)</TableHead>
                  <TableHead>العرض (سم)</TableHead>
                  <TableHead>العمق (سم)</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  <TableHead>توقيع الفني</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow><TableCell colSpan={12} className="text-center h-24 text-muted-foreground">لا توجد بيانات حفر مقاولين</TableCell></TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{new Date(row.date).toLocaleDateString('ar-EG')}</TableCell>
                      <TableCell>الحفر للبحث عن اعطال مقاولين</TableCell>
                      <TableCell className="font-medium">{row.contractorName}</TableCell>
                      <TableCell>{row.centralName}</TableCell>
                      <TableCell>{row.cableNumber}</TableCell>
                      <TableCell>{row.cabinetNumber}</TableCell>
                      <TableCell>{row.boxNumber}</TableCell>
                      <TableCell>{row.excavationLength}</TableCell>
                      <TableCell>{row.excavationWidth}</TableCell>
                      <TableCell>{row.excavationDepth}</TableCell>
                      <TableCell>{row.notes}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  // --- Main View ---

  if (activeReport) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => { setActiveReport(null); setSearch(""); }} className="gap-2">
            <ArrowLeft size={16} /> {t.backToReports}
          </Button>
        </div>
        {activeReport === 'contractor' && renderContractorReport()}
        {activeReport === 'inventory' && renderInventoryReport()}
        {activeReport === 'zero' && renderZeroStockReport()}
        {activeReport === 'excavation' && renderExcavationWorkersReport()}
        {activeReport === 'openWithMeasurements' && renderOpenTicketsWithMeasurementsReport()}
        {activeReport === 'needsMeasurements' && renderOpenTicketsNeedingMeasurementsReport()}
        {activeReport === 'efficiency' && renderEfficiencyReport()}
        {activeReport === 'techWorks' && renderTechWorksReport()}
        {activeReport === 'techMeas' && renderTechMeasReport()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="text-primary" /> {t.reportsTitle}
        </h1>
        <p className="text-sm text-muted-foreground">{t.selectReport}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-blue-500" onClick={() => setActiveReport('contractor')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Contractors</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{t.contractorReport}</div>
            <p className="text-xs text-muted-foreground mt-1">View works performed by external contractors</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-green-500" onClick={() => setActiveReport('inventory')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{t.inventoryReport}</div>
            <p className="text-xs text-muted-foreground mt-1">Current stock levels and balances</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-red-500" onClick={() => setActiveReport('zero')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Shortage</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{t.zeroStockReport}</div>
            <p className="text-xs text-muted-foreground mt-1">Items with zero quantity remaining</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-orange-500" onClick={() => setActiveReport('excavation')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">عمال الحفر</CardTitle>
            <HardHat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">تقرير عماله الحفر</div>
            <p className="text-xs text-muted-foreground mt-1">عرض التكتات التي بها أعمال حفر</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-purple-500" onClick={() => setActiveReport('openWithMeasurements')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">قياسات</CardTitle>
            <Ruler className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">تكتات مفتوحة بها قياسات</div>
            <p className="text-xs text-muted-foreground mt-1">عرض التكتات المفتوحة مع القياسات المسجلة</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-yellow-500" onClick={() => setActiveReport('needsMeasurements')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تحتاج قياس</CardTitle>
            <Ruler className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">تكتات مفتوحة تحتاج قياس</div>
            <p className="text-xs text-muted-foreground mt-1">التكتات المفتوحة التي لم يُسجَّل لها أي قياس بعد</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-teal-500" onClick={() => setActiveReport('efficiency')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">حفر مقاولين</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">تقرير الحفر للبحث عن اعطال مقاولين</div>
            <p className="text-xs text-muted-foreground mt-1">أعمال الحفر للبحث عن الأعطال المنفذة بمقاولين مع الأبعاد</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-indigo-500" onClick={() => setActiveReport('techWorks')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">أعمال الفنيين</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">تقرير أعمال الفنيين</div>
            <p className="text-xs text-muted-foreground mt-1">الأعمال المنجزة لكل فني — تفصيلي وإجمالي</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-pink-500" onClick={() => setActiveReport('techMeas')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">قياسات الفنيين</CardTitle>
            <Ruler className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">تقرير قياسات الفنيين</div>
            <p className="text-xs text-muted-foreground mt-1">القياسات المسجلة لكل فني — تفصيلي وإجمالي</p>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
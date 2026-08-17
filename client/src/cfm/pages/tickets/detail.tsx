import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/cfm/components/ui/card";
import { Badge } from "@/cfm/components/ui/badge";
import { Button } from "@/cfm/components/ui/button";
import { Separator } from "@/cfm/components/ui/separator";
import { Input } from "@/cfm/components/ui/input";
import { Textarea } from "@/cfm/components/ui/textarea";
import { Label } from "@/cfm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/cfm/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/cfm/components/ui/dialog";
import { MapPin, Calendar, User, Server, Cable, Box, Activity, ArrowLeft, Wrench, Ruler, CheckCircle, AlertTriangle, Plus, Trash2, ListChecks } from "lucide-react";
import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/cfm/hooks/use-toast";
import { TicketStatus, MeasurementDirection, WorksBy } from "@/cfm/lib/types";
import { masterDataApi, usersApi, ticketsApi } from "@/cfm/lib/api";
import type { WorkType, TaskType, Contractor, User as UserType, Central, Cable as CableType, FaultType, Ticket, ExcavationWorker } from "@/cfm/lib/api";

export default function TicketDetail() {
  const [, params] = useRoute("/tickets/:id");
  const { language, user } = useStore();
  const t = translations[language];
  const { toast } = useToast();

  // Ticket fetched from API
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);

  // API-fetched master data for real-time sync
  const [centrals, setCentrals] = useState<Central[]>([]);
  const [cables, setCables] = useState<CableType[]>([]);
  const [faultTypes, setFaultTypes] = useState<FaultType[]>([]);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [excavationWorkers, setExcavationWorkers] = useState<ExcavationWorker[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);

  // Fetch master data from API on mount and when dialogs open
  const fetchMasterData = async () => {
    try {
      const [centralsData, cablesData, faultTypesData, workTypesData, taskTypesData, contractorsData, excavationWorkersData, techniciansData] = await Promise.all([
        masterDataApi.getCentrals(),
        masterDataApi.getCables(),
        masterDataApi.getFaultTypes(),
        masterDataApi.getWorkTypes(),
        masterDataApi.getTaskTypes(),
        masterDataApi.getContractors(),
        masterDataApi.getExcavationWorkers(),
        usersApi.getTechnicians()
      ]);
      setCentrals(centralsData);
      setCables(cablesData);
      setFaultTypes(faultTypesData);
      setWorkTypes([...workTypesData].sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true })));
      setTaskTypes([...taskTypesData].sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true })));
      setContractors(contractorsData);
      setExcavationWorkers(excavationWorkersData);
      setUsers(techniciansData);
    } catch (error) {
      console.error('Failed to fetch master data:', error);
    }
  };

  // Fetch ticket from API
  const fetchTicket = async () => {
    if (!params?.id) return;
    try {
      setLoading(true);
      const ticketData = await ticketsApi.getById(params.id);
      setTicket(ticketData);
    } catch (error) {
      console.error('Failed to fetch ticket:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load ticket details",
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount and refetch when window gains focus (to catch master data changes)
  useEffect(() => {
    fetchMasterData();
    fetchTicket();
    
    const handleFocus = () => {
      fetchMasterData();
      fetchTicket();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [params?.id]);
  
  // Local state for forms
  const [isWorkDialogOpen, setIsWorkDialogOpen] = useState(false);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isMeasureDialogOpen, setIsMeasureDialogOpen] = useState(false);
  const [isRepairDialogOpen, setIsRepairDialogOpen] = useState(false);
  
  // Helper to get today's date in YYYY-MM-DD format (local timezone)
  const getTodayDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Form states - Works
  const [workItems, setWorkItems] = useState<{workTypeId: string, quantity: number, excavationWorkerId?: string, excavationLength?: number, excavationWidth?: number, excavationDepth?: number}[]>([{workTypeId: '', quantity: 1}]);
  const [workNotes, setWorkNotes] = useState("");
  const [workTechnicians, setWorkTechnicians] = useState<string[]>([""]);
  const [worksBy, setWorksBy] = useState<WorksBy>('self');
  const [selectedContractor, setSelectedContractor] = useState("");
  const [workDate, setWorkDate] = useState(getTodayDate());
  
  // Pending materials - auto-loaded from work types, editable by user
  // isAuto: true = auto-generated from work types, false = manually added or edited by user
  const [pendingMaterials, setPendingMaterials] = useState<{id: string, taskTypeId: string, quantity: number, isAuto: boolean}[]>([]);

  // Form states - Tasks
  const [taskItems, setTaskItems] = useState<{taskTypeId: string, quantity: number}[]>([{taskTypeId: '', quantity: 1}]);
  const [taskNotes, setTaskNotes] = useState("");
  const [taskTechnician, setTaskTechnician] = useState("");
  const [taskDate, setTaskDate] = useState(getTodayDate());
  
  // Form states - Measurement (multiple rows)
  const [measureItems, setMeasureItems] = useState<{reading: string, distance: string, direction: MeasurementDirection, notes: string}[]>([{reading: '', distance: '', direction: 'cable', notes: ''}]);
  const [measureTechnicians, setMeasureTechnicians] = useState<string[]>([""]);
  const [measureDate, setMeasureDate] = useState(getTodayDate());

  const [repairDesc, setRepairDesc] = useState("");

  const measureDialogRef = useRef<HTMLDivElement>(null);
  const measureDialogEndRef = useRef<HTMLDivElement>(null);
  const workDialogRef = useRef<HTMLDivElement>(null);
  const workDialogEndRef = useRef<HTMLDivElement>(null);
  const taskDialogRef = useRef<HTMLDivElement>(null);
  const taskDialogEndRef = useRef<HTMLDivElement>(null);

  if (!ticket) return null;

  const central = centrals.find(c => c.id === ticket.centralId);
  const cable = cables.find(c => c.id === ticket.cableId);
  const fault = faultTypes.find(f => f.id === ticket.faultTypeId);

  // Role Permissions
  const isCableEngineer = user?.role === 'cable_engineer' || user?.role === 'admin' || user?.role === 'supervisor';
  const isSpliceTech = user?.role === 'splice_tech';
  const isExtTech = user?.role === 'ext_tech';
  const isExtAffairs = user?.role === 'external_affairs';
  const isAdmin = user?.role === 'admin';

  // Filter splice technicians for dropdowns
  const spliceTechs = users.filter(u => u.role === 'splice_tech');

  // Specific Permission Checks
  // For closed tickets: only admin can add/edit/delete entries
  const ticketIsClosed = ticket?.status === 'closed';
  const canAddMeasurements = ticketIsClosed ? isAdmin : (isCableEngineer || isSpliceTech || isAdmin);
  const canAddWorks = ticketIsClosed ? isAdmin : (isCableEngineer || isSpliceTech || isAdmin);
  const canAddTasks = ticketIsClosed ? isAdmin : (isCableEngineer || isSpliceTech || isAdmin);
  const canCloseFinalRepair = isCableEngineer || isSpliceTech || user?.role === 'admin' || user?.role === 'supervisor'; 
  const canConfirmRegularity = isExtTech || isExtAffairs || user?.role === 'admin' || user?.role === 'supervisor'; 
  
  // Handlers for dynamic rows
  const addWorkRow = () => { setWorkItems([{workTypeId: '', quantity: 1, excavationWorkerId: undefined, excavationLength: undefined, excavationWidth: undefined, excavationDepth: undefined}, ...workItems]); setTimeout(() => { if (workDialogRef.current) workDialogRef.current.scrollTop = 0; }, 100); };
  const removeWorkRow = (index: number) => {
    const newItems = workItems.filter((_, i) => i !== index);
    setWorkItems(newItems);
    recalculatePendingMaterials(newItems);
  };
  const updateWorkRow = (index: number, field: string, value: any) => {
    const newItems = [...workItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setWorkItems(newItems);
  };

  const addTaskRow = () => { setTaskItems([{taskTypeId: '', quantity: 1}, ...taskItems]); setTimeout(() => { if (taskDialogRef.current) taskDialogRef.current.scrollTop = 0; }, 100); };
  const removeTaskRow = (index: number) => setTaskItems(taskItems.filter((_, i) => i !== index));
  const updateTaskRow = (index: number, field: string, value: any) => {
    const newItems = [...taskItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setTaskItems(newItems);
  };

  // Measurement row handlers
  const addMeasureRow = () => { setMeasureItems([{reading: '', distance: '', direction: 'cable', notes: ''}, ...measureItems]); setTimeout(() => { if (measureDialogRef.current) measureDialogRef.current.scrollTop = 0; }, 100); };
  const removeMeasureRow = (index: number) => setMeasureItems(measureItems.filter((_, i) => i !== index));
  const updateMeasureRow = (index: number, field: string, value: any) => {
    const newItems = [...measureItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setMeasureItems(newItems);
  };

  // Technician multi-select handlers (works) - allows works done by more than one technician
  const addWorkTechnician = () => setWorkTechnicians([...workTechnicians, ""]);
  const updateWorkTechnician = (index: number, value: string) => { const a = [...workTechnicians]; a[index] = value; setWorkTechnicians(a); };
  const removeWorkTechnician = (index: number) => setWorkTechnicians(workTechnicians.length > 1 ? workTechnicians.filter((_, i) => i !== index) : workTechnicians);

  // Technician multi-select handlers (measurements)
  const addMeasureTechnician = () => setMeasureTechnicians([...measureTechnicians, ""]);
  const updateMeasureTechnician = (index: number, value: string) => { const a = [...measureTechnicians]; a[index] = value; setMeasureTechnicians(a); };
  const removeMeasureTechnician = (index: number) => setMeasureTechnicians(measureTechnicians.length > 1 ? measureTechnicians.filter((_, i) => i !== index) : measureTechnicians);

  // Join selected technician names (unique, non-empty) into the single performedBy text field
  const joinTechnicians = (techs: string[]) => Array.from(new Set(techs.map(s => s.trim()).filter(Boolean))).join('، ');

  // Function to recalculate pending materials when work items change
  // Preserves user-edited (manual) materials, only updates auto-generated ones
  // Manual materials override auto materials for the same taskTypeId
  const recalculatePendingMaterials = (items: {workTypeId: string, quantity: number}[]) => {
    const autoMaterialsMap = new Map<string, {id: string, taskTypeId: string, quantity: number, isAuto: boolean}>();
    
    for (const item of items) {
      if (!item.workTypeId) continue;
      const workType = workTypes.find(w => w.id === item.workTypeId);
      if (workType?.associatedMaterials && workType.associatedMaterials.length > 0) {
        for (const mat of workType.associatedMaterials) {
          const quantity = mat.defaultQuantity * item.quantity;
          const existing = autoMaterialsMap.get(mat.taskTypeId);
          if (existing) {
            existing.quantity += quantity;
          } else {
            autoMaterialsMap.set(mat.taskTypeId, {
              id: Math.random().toString(36).substr(2, 9),
              taskTypeId: mat.taskTypeId,
              quantity,
              isAuto: true
            });
          }
        }
      }
    }
    
    // Keep manual materials - they override auto materials for the same taskTypeId
    const manualMaterials = pendingMaterials.filter(m => !m.isAuto);
    const manualTaskTypeIds = new Set(manualMaterials.map(m => m.taskTypeId));
    
    // Only include auto materials that don't have a manual override
    const newAutoMaterials = Array.from(autoMaterialsMap.values()).filter(
      m => !manualTaskTypeIds.has(m.taskTypeId)
    );
    
    setPendingMaterials([...newAutoMaterials, ...manualMaterials]);
  };

  const handleAddWork = async (includeMaterials: boolean = false) => {
    if (!ticket) return;
    if (workItems.some(i => !i.workTypeId)) return;
    
    // Validate materials BEFORE saving anything (atomic operation)
    if (includeMaterials && pendingMaterials.length > 0) {
      const invalidMaterials = pendingMaterials.filter(m => !m.taskTypeId || m.quantity <= 0);
      if (invalidMaterials.length > 0) {
        toast({ variant: "destructive", title: "خطأ", description: "يرجى تحديد جميع المهمات والكميات" });
        return;
      }
    }
    
    const performedBy = isSpliceTech ? user?.name || '' : (joinTechnicians(workTechnicians) || user?.name || '');
    
    try {
      // Save work entry
      await ticketsApi.addWork(ticket.id, {
        items: workItems.map(item => ({
          id: Math.random().toString(36).substr(2, 9),
          workTypeId: item.workTypeId,
          quantity: item.quantity,
          excavationWorkerId: item.excavationWorkerId,
          excavationLength: item.excavationLength,
          excavationWidth: item.excavationWidth,
          excavationDepth: item.excavationDepth,
        })),
        notes: workNotes,
        performedBy,
        worksBy,
        contractorId: worksBy === 'contractor' ? selectedContractor : undefined,
        recordedAt: workDate ? `${workDate}T12:00:00` : undefined
      });
      
      // Save materials exactly as visible (no transformation)
      if (includeMaterials && pendingMaterials.length > 0) {
        await ticketsApi.addTask(ticket.id, {
          items: pendingMaterials.map(m => ({
            id: Math.random().toString(36).substr(2, 9),
            taskTypeId: m.taskTypeId,
            quantity: m.quantity
          })),
          notes: 'تم إضافتها مع الأعمال',
          performedBy,
          recordedAt: workDate ? `${workDate}T12:00:00` : undefined
        });
      }
      
      setIsWorkDialogOpen(false);
      resetForms();
      fetchTicket();
      toast({ 
        title: "Work Added", 
        description: includeMaterials && pendingMaterials.length > 0 ? "Work and materials recorded successfully." : "Work entry recorded successfully." 
      });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to add work" });
    }
  };

  const handleAddUsedTasks = async () => {
    if (!ticket) return;
    if (taskItems.some(i => !i.taskTypeId)) return;
    const performedBy = isSpliceTech ? user?.name || '' : taskTechnician || user?.name || '';

    try {
      await ticketsApi.addTask(ticket.id, {
        items: taskItems.map(item => ({
          id: Math.random().toString(36).substr(2, 9),
          taskTypeId: item.taskTypeId,
          quantity: item.quantity
        })),
        notes: taskNotes,
        performedBy,
        recordedAt: taskDate ? `${taskDate}T12:00:00` : undefined
      });
      setIsTaskDialogOpen(false);
      resetForms();
      fetchTicket();
      toast({ title: "Tasks Added", description: "Used tasks recorded successfully." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to add tasks" });
    }
  };

  const handleAddMeasurement = async () => {
    if (!ticket) return;
    if (measureItems.some(item => !item.distance)) {
      toast({ variant: "destructive", title: "Error", description: "Distance is required for all measurements." });
      return;
    }
    
    const performedBy = isSpliceTech ? user?.name || '' : (joinTechnicians(measureTechnicians) || user?.name || '');

    try {
      for (const item of measureItems) {
        await ticketsApi.addMeasurement(ticket.id, {
          reading: item.reading || "N/A",
          distance: Number(item.distance),
          direction: item.direction,
          notes: item.notes,
          performedBy,
          recordedAt: measureDate ? `${measureDate}T12:00:00` : undefined
        });
      }
      setIsMeasureDialogOpen(false);
      resetForms();
      fetchTicket();
      toast({ title: "Measurement Added", description: `${measureItems.length} measurement(s) recorded successfully.` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to add measurement" });
    }
  };

  const handleFinalRepair = async () => {
    if (!ticket) return;
    try {
      await ticketsApi.addFinalRepair(ticket.id, { 
        finalRepairDescription: repairDesc || undefined
      });
      setIsRepairDialogOpen(false);
      resetForms();
      fetchTicket();
      toast({ title: "Repair Recorded", description: "Ticket is now pending confirmation." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to record repair" });
    }
  };

  // Permission to delete entries: on closed tickets only admin; on open tickets admin or cable_engineer
  const canDeleteEntries = ticketIsClosed ? isAdmin : (isAdmin || isCableEngineer);

  const handleDeleteMeasurement = async (measurementId: string) => {
    if (!ticket || !canDeleteEntries) return;
    if (!confirm("هل أنت متأكد من حذف هذا القياس؟")) return;
    try {
      await ticketsApi.deleteMeasurement(ticket.id, measurementId);
      fetchTicket();
      toast({ title: "تم الحذف", description: "تم حذف القياس بنجاح." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "خطأ", description: error.message || "فشل في الحذف" });
    }
  };

  const handleDeleteWork = async (workId: string) => {
    if (!ticket || !canDeleteEntries) return;
    if (!confirm("هل أنت متأكد من حذف هذا العمل؟")) return;
    try {
      await ticketsApi.deleteWork(ticket.id, workId);
      fetchTicket();
      toast({ title: "تم الحذف", description: "تم حذف العمل بنجاح." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "خطأ", description: error.message || "فشل في الحذف" });
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!ticket || !canDeleteEntries) return;
    if (!confirm("هل أنت متأكد من حذف هذه المهمة؟")) return;
    try {
      await ticketsApi.deleteTask(ticket.id, taskId);
      fetchTicket();
      toast({ title: "تم الحذف", description: "تم حذف المهمة بنجاح." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "خطأ", description: error.message || "فشل في الحذف" });
    }
  };

  const handleConfirmRepair = async () => {
    if (!ticket) return;
    try {
      await ticketsApi.confirm(ticket.id);
      fetchTicket();
      toast({ title: "Confirmed", description: "Ticket has been closed." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to confirm" });
    }
  };

  const handleRevertRepair = async () => {
    if (!ticket) return;
    try {
      await ticketsApi.revertRepair(ticket.id);
      fetchTicket();
      toast({ title: language === 'ar' ? "تم الإلغاء" : "Reverted", description: language === 'ar' ? "تم إرجاع التذكرة للحالة مفتوحة" : "Ticket returned to open status." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to revert" });
    }
  };

  // Permission to delete ticket (admin and external_affairs only)
  const canDeleteTicket = (isAdmin || isExtAffairs) && ticket;
  const ticketHasEntries = ticket && ((ticket.works?.length || 0) > 0 || (ticket.usedTasks?.length || 0) > 0 || (ticket.measurements?.length || 0) > 0);

  const handleDeleteTicket = async () => {
    if (!ticket || !canDeleteTicket) return;
    if (!confirm(t.confirmDeleteTicket)) return;
    try {
      await ticketsApi.delete(ticket.id);
      toast({ title: t.ticketDeleted });
      window.location.href = '/tickets';
    } catch (error: any) {
      const errorMsg = error.message?.includes('existing works, tasks, or measurements') 
        ? t.cannotDeleteTicketWithEntries 
        : error.message || "Failed to delete ticket";
      toast({ variant: "destructive", title: "Error", description: errorMsg });
    }
  };

  const resetForms = () => {
    setWorkItems([{workTypeId: '', quantity: 1, excavationWorkerId: undefined, excavationLength: undefined, excavationWidth: undefined, excavationDepth: undefined}]); setWorkNotes(""); setWorkTechnicians([""]); setWorksBy('self'); setSelectedContractor(""); setWorkDate(getTodayDate());
    setPendingMaterials([]);
    setTaskItems([{taskTypeId: '', quantity: 1}]); setTaskNotes(""); setTaskTechnician(""); setTaskDate(getTodayDate());
    setMeasureItems([{reading: '', distance: '', direction: 'cable', notes: ''}]); setMeasureTechnicians([""]); setMeasureDate(getTodayDate());
    setRepairDesc("");
  };

  const getStatusBadge = (status: TicketStatus) => {
    switch(status) {
      case 'open': return <Badge className="bg-orange-500">{t.open}</Badge>;
      case 'pending_confirmation': return <Badge className="bg-blue-500">{t.pending_confirmation}</Badge>;
      case 'closed': return <Badge className="bg-green-600">{t.closed}</Badge>;
      case 'cancelled': return <Badge variant="destructive">{t.cancelled}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Link href="/tickets">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground">
            <ArrowLeft size={16} /> Back to List
          </Button>
        </Link>
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold">Ticket not found</h2>
          <p className="text-muted-foreground">The ticket you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
       <Link href="/tickets">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground">
            <ArrowLeft size={16} /> Back to List
          </Button>
       </Link>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <div className="flex items-center gap-3 mb-1">
             <h1 className="text-3xl font-bold tracking-tight text-primary font-mono">{ticket.ticketNumber}</h1>
             {getStatusBadge(ticket.status)}
           </div>
           <p className="text-muted-foreground flex items-center gap-2 text-sm">
             <Calendar size={14} /> Created on {new Date(ticket.createdAt).toLocaleString()}
           </p>
        </div>

        <div className="flex gap-2 flex-wrap">
           {/* Action Buttons based on Role & Status */}
           {/* التكت اللى اتحوّلت لـ«انتظار التأكيد» تلقائياً (المتعذر اللى فتحها اتحلّ)
               لسه مهندس الكوابل يقدر يضيف عليها مهمات وأعمال وقياسات — التحويل ده
               معناه «مستنى تأكيد» مش «اتقفلت». المقفولة بس هى اللى بتتمنع. */}
           {(ticket.status === 'open' || ticket.status === 'pending_confirmation' || isAdmin) && (
             <>
               {canAddMeasurements && (
                 <Dialog open={isMeasureDialogOpen} onOpenChange={(open) => { if (open) fetchMasterData(); setIsMeasureDialogOpen(open); }}>
                   <DialogTrigger asChild>
                     <Button variant="outline" className="gap-2">
                       <Ruler size={16} /> {t.addMeasurement}
                     </Button>
                   </DialogTrigger>
                   <DialogContent ref={measureDialogRef} className="max-w-lg max-h-[90vh] overflow-y-auto">
                     <DialogHeader><DialogTitle>{t.addMeasurement}</DialogTitle></DialogHeader>
                     <div className="space-y-4 py-4">
                       <div className="flex justify-between items-center">
                         <Label className="font-semibold">{t.measurements || 'القياسات'}</Label>
                         <Button variant="ghost" size="sm" onClick={addMeasureRow} className="h-6 text-xs bg-background border"><Plus size={12} /> Add Row</Button>
                       </div>
                       {measureItems.map((item, idx) => (
                         <div key={idx} className="border rounded-lg p-3 space-y-3">
                           <div className="flex justify-between items-center">
                             <span className="text-sm font-medium">{t.measurement || 'قياس'} #{measureItems.length - idx}</span>
                             {measureItems.length > 1 && (
                               <Button variant="ghost" size="sm" onClick={() => removeMeasureRow(idx)} className="h-6 w-6 p-0 text-destructive"><Trash2 size={12} /></Button>
                             )}
                           </div>
                           <div className="space-y-2">
                             <Label>{t.reading}</Label>
                             <Input value={item.reading} onChange={e => updateMeasureRow(idx, 'reading', e.target.value)} placeholder="e.g. 100MΩ" />
                           </div>
                           <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-2">
                               <Label>{t.distance} *</Label>
                               <Input type="number" step="0.01" value={item.distance} onChange={e => updateMeasureRow(idx, 'distance', e.target.value)} placeholder="0" />
                             </div>
                             <div className="space-y-2">
                               <Label>{t.direction}</Label>
                               <Select value={item.direction} onValueChange={(val: any) => updateMeasureRow(idx, 'direction', val)}>
                                 <SelectTrigger><SelectValue /></SelectTrigger>
                                 <SelectContent>
                                   <SelectItem value="cable">{t.fromCable}</SelectItem>
                                   <SelectItem value="cabinet">{t.fromCabinet}</SelectItem>
                                 </SelectContent>
                               </Select>
                             </div>
                           </div>
                           <div className="space-y-2">
                             <Label>{t.notes}</Label>
                             <Input value={item.notes} onChange={e => updateMeasureRow(idx, 'notes', e.target.value)} />
                           </div>
                         </div>
                       ))}
                       <div ref={measureDialogEndRef} />

                       {/* Technician Field for Measurements - supports multiple technicians */}
                       <div className="space-y-2">
                         <Label className="flex justify-between items-center">
                           <span>{t.technician}</span>
                           {!isSpliceTech && (
                             <Button variant="ghost" size="sm" onClick={addMeasureTechnician} className="h-6 text-xs bg-background border"><Plus size={12} /> إضافة فني آخر</Button>
                           )}
                         </Label>
                         {isSpliceTech ? (
                           <Input value={user.name} disabled className="bg-muted text-muted-foreground" />
                         ) : (
                           <div className="space-y-2">
                             {measureTechnicians.map((techName, idx) => (
                               <div key={idx} className="flex gap-2 items-center">
                                 <div className="flex-1">
                                   <Select value={techName} onValueChange={(val) => updateMeasureTechnician(idx, val)}>
                                     <SelectTrigger><SelectValue placeholder={t.selectTechnician} /></SelectTrigger>
                                     <SelectContent>
                                       {spliceTechs.map(st => <SelectItem key={st.id} value={st.name}>{st.name}</SelectItem>)}
                                     </SelectContent>
                                   </Select>
                                 </div>
                                 {measureTechnicians.length > 1 && (
                                   <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeMeasureTechnician(idx)}><Trash2 size={14} className="text-destructive" /></Button>
                                 )}
                               </div>
                             ))}
                           </div>
                         )}
                       </div>

                       {/* Record Date */}
                       <div className="space-y-2">
                         <Label>{t.recordDate}</Label>
                         <Input type="date" value={measureDate} onChange={e => setMeasureDate(e.target.value)} />
                       </div>

                     </div>
                     <DialogFooter>
                       <Button onClick={handleAddMeasurement}>{t.submit}</Button>
                     </DialogFooter>
                   </DialogContent>
                 </Dialog>
               )}

               {canAddWorks && (
                 <Dialog open={isWorkDialogOpen} onOpenChange={(open) => { if (open) fetchMasterData(); setIsWorkDialogOpen(open); }}>
                   <DialogTrigger asChild>
                     <Button variant="outline" className="gap-2">
                       <Wrench size={16} /> {t.addWork}
                     </Button>
                   </DialogTrigger>
                   <DialogContent ref={workDialogRef} className="max-w-lg max-h-[90vh] overflow-y-auto">
                     <DialogHeader><DialogTitle>{t.addWork}</DialogTitle></DialogHeader>
                     <div className="space-y-4 py-4">
                       
                       <div className="space-y-2">
                         <Label>{t.worksBy}</Label>
                         <Select value={worksBy} onValueChange={(val: any) => setWorksBy(val)}>
                           <SelectTrigger><SelectValue /></SelectTrigger>
                           <SelectContent>
                             <SelectItem value="self">{t.selfEffort}</SelectItem>
                             <SelectItem value="contractor">{t.contractor}</SelectItem>
                           </SelectContent>
                         </Select>
                       </div>

                       {worksBy === 'contractor' && (
                         <div className="space-y-2">
                           <Label>{t.selectContractor}</Label>
                           <Select value={selectedContractor} onValueChange={setSelectedContractor}>
                             <SelectTrigger><SelectValue placeholder={t.selectContractor} /></SelectTrigger>
                             <SelectContent>
                               {contractors.map(c => (
                                 <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                               ))}
                             </SelectContent>
                           </Select>
                         </div>
                       )}

                       <div className="space-y-2 border p-2 rounded-md bg-secondary/10">
                         <Label className="flex justify-between items-center mb-2">
                           <span>Items</span>
                           <Button variant="ghost" size="sm" onClick={addWorkRow} className="h-6 text-xs bg-background border"><Plus size={12} /> Add Row</Button>
                         </Label>
                         {workItems.map((item, idx) => {
                           const selectedWorkType = workTypes.find(w => w.id === item.workTypeId);
                           const isExcavationWorker = selectedWorkType?.name?.includes('عامل حفر');
                           const isDiggingSearch = selectedWorkType?.name?.includes('حفر للبحث عن اعطال');
                           
                           return (
                             <div key={idx} className="space-y-2 mb-3 pb-2 border-b last:border-b-0">
                               <div className="flex gap-2 items-end">
                                 <div className="flex-1">
                                   <Select value={item.workTypeId} onValueChange={(val) => {
                                     const newWorkType = workTypes.find(w => w.id === val);
                                     const newItems = [...workItems];
                                     newItems[idx] = { 
                                       ...newItems[idx], 
                                       workTypeId: val,
                                       excavationWorkerId: newWorkType?.name?.includes('عامل حفر') ? newItems[idx].excavationWorkerId : undefined,
                                       excavationLength: newWorkType?.name?.includes('حفر للبحث عن اعطال') ? newItems[idx].excavationLength : undefined,
                                       excavationWidth: newWorkType?.name?.includes('حفر للبحث عن اعطال') ? newItems[idx].excavationWidth : undefined,
                                       excavationDepth: newWorkType?.name?.includes('حفر للبحث عن اعطال') ? newItems[idx].excavationDepth : undefined,
                                     };
                                    const newQuantity = newWorkType?.name?.includes('عامل حفر') ? 1 : newItems[idx].quantity;
                                    newItems[idx].quantity = newQuantity;
                                    setWorkItems(newItems);
                                    recalculatePendingMaterials(newItems);
                                   }}>
                                     <SelectTrigger><SelectValue placeholder={t.workType} /></SelectTrigger>
                                     <SelectContent>
                                       {workTypes.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                                     </SelectContent>
                                   </Select>
                                 </div>
                                 <div className={isDiggingSearch ? "w-28" : "w-20"}>
                                   {isDiggingSearch ? (
                                     <div className="flex items-center gap-1">
                                       <Input
                                         type="number"
                                         value={item.quantity}
                                         readOnly
                                         disabled
                                         className="bg-muted text-center font-mono text-xs"
                                         placeholder="م³"
                                       />
                                       <span className="text-xs text-muted-foreground whitespace-nowrap">م³</span>
                                     </div>
                                   ) : (
                                     <Input type="number" value={isExcavationWorker ? 1 : item.quantity} onChange={(e) => {
                                       const newQty = Number(e.target.value);
                                       updateWorkRow(idx, 'quantity', newQty);
                                       const updatedItems = [...workItems];
                                       updatedItems[idx] = {...updatedItems[idx], quantity: newQty};
                                       recalculatePendingMaterials(updatedItems);
                                     }} placeholder="Qty" disabled={isExcavationWorker} className={isExcavationWorker ? "bg-muted" : ""} />
                                   )}
                                 </div>
                                 {workItems.length > 1 && (
                                   <Button variant="ghost" size="icon" onClick={() => removeWorkRow(idx)}><Trash2 size={16} className="text-destructive" /></Button>
                                 )}
                               </div>
                               {isExcavationWorker && (
                                 <div className="mr-4">
                                   <Label className="text-xs text-muted-foreground mb-1">اسم عامل الحفر</Label>
                                   <Select value={item.excavationWorkerId || ''} onValueChange={(val) => updateWorkRow(idx, 'excavationWorkerId', val)}>
                                     <SelectTrigger><SelectValue placeholder="اختر عامل الحفر" /></SelectTrigger>
                                     <SelectContent>
                                       {excavationWorkers.map(w => <SelectItem key={w.id} value={w.id}>{w.name} - {w.nationalId}</SelectItem>)}
                                     </SelectContent>
                                   </Select>
                                 </div>
                               )}
                               {isDiggingSearch && (
                                 <div className="mr-4 space-y-2">
                                   <div className="grid grid-cols-3 gap-2">
                                     <div>
                                       <Label className="text-xs text-muted-foreground mb-1">الطول (سم)</Label>
                                       <Input
                                         type="number"
                                         step="0.01"
                                         placeholder="الطول"
                                         value={item.excavationLength ?? ''}
                                         onChange={(e) => {
                                           const newItems = [...workItems];
                                           const L = e.target.value ? Number(e.target.value) : undefined;
                                           const W = newItems[idx].excavationWidth;
                                           const D = newItems[idx].excavationDepth;
                                           const qty = L != null && W != null && D != null ? parseFloat(((L * W * D) / 1_000_000).toFixed(6)) : newItems[idx].quantity;
                                           newItems[idx] = {...newItems[idx], excavationLength: L, quantity: qty};
                                           setWorkItems(newItems);
                                           recalculatePendingMaterials(newItems);
                                         }}
                                       />
                                     </div>
                                     <div>
                                       <Label className="text-xs text-muted-foreground mb-1">العرض (سم)</Label>
                                       <Input
                                         type="number"
                                         step="0.01"
                                         placeholder="العرض"
                                         value={item.excavationWidth ?? ''}
                                         onChange={(e) => {
                                           const newItems = [...workItems];
                                           const W = e.target.value ? Number(e.target.value) : undefined;
                                           const L = newItems[idx].excavationLength;
                                           const D = newItems[idx].excavationDepth;
                                           const qty = L != null && W != null && D != null ? parseFloat(((L * W * D) / 1_000_000).toFixed(6)) : newItems[idx].quantity;
                                           newItems[idx] = {...newItems[idx], excavationWidth: W, quantity: qty};
                                           setWorkItems(newItems);
                                           recalculatePendingMaterials(newItems);
                                         }}
                                       />
                                     </div>
                                     <div>
                                       <Label className="text-xs text-muted-foreground mb-1">العمق (سم)</Label>
                                       <Input
                                         type="number"
                                         step="0.01"
                                         placeholder="العمق"
                                         value={item.excavationDepth ?? ''}
                                         onChange={(e) => {
                                           const newItems = [...workItems];
                                           const D = e.target.value ? Number(e.target.value) : undefined;
                                           const L = newItems[idx].excavationLength;
                                           const W = newItems[idx].excavationWidth;
                                           const qty = L != null && W != null && D != null ? parseFloat(((L * W * D) / 1_000_000).toFixed(6)) : newItems[idx].quantity;
                                           newItems[idx] = {...newItems[idx], excavationDepth: D, quantity: qty};
                                           setWorkItems(newItems);
                                           recalculatePendingMaterials(newItems);
                                         }}
                                       />
                                     </div>
                                   </div>
                                   {item.excavationLength != null && item.excavationWidth != null && item.excavationDepth != null && (
                                     <div className="text-xs font-medium text-primary bg-primary/10 rounded px-2 py-1">
                                       الحجم: {((item.excavationLength * item.excavationWidth * item.excavationDepth) / 1_000_000).toFixed(6)} م³
                                     </div>
                                   )}
                                 </div>
                               )}
                             </div>
                           );
                         })}
                         <div ref={workDialogEndRef} />
                       </div>

                       {worksBy === 'self' && (
                         <div className="space-y-2">
                           <Label className="flex justify-between items-center">
                             <span>{t.technician}</span>
                             {!isSpliceTech && (
                               <Button variant="ghost" size="sm" onClick={addWorkTechnician} className="h-6 text-xs bg-background border"><Plus size={12} /> إضافة فني آخر</Button>
                             )}
                           </Label>
                           {isSpliceTech ? (
                             <Input value={user.name} disabled className="bg-muted text-muted-foreground" />
                           ) : (
                             <div className="space-y-2">
                               {workTechnicians.map((techName, idx) => (
                                 <div key={idx} className="flex gap-2 items-center">
                                   <div className="flex-1">
                                     <Select value={techName} onValueChange={(val) => updateWorkTechnician(idx, val)}>
                                       <SelectTrigger><SelectValue placeholder={t.selectTechnician} /></SelectTrigger>
                                       <SelectContent>
                                         {spliceTechs.map(st => <SelectItem key={st.id} value={st.name}>{st.name}</SelectItem>)}
                                       </SelectContent>
                                     </Select>
                                   </div>
                                   {workTechnicians.length > 1 && (
                                     <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeWorkTechnician(idx)}><Trash2 size={14} className="text-destructive" /></Button>
                                   )}
                                 </div>
                               ))}
                             </div>
                           )}
                         </div>
                       )}

                       <div className="space-y-2">
                         <Label>{t.notes}</Label>
                         <Textarea value={workNotes} onChange={e => setWorkNotes(e.target.value)} />
                       </div>

                       {/* Record Date */}
                       <div className="space-y-2">
                         <Label>{t.recordDate}</Label>
                         <Input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} />
                       </div>

                       {/* Pending Materials Section - auto-loaded, user-editable */}
                       <div className="space-y-2 border p-3 rounded-md bg-secondary/10">
                         <Label className="flex justify-between items-center mb-2">
                           <span>المهمات المرتبطة ({pendingMaterials.length})</span>
                           <Button variant="ghost" size="sm" onClick={() => setPendingMaterials([...pendingMaterials, {id: Math.random().toString(36).substr(2,9), taskTypeId: '', quantity: 1, isAuto: false}])} className="h-6 text-xs bg-background border"><Plus size={12} /> إضافة</Button>
                         </Label>
                         {pendingMaterials.length === 0 ? (
                           <p className="text-xs text-muted-foreground text-center py-2">لا توجد مهمات مرتبطة - اختر نوع عمل لتحميل المهمات تلقائياً</p>
                         ) : (
                           pendingMaterials.map((mat, idx) => (
                             <div key={mat.id} className="flex gap-2 items-center">
                               <div className="flex-1">
                                 <Select value={mat.taskTypeId} onValueChange={(val) => {
                                   // Check if this taskTypeId already exists in another row
                                   const duplicateIdx = pendingMaterials.findIndex((m, i) => i !== idx && m.taskTypeId === val);
                                   if (duplicateIdx >= 0) {
                                     // Merge: add quantity to existing row and remove current row
                                     const newMats = [...pendingMaterials];
                                     newMats[duplicateIdx] = {...newMats[duplicateIdx], quantity: newMats[duplicateIdx].quantity + mat.quantity, isAuto: false};
                                     setPendingMaterials(newMats.filter((_, i) => i !== idx));
                                   } else {
                                     const newMats = [...pendingMaterials];
                                     newMats[idx] = {...newMats[idx], taskTypeId: val, isAuto: false};
                                     setPendingMaterials(newMats);
                                   }
                                 }}>
                                   <SelectTrigger className="h-8"><SelectValue placeholder="اختر المهمة" /></SelectTrigger>
                                   <SelectContent>
                                     {taskTypes.map(task => <SelectItem key={task.id} value={task.id}>{task.name}</SelectItem>)}
                                   </SelectContent>
                                 </Select>
                               </div>
                               <div className="w-20">
                                 <Input 
                                   type="number" 
                                   value={mat.quantity} 
                                   onChange={(e) => {
                                     const newMats = [...pendingMaterials];
                                     newMats[idx] = {...newMats[idx], quantity: Number(e.target.value) || 1, isAuto: false};
                                     setPendingMaterials(newMats);
                                   }} 
                                   placeholder="الكمية"
                                   className="h-8"
                                   min="1"
                                 />
                               </div>
                               <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPendingMaterials(pendingMaterials.filter((_, i) => i !== idx))}>
                                 <Trash2 size={14} className="text-destructive" />
                               </Button>
                             </div>
                           ))
                         )}
                       </div>
                     </div>
                     <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                       {pendingMaterials.some(m => !m.taskTypeId) && (
                         <p className="text-xs text-destructive w-full sm:w-auto">يرجى تحديد جميع المهمات أو حذف الصفوف الفارغة</p>
                       )}
                       <div className="flex gap-2">
                         <Button variant="outline" onClick={() => handleAddWork(false)}>تسجيل الأعمال فقط</Button>
                         <Button autoFocus onClick={() => handleAddWork(true)} disabled={pendingMaterials.length === 0 || pendingMaterials.some(m => !m.taskTypeId)}>
                           تسجيل الأعمال + المهمات ({pendingMaterials.filter(m => m.taskTypeId).length})
                         </Button>
                       </div>
                     </DialogFooter>
                   </DialogContent>
                 </Dialog>
               )}

               {canAddTasks && (
                 <Dialog open={isTaskDialogOpen} onOpenChange={(open) => { if (open) fetchMasterData(); setIsTaskDialogOpen(open); }}>
                   <DialogTrigger asChild>
                     <Button variant="outline" className="gap-2">
                       <ListChecks size={16} /> {t.addUsedTasks}
                     </Button>
                   </DialogTrigger>
                   <DialogContent ref={taskDialogRef} className="max-w-lg max-h-[90vh] overflow-y-auto">
                     <DialogHeader><DialogTitle>{t.addUsedTasks}</DialogTitle></DialogHeader>
                     <div className="space-y-4 py-4">
                        <div className="space-y-2 max-h-[300px] overflow-auto">
                         <Label className="flex justify-between items-center">
                           <span>Items</span>
                           <Button variant="ghost" size="sm" onClick={addTaskRow} className="h-6 text-xs"><Plus size={12} /> Add Row</Button>
                         </Label>
                         {taskItems.map((item, idx) => (
                           <div key={idx} className="flex gap-2 items-end">
                             <div className="flex-1">
                               <Select value={item.taskTypeId} onValueChange={(val) => updateTaskRow(idx, 'taskTypeId', val)}>
                                 <SelectTrigger><SelectValue placeholder={t.taskType} /></SelectTrigger>
                                 <SelectContent>
                                   {taskTypes.map(task => <SelectItem key={task.id} value={task.id}>{task.name}</SelectItem>)}
                                 </SelectContent>
                               </Select>
                             </div>
                             <div className="w-20">
                               <Input type="number" value={item.quantity} onChange={(e) => updateTaskRow(idx, 'quantity', Number(e.target.value))} placeholder="Qty" />
                             </div>
                             {taskItems.length > 1 && (
                               <Button variant="ghost" size="icon" onClick={() => removeTaskRow(idx)}><Trash2 size={16} className="text-destructive" /></Button>
                             )}
                           </div>
                         ))}
                         <div ref={taskDialogEndRef} />
                       </div>

                       <div className="space-y-2">
                         <Label>{t.technician}</Label>
                         {isSpliceTech ? (
                           <Input value={user.name} disabled className="bg-muted text-muted-foreground" />
                         ) : (
                           <Select value={taskTechnician} onValueChange={setTaskTechnician}>
                             <SelectTrigger><SelectValue placeholder={t.selectTechnician} /></SelectTrigger>
                             <SelectContent>
                               {spliceTechs.map(tech => <SelectItem key={tech.id} value={tech.name}>{tech.name}</SelectItem>)}
                             </SelectContent>
                           </Select>
                         )}
                       </div>

                       <div className="space-y-2">
                         <Label>{t.notes}</Label>
                         <Textarea value={taskNotes} onChange={e => setTaskNotes(e.target.value)} />
                       </div>

                       {/* Record Date */}
                       <div className="space-y-2">
                         <Label>{t.recordDate}</Label>
                         <Input type="date" value={taskDate} onChange={e => setTaskDate(e.target.value)} />
                       </div>
                     </div>
                     <DialogFooter>
                       <Button onClick={handleAddUsedTasks}>{t.submit}</Button>
                     </DialogFooter>
                   </DialogContent>
                 </Dialog>
               )}

               {canCloseFinalRepair && (
                 <Dialog open={isRepairDialogOpen} onOpenChange={setIsRepairDialogOpen}>
                   <DialogTrigger asChild>
                     <Button className="gap-2 bg-primary">
                       <CheckCircle size={16} /> {t.finalRepair}
                     </Button>
                   </DialogTrigger>
                   <DialogContent>
                     <DialogHeader><DialogTitle>{t.finalRepair}</DialogTitle></DialogHeader>
                     <div className="space-y-4 py-4">
                       <div className="space-y-2">
                         <Label>Repair Description (Optional)</Label>
                         <Textarea 
                            value={repairDesc} 
                            onChange={e => setRepairDesc(e.target.value)} 
                            placeholder="Describe the final repair action..."
                            className="min-h-[100px]"
                         />
                       </div>
                       <div className="bg-yellow-50 p-3 rounded-md border border-yellow-200 text-sm text-yellow-800 flex gap-2">
                         <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                         Ticket will be moved to "Pending Confirmation" state.
                       </div>
                     </div>
                     <DialogFooter>
                       <Button onClick={handleFinalRepair}>{t.submit}</Button>
                     </DialogFooter>
                   </DialogContent>
                 </Dialog>
               )}
             </>
           )}

           {ticket.status === 'pending_confirmation' && canConfirmRegularity && (
             <>
               <Button className="bg-green-600 hover:bg-green-700 gap-2" onClick={handleConfirmRepair}>
                 <CheckCircle size={16} /> {t.confirmRepair}
               </Button>
               <Button variant="destructive" className="gap-2" onClick={handleRevertRepair}>
                 <AlertTriangle size={16} /> {language === 'ar' ? 'لم يتم تأكيد الانتظام' : 'Reject Repair'}
               </Button>
             </>
           )}

           {/* Delete Ticket Button - Only for admin/external_affairs when no entries */}
           {canDeleteTicket && !ticketHasEntries && ticket.status !== 'closed' && (
             <Button variant="destructive" className="gap-2" onClick={handleDeleteTicket}>
               <Trash2 size={16} /> {t.deleteTicket}
             </Button>
           )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Final Repair Status Card */}
          {ticket.finalRepairId && (
             <Card className="border-green-200 bg-green-50/50">
               <CardHeader className="pb-2">
                 <CardTitle className="text-base text-green-800 flex items-center gap-2">
                   <CheckCircle size={18} /> Final Repair Recorded
                 </CardTitle>
               </CardHeader>
               <CardContent>
                 <p className="text-green-900 font-medium">{ticket.finalRepairDescription || 'No details provided'}</p>
                 <div className="text-xs text-green-700 mt-2 flex gap-4">
                   {ticket.finalRepairRepairedBy && <span>By: {users.find(u => u.id === ticket.finalRepairRepairedBy)?.name || 'Unknown'}</span>}
                   {ticket.finalRepairRepairedAt && <span>At: {new Date(ticket.finalRepairRepairedAt).toLocaleString()}</span>}
                 </div>
               </CardContent>
             </Card>
          )}

          {/* Measurements Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Ruler size={20} className="text-primary" /> Measurements
            </h3>
            {(!ticket.measurements || ticket.measurements.length === 0) ? (
              <div className="text-center p-8 border rounded-lg border-dashed text-muted-foreground bg-secondary/10">
                No measurements recorded.
              </div>
            ) : (
              ticket.measurements.map(m => (
                <Card key={m.id}>
                  <CardHeader className="py-3 bg-secondary/20 border-b flex flex-row items-center justify-between">
                     <div className="font-mono font-bold text-primary">{m.reading}</div>
                     <div className="text-sm text-muted-foreground flex gap-3">
                       <span className="font-bold text-primary">{m.distance}m</span>
                       {m.direction && <Badge variant="outline">{m.direction === 'cable' ? t.fromCable : t.fromCabinet}</Badge>}
                     </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                     <div className="flex justify-between items-center mb-2">
                       <span className="font-bold text-primary text-sm flex items-center gap-2">
                         <User size={12} /> {m.performedBy}
                       </span>
                       <div className="flex items-center gap-2">
                         <span className="text-xs text-muted-foreground">{new Date(m.recordedAt).toLocaleDateString()}</span>
                         {canDeleteEntries && (
                           <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteMeasurement(m.id)}>
                             <Trash2 size={14} />
                           </Button>
                         )}
                       </div>
                     </div>
                     {m.notes && <p className="text-sm text-muted-foreground">{m.notes}</p>}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <Separator />

          {/* Independent Works Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Wrench size={20} className="text-primary" /> Recorded Works
            </h3>
            {(!ticket.works || ticket.works.length === 0) ? (
              <div className="text-center p-8 border rounded-lg border-dashed text-muted-foreground bg-secondary/10">
                No works recorded.
              </div>
            ) : (
              ticket.works.map(w => (
                 <Card key={w.id} className="overflow-hidden">
                   <div className="flex border-l-4 border-primary">
                     <div className="p-4 flex-1">
                        <div className="flex justify-between mb-2">
                           <span className="font-bold text-primary text-sm flex items-center gap-2">
                             <User size={12} /> {w.worksBy === 'contractor' ? `${t.contractor}: ${contractors.find(c => c.id === w.contractorId)?.name || 'Unknown'}` : w.performedBy}
                           </span>
                           <div className="flex items-center gap-2">
                             <span className="text-xs text-muted-foreground">{new Date(w.recordedAt).toLocaleDateString()}</span>
                             {canDeleteEntries && (
                               <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteWork(w.id)}>
                                 <Trash2 size={14} />
                               </Button>
                             )}
                           </div>
                        </div>
                        <ul className="list-disc pl-4 space-y-1 mb-2">
                          {w.items.map((item, idx) => {
                             const wt = workTypes.find(wt => wt.id === item.workTypeId);
                             const hasExcavationDims = item.excavationLength != null || item.excavationWidth != null || item.excavationDepth != null;
                             const isDigging = wt?.name?.includes('حفر للبحث عن اعطال');
                             const excavationWorker = item.excavationWorkerId ? excavationWorkers.find(w2 => w2.id === item.excavationWorkerId) : null;
                             return (
                               <li key={idx} className="text-sm">
                                 {wt?.name} <span className="text-muted-foreground text-xs">{isDigging ? `(${item.quantity} م³)` : `(x${item.quantity})`}</span>
                                 {excavationWorker && (
                                   <span className="text-xs font-medium mr-2">— {excavationWorker.name} ({excavationWorker.nationalId})</span>
                                 )}
                                 {item.excavationWorkerId && !excavationWorker && (
                                   <span className="text-xs text-destructive mr-2">— عامل غير موجود</span>
                                 )}
                                 {hasExcavationDims && (
                                   <span className="text-xs text-muted-foreground mr-2">
                                     — {item.excavationLength != null ? `طول: ${item.excavationLength}سم` : ''}{item.excavationWidth != null ? ` عرض: ${item.excavationWidth}سم` : ''}{item.excavationDepth != null ? ` عمق: ${item.excavationDepth}سم` : ''}
                                   </span>
                                 )}
                               </li>
                             );
                          })}
                        </ul>
                        {w.notes && <p className="text-sm text-muted-foreground italic border-t pt-2">{w.notes}</p>}
                     </div>
                   </div>
                 </Card>
              ))
            )}
          </div>

          <Separator />

          {/* Used Tasks Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <ListChecks size={20} className="text-primary" /> Used Tasks
            </h3>
            {(!ticket.usedTasks || ticket.usedTasks.length === 0) ? (
              <div className="text-center p-8 border rounded-lg border-dashed text-muted-foreground bg-secondary/10">
                No tasks used.
              </div>
            ) : (
              ticket.usedTasks.map(ut => (
                 <Card key={ut.id} className="overflow-hidden">
                   <div className="flex border-l-4 border-orange-500">
                     <div className="p-4 flex-1">
                        <div className="flex justify-between mb-2">
                           <span className="font-bold text-primary text-sm flex items-center gap-2"><User size={12} /> {ut.performedBy}</span>
                           <div className="flex items-center gap-2">
                             <span className="text-xs text-muted-foreground">{new Date(ut.recordedAt).toLocaleDateString()}</span>
                             {canDeleteEntries && (
                               <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteTask(ut.id)}>
                                 <Trash2 size={14} />
                               </Button>
                             )}
                           </div>
                        </div>
                        <ul className="list-disc pl-4 space-y-1 mb-2">
                          {ut.items.map((item, idx) => {
                             const tt = taskTypes.find(type => type.id === item.taskTypeId);
                             return <li key={idx} className="text-sm">{tt?.name} <span className="text-muted-foreground text-xs">(x{item.quantity})</span></li>;
                          })}
                        </ul>
                        {ut.notes && <p className="text-sm text-muted-foreground italic border-t pt-2">{ut.notes}</p>}
                     </div>
                   </div>
                 </Card>
              ))
            )}
          </div>

        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
           <Card className="shadow-sm">
              <CardHeader className="pb-3 border-b bg-secondary/10">
                 <CardTitle className="text-base flex items-center gap-2">
                   <Server size={16} /> Technical Info
                 </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                 <div>
                    <label className="text-xs uppercase text-muted-foreground font-semibold">Central</label>
                    <p className="font-medium">{central?.name}</p>
                 </div>
                 <div>
                    <label className="text-xs uppercase text-muted-foreground font-semibold">Cable</label>
                    <div className="flex items-center gap-2">
                      <Cable size={14} /> <span className="font-mono">{cable?.number}</span>
                      <Badge variant="outline" className="text-[10px] h-5">{cable?.type}</Badge>
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs uppercase text-muted-foreground font-semibold">Cabinet</label>
                      <p className="font-mono font-bold">{ticket.cabinet}</p>
                    </div>
                    <div>
                      <label className="text-xs uppercase text-muted-foreground font-semibold">Box</label>
                      <p className="font-mono font-bold">{ticket.box}</p>
                    </div>
                 </div>
                 <Separator />
                 <div>
                    <label className="text-xs uppercase text-muted-foreground font-semibold">Fault</label>
                    <div className="flex items-center gap-2 text-sm font-medium text-orange-600">
                      <Activity size={14} /> {fault?.name}
                    </div>
                 </div>
                 {ticket.notes && (
                   <>
                     <Separator />
                     <div>
                        <label className="text-xs uppercase text-muted-foreground font-semibold">{t.notes}</label>
                        <p className="text-sm mt-1 bg-muted/50 p-2 rounded-md">{ticket.notes}</p>
                     </div>
                   </>
                 )}
              </CardContent>
           </Card>

           <Card className="shadow-sm">
              <CardHeader className="pb-3 border-b bg-secondary/10">
                 <CardTitle className="text-base flex items-center gap-2">
                   <MapPin size={16} /> Location
                 </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                 {ticket.latitude && ticket.longitude ? (
                    <div className="space-y-3">
                       <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <div className="p-2 bg-muted rounded text-center">
                             {ticket.latitude.toFixed(6)}
                          </div>
                          <div className="p-2 bg-muted rounded text-center">
                             {ticket.longitude.toFixed(6)}
                          </div>
                       </div>
                       <Button variant="outline" className="w-full text-xs" onClick={() => window.open(`https://maps.google.com/?q=${ticket.latitude},${ticket.longitude}`, '_blank')}>
                          Open in Maps
                       </Button>
                    </div>
                 ) : (
                    <div className="text-sm text-muted-foreground text-center">
                       No GPS data
                    </div>
                 )}
              </CardContent>
           </Card>
        </div>
      </div>
    </div>
  );
}

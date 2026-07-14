import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { masterDataApi, inventoryApi, type TaskType, type InventoryTransaction } from "@/cfm/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/cfm/components/ui/card";
import { Button } from "@/cfm/components/ui/button";
import { Input } from "@/cfm/components/ui/input";
import { Label } from "@/cfm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/cfm/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/cfm/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/cfm/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/cfm/components/ui/tabs";
import { Package, Plus, AlertCircle, FileSpreadsheet } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/cfm/hooks/use-toast";
import ExcelJS from 'exceljs';

export default function Inventory() {
  const { language, user, tickets } = useStore();
  const t = translations[language];
  const { toast } = useToast();
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [activeTab, setActiveTab] = useState("balance");
  
  // API-fetched data
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [inventoryTransactions, setInventoryTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch data from API
  const fetchData = useCallback(async () => {
    try {
      const [taskTypesData, transactionsData] = await Promise.all([
        masterDataApi.getTaskTypes(),
        inventoryApi.getTransactions()
      ]);
      setTaskTypes([...taskTypesData].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
      setInventoryTransactions(transactionsData);
    } catch (error) {
      console.error("Failed to fetch inventory data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount and on window focus
  useEffect(() => {
    fetchData();
    
    const handleFocus = () => fetchData();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchData]);

  // Refresh when dialog opens
  useEffect(() => {
    if (isAddDialogOpen) {
      fetchData();
    }
  }, [isAddDialogOpen, fetchData]);

  // Permissions: Admin can edit, Engineer/Supervisor can view
  const canEdit = user?.role === 'admin' || user?.role === 'cable_engineer';
  const canView = user?.role === 'admin' || user?.role === 'cable_engineer' || user?.role === 'supervisor';

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-muted-foreground">Access Denied</h2>
        <p>You do not have permission to view inventory.</p>
      </div>
    );
  }

  const handleAddIncoming = async () => {
    if (!selectedTaskType || !quantity) return;
    
    try {
      await inventoryApi.addIncoming({
        taskTypeId: selectedTaskType,
        quantity: Number(quantity),
        date: new Date(date).toISOString()
      });
      
      await fetchData(); // Refresh transactions list
      setIsAddDialogOpen(false);
      setSelectedTaskType("");
      setQuantity("");
      toast({ title: "Transaction Added", description: "Incoming inventory recorded." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to add transaction" });
    }
  };

  // Calculate Balances
  const balanceData = taskTypes.map(task => {
    const transactions = inventoryTransactions.filter(tx => tx.taskTypeId === task.id);
    const incoming = transactions.filter(tx => tx.type === 'incoming').reduce((sum, tx) => sum + tx.quantity, 0);
    const outgoing = transactions.filter(tx => tx.type === 'outgoing').reduce((sum, tx) => sum + tx.quantity, 0);
    return {
      ...task,
      incoming,
      outgoing,
      balance: incoming - outgoing
    };
  });

  const incomingTransactions = inventoryTransactions.filter(tx => tx.type === 'incoming');
  const outgoingTransactions = inventoryTransactions.filter(tx => tx.type === 'outgoing');

  const exportToExcel = async () => {
    let data: any[] = [];
    let sheetName = "Report";

    if (activeTab === "balance") {
      sheetName = "Current Balance";
      data = balanceData.map(item => ({
        "Task Name": item.name,
        "Incoming": item.incoming,
        "Outgoing": item.outgoing,
        "Balance": item.balance
      }));
    } else if (activeTab === "incoming") {
      sheetName = "Incoming Report";
      data = incomingTransactions.map(tx => ({
        "Date": new Date(tx.date).toLocaleDateString(),
        "Task Name": taskTypes.find(t => t.id === tx.taskTypeId)?.name || 'Unknown',
        "Quantity": tx.quantity
      }));
    } else if (activeTab === "outgoing") {
      sheetName = "Outgoing Report";
      data = outgoingTransactions.map(tx => {
        const ticket = tickets.find(t => t.id === tx.ticketId);
        return {
          "Date": new Date(tx.date).toLocaleDateString(),
          "Ticket #": ticket?.ticketNumber || 'Deleted',
          "Task Name": taskTypes.find(t => t.id === tx.taskTypeId)?.name || 'Unknown',
          "Quantity": tx.quantity
        };
      });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);
    
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
    link.download = `inventory_${activeTab}_export.xlsx`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
             <Package className="text-primary" /> {t.inventory}
          </h1>
          <p className="text-sm text-muted-foreground">Manage material transactions and balance</p>
        </div>
        
        <div className="flex gap-2">
           <Button variant="outline" onClick={exportToExcel} className="gap-2">
              <FileSpreadsheet size={16} /> {t.exportExcel}
           </Button>

           {canEdit && (
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus size={16} /> {t.addIncoming}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.addIncoming}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>{t.taskType}</Label>
                    <Select value={selectedTaskType} onValueChange={setSelectedTaskType}>
                      <SelectTrigger><SelectValue placeholder={t.taskType} /></SelectTrigger>
                      <SelectContent>
                        {taskTypes.map(task => (
                          <SelectItem key={task.id} value={task.id}>{task.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t.quantity}</Label>
                    <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleAddIncoming}>{t.submit}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Tabs defaultValue="balance" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 bg-secondary/50">
          <TabsTrigger value="balance">{t.currentBalance}</TabsTrigger>
          <TabsTrigger value="incoming">{t.incomingReport}</TabsTrigger>
          <TabsTrigger value="outgoing">{t.outgoingReport}</TabsTrigger>
        </TabsList>


        <TabsContent value="balance">
          <Card>
            <CardHeader>
              <CardTitle>Current Balance Report</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task Name</TableHead>
                    <TableHead>Incoming</TableHead>
                    <TableHead>Outgoing</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balanceData.map((item) => (
                    <TableRow key={item.id} className={item.balance < 10 ? "bg-red-50/20" : ""}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-green-600">+{item.incoming}</TableCell>
                      <TableCell className="text-red-600">-{item.outgoing}</TableCell>
                      <TableCell className={`text-right font-mono font-bold ${item.balance < 10 ? 'text-red-600' : ''}`}>
                        {item.balance}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incoming">
          <Card>
            <CardHeader>
              <CardTitle>Incoming Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Task Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incomingTransactions.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No records.</TableCell></TableRow>
                  ) : (
                    incomingTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-muted-foreground text-sm">{new Date(tx.date).toLocaleDateString()}</TableCell>
                        <TableCell>{taskTypes.find(t => t.id === tx.taskTypeId)?.name || 'Unknown'}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">+{tx.quantity}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outgoing">
          <Card>
            <CardHeader>
              <CardTitle>Outgoing Transactions (From Tickets)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Ticket #</TableHead>
                    <TableHead>Task Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outgoingTransactions.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No records.</TableCell></TableRow>
                  ) : (
                    outgoingTransactions.map((tx) => {
                      const ticket = tickets.find(t => t.id === tx.ticketId);
                      return (
                        <TableRow key={tx.id}>
                          <TableCell className="text-muted-foreground text-sm">{new Date(tx.date).toLocaleDateString()}</TableCell>
                          <TableCell className="font-mono text-xs">{ticket?.ticketNumber || 'Deleted'}</TableCell>
                          <TableCell>{taskTypes.find(t => t.id === tx.taskTypeId)?.name || 'Unknown'}</TableCell>
                          <TableCell className="text-right font-mono text-red-600">-{tx.quantity}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

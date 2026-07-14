import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { masterDataApi } from "@/cfm/lib/api";
import type { Central, Cable, FaultType, WorkType, TaskType, Contractor, ExcavationWorker } from "@/cfm/lib/api";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/cfm/components/ui/card";
import { Button } from "@/cfm/components/ui/button";
import { Input } from "@/cfm/components/ui/input";
import { Label } from "@/cfm/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/cfm/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/cfm/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/cfm/components/ui/select";
import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/cfm/hooks/use-toast";
import { Database, Upload, AlertCircle, Download, Plus, Trash2, Edit2, Check, X, Loader2 } from "lucide-react";
import ExcelJS from 'exceljs';

const DataSection = ({ title, type, items, columns, renderManualForm, manualEntry, setManualEntry, handleManualAdd, downloadTemplate, handleFileUpload, fileInputRef, t, centrals, handleDelete, handleUpdate, loading, taskTypes }: any) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  const startEdit = (item: any) => {
    setEditingId(item.id);
    setEditValues({ ...item });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const saveEdit = () => {
    if (editingId) {
      handleUpdate(type, editingId, editValues);
      setEditingId(null);
      setEditValues({});
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {loading ? "Loading..." : `${items.length} records found`}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadTemplate(type)} className="gap-2">
            <Download size={14} /> {t.downloadTemplate}
          </Button>
          <div className="relative">
            <input 
              type="file" 
              accept=".xlsx, .xls" 
              className="absolute inset-0 opacity-0 cursor-pointer" 
              onChange={handleFileUpload}
              ref={fileInputRef}
            />
            <Button size="sm" className="gap-2">
              <Upload size={14} /> {t.uploadFile}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        
        <div className="bg-secondary/20 p-4 rounded-md space-y-4">
          <h4 className="text-sm font-semibold">Add New Record</h4>
          <div className="flex flex-wrap gap-4 items-end">
            {renderManualForm(manualEntry, setManualEntry)}
            <Button onClick={() => handleManualAdd(type)} size="sm" className="gap-2">
              <Plus size={14} /> Add
            </Button>
          </div>
        </div>

        <div className="rounded-md border max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col: string) => <TableHead key={col}>{col}</TableHead>)}
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} className="text-center h-24">
                    <Loader2 className="animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} className="text-center h-24 text-muted-foreground">
                    No data available
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item: any, i: number) => {
                  const isEditing = editingId === item.id;
                  
                  return (
                    <TableRow key={item.id || i}>
                      {columns.map((col: string) => {
                        const key = col.toLowerCase();
                        let val = item[key];
                        if (col === 'Central') {
                           const c = centrals.find((c:any) => c.id === item.centralId);
                           val = c ? c.name : item.centralId;
                        }
                        if (col === 'Type') val = item.type;
                        if (col === 'Category') val = item.category;
                        if (col === 'Code') val = item.code;
                        if (col === 'Number') val = item.number;
                        if (col === 'Name') val = item.name;
                        if (col === 'الاسم') val = item.name;
                        if (col === 'الرقم القومي') val = item.nationalId;
                        if (col === 'رقم الكابل') val = item.cableNumber || '';
                        if (col === 'رقم الكابينه') val = item.cabinetNumber || '';
                        if (col === 'Associated Materials') {
                          const mats = item.associatedMaterials || [];
                          if (mats.length === 0) {
                            val = '-';
                          } else {
                            val = mats.map((m: any) => {
                              const task = taskTypes?.find((t: any) => t.id === m.taskTypeId);
                              return `${task?.name || m.taskTypeId} (${m.defaultQuantity})`;
                            }).join(', ');
                          }
                        }

                        if (isEditing) {
                          if (col === 'Central') return <TableCell key={col} className="text-muted-foreground italic">Cannot Change</TableCell>;
                          if (col === 'Associated Materials') {
                            const currentMats = editValues.associatedMaterials || [];
                            return (
                              <TableCell key={col} className="min-w-[200px]">
                                <div className="space-y-1">
                                  {currentMats.map((mat: any, idx: number) => (
                                    <div key={idx} className="flex gap-1 items-center">
                                      <Select 
                                        value={mat.taskTypeId} 
                                        onValueChange={(val) => {
                                          const updated = [...currentMats];
                                          updated[idx] = { ...updated[idx], taskTypeId: val };
                                          setEditValues({...editValues, associatedMaterials: updated});
                                        }}
                                      >
                                        <SelectTrigger className="h-7 text-xs flex-1">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {taskTypes?.map((tt: any) => (
                                            <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <Input
                                        type="number"
                                        value={mat.defaultQuantity}
                                        onChange={(e) => {
                                          const updated = [...currentMats];
                                          updated[idx] = { ...updated[idx], defaultQuantity: Number(e.target.value) };
                                          setEditValues({...editValues, associatedMaterials: updated});
                                        }}
                                        className="h-7 w-14 text-xs"
                                        min="1"
                                      />
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-6 w-6 text-destructive"
                                        onClick={() => {
                                          const updated = currentMats.filter((_: any, i: number) => i !== idx);
                                          setEditValues({...editValues, associatedMaterials: updated});
                                        }}
                                      >
                                        <Trash2 size={10} />
                                      </Button>
                                    </div>
                                  ))}
                                  <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="h-6 text-xs w-full"
                                    onClick={() => {
                                      const updated = [...currentMats, { taskTypeId: '', defaultQuantity: 1 }];
                                      setEditValues({...editValues, associatedMaterials: updated});
                                    }}
                                  >
                                    <Plus size={10} /> Add
                                  </Button>
                                </div>
                              </TableCell>
                            );
                          }
                          
                          let editKey = key;
                          if (col === 'Number') editKey = 'number';
                          if (col === 'Code') editKey = 'code';
                          if (col === 'Name') editKey = 'name';
                          if (col === 'Type') editKey = 'type';
                          if (col === 'Category') editKey = 'category';
                          if (col === 'الاسم') editKey = 'name';
                          if (col === 'الرقم القومي') editKey = 'nationalId';
                          if (col === 'رقم الكابل') editKey = 'cableNumber';
                          if (col === 'رقم الكابينه') editKey = 'cabinetNumber';

                          return (
                             <TableCell key={col}>
                               <Input 
                                 value={editValues[editKey] || ''} 
                                 onChange={e => setEditValues({...editValues, [editKey]: e.target.value})}
                                 className="h-8"
                               />
                             </TableCell>
                          );
                        }

                        return <TableCell key={col}>{val}</TableCell>;
                      })}
                       <TableCell className="text-right">
                         {isEditing ? (
                           <div className="flex justify-end gap-2">
                             <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" onClick={saveEdit}>
                               <Check size={16} />
                             </Button>
                             <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={cancelEdit}>
                               <X size={16} />
                             </Button>
                           </div>
                         ) : (
                           <div className="flex justify-end gap-2">
                             <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(item)}>
                               <Edit2 size={16} />
                             </Button>
                             <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(type, item.id)}>
                               <Trash2 size={16} />
                             </Button>
                           </div>
                         )}
                       </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default function MasterData() {
  const { language, user, setUser } = useStore();
  const t = translations[language];
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState("centrals");
  const [manualEntry, setManualEntry] = useState<any>({});
  const [loading, setLoading] = useState(true);

  const [centrals, setCentrals] = useState<Central[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [faultTypes, setFaultTypes] = useState<FaultType[]>([]);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [excavationWorkers, setExcavationWorkers] = useState<ExcavationWorker[]>([]);

  const handleSessionExpired = useCallback(() => {
    setUser(null);
    toast({ variant: "destructive", title: "Session Expired", description: "Please log in again." });
    setLocation("/login");
  }, [setUser, toast, setLocation]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [centralsData, cablesData, faultTypesData, workTypesData, taskTypesData, contractorsData, excavationWorkersData] = await Promise.all([
        masterDataApi.getCentrals(),
        masterDataApi.getCables(),
        masterDataApi.getFaultTypes(),
        masterDataApi.getWorkTypes(),
        masterDataApi.getTaskTypes(),
        masterDataApi.getContractors(),
        masterDataApi.getExcavationWorkers(),
      ]);
      setCentrals(centralsData);
      setCables(cablesData);
      setFaultTypes(faultTypesData);
      setWorkTypes([...workTypesData].sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true })));
      setTaskTypes([...taskTypesData].sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true })));
      setContractors(contractorsData);
      setExcavationWorkers(excavationWorkersData);
    } catch (error: any) {
      console.error("Failed to fetch master data:", error);
      if (error.message === "Unauthorized" || error.message?.includes("401")) {
        handleSessionExpired();
        return;
      }
      toast({ variant: "destructive", title: "Error", description: "Failed to load master data from server." });
    } finally {
      setLoading(false);
    }
  }, [toast, handleSessionExpired]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-muted-foreground">Access Denied</h2>
        <p>Only Admins can access Master Data.</p>
      </div>
    );
  }

  const downloadTemplate = async (type: string) => {
    let data: any[] = [];
    
    if (type === 'centrals') {
      data = [{ name: "Example Central", code: "EX01" }];
    } else if (type === 'cables') {
      data = [{ centralCode: "EX01", number: "101", cableNumber: "C001", cabinetNumber: "CAB01", type: "copper" }];
    } else if (type === 'faults') {
      data = [{ name: "Example Fault", category: "cable" }];
    } else if (type === 'excavation-workers') {
      data = [{ name: "اسم العامل", nationalId: "29901234567890" }];
    } else if (type === 'works') {
      const taskNames = taskTypes.map((t: any) => t.name).join(', ');
      data = [{ 
        name: "نوع العمل", 
        associatedMaterials: "اسم المهمة:الكمية|اسم مهمة أخرى:الكمية" 
      }];
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Template");
      worksheet.columns = [
        { header: 'name', key: 'name', width: 20 },
        { header: 'associatedMaterials', key: 'associatedMaterials', width: 50 }
      ];
      worksheet.addRows(data);
      worksheet.getCell('C1').value = 'المهمات المتاحة:';
      worksheet.getCell('C2').value = taskNames || 'لا توجد مهمات';
      worksheet.getColumn('C').width = 40;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${type}_template.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      return;
    } else {
      data = [{ name: "Example Item" }];
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Template");
    
    if (data.length > 0) {
      worksheet.columns = Object.keys(data[0]).map(key => ({ header: key, key, width: 15 }));
      worksheet.addRows(data);
    }
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type}_template.xlsx`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);
      
      const worksheet = workbook.worksheets[0];
      const data: any[] = [];
      
      const normalizeCellValue = (cellValue: any, cell?: any): any => {
        if (cellValue === null || cellValue === undefined) return '';
        if (typeof cellValue === 'string') return cellValue;
        if (typeof cellValue === 'boolean') return cellValue;
        if (typeof cellValue === 'number') {
          if (cell?.numFmt && (cell.numFmt.includes('d') || cell.numFmt.includes('m') || cell.numFmt.includes('y') || cell.numFmt.includes('h') || cell.numFmt.includes('s'))) {
            const excelEpoch = new Date(1899, 11, 30);
            const days = Math.floor(cellValue);
            const milliseconds = Math.round((cellValue - days) * 86400 * 1000);
            return new Date(excelEpoch.getTime() + days * 86400000 + milliseconds);
          }
          return cellValue;
        }
        if (cellValue instanceof Date) return cellValue;
        if (typeof cellValue === 'object') {
          if ('richText' in cellValue && Array.isArray(cellValue.richText)) {
            return cellValue.richText.map((t: any) => t.text || '').join('');
          }
          if ('text' in cellValue && 'hyperlink' in cellValue) return cellValue.text;
          if ('result' in cellValue) return cellValue.result;
          if ('sharedFormula' in cellValue && 'result' in cellValue) return cellValue.result;
          if ('formula' in cellValue && 'result' in cellValue) return cellValue.result;
          if ('text' in cellValue) return cellValue.text;
        }
        return String(cellValue);
      };
      
      const headers: string[] = [];
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        const normalizedHeader = normalizeCellValue(cell.value, cell);
        headers[colNumber] = normalizedHeader ? String(normalizedHeader) : `Column${colNumber}`;
      });
      
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const rowData: any = {};
        let hasData = false;
        
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (headers[colNumber]) {
            const normalizedValue = normalizeCellValue(cell.value, cell);
            rowData[headers[colNumber]] = normalizedValue;
            if (normalizedValue !== '' && normalizedValue !== null && normalizedValue !== undefined) {
              hasData = true;
            }
          }
        });
        
        if (hasData) {
          data.push(rowData);
        }
      });
      
      await processImportData(activeTab, data);
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      console.error("Import Error:", error);
      toast({ variant: "destructive", title: "Import Failed", description: "Could not parse Excel file." });
    }
  };

  const processImportData = async (type: string, data: any[]) => {
    if (!data || data.length === 0) {
      toast({ variant: "destructive", title: "Empty File", description: "No records found in file." });
      return;
    }

    const validData: any[] = [];
    const errors: string[] = [];
    
    data.forEach((row: any, index: number) => {
      if (Object.keys(row).length === 0) return;

      if (type === 'centrals') {
        if (row.name) validData.push({ name: String(row.name).trim(), code: row.code ? String(row.code).trim() : 'UNK' });
      } else if (type === 'cables') {
        let centralId = '';
        if (row.centralCode) {
          const searchStr = String(row.centralCode).trim();
          const central = centrals.find(c => 
            String(c.code).trim().toLowerCase() === searchStr.toLowerCase() || 
            String(c.name).trim().toLowerCase() === searchStr.toLowerCase()
          );
          if (central) centralId = central.id;
        } else if (row.centralId) {
          centralId = row.centralId;
        }
        
        if (row.number && centralId) {
          const cableNumber = String(row.number).trim();
          const exists = cables.some(c => c.centralId === centralId && c.number === cableNumber);
          const duplicateInBatch = validData.some(d => d.centralId === centralId && d.number === cableNumber);
          
          if (exists || duplicateInBatch) {
            const centralName = centrals.find(c => c.id === centralId)?.name || centralId;
            errors.push(`Row ${index + 1}: Cable ${cableNumber} already exists in Central ${centralName}.`);
          } else {
             validData.push({ 
               centralId, 
               number: cableNumber, 
               cableNumber: row.cableNumber ? String(row.cableNumber).trim() : null,
               cabinetNumber: row.cabinetNumber ? String(row.cabinetNumber).trim() : null,
               type: (row.type === 'fiber' || row.type === 'copper') ? row.type : 'copper' 
             });
          }
        } else {
          if (row.number && !centralId) {
            errors.push(`Row ${index + 1}: Central code "${row.centralCode}" not found.`);
          }
        }
      } else if (type === 'faults') {
        if (row.name) {
          validData.push({ 
            name: row.name, 
            category: (['cable', 'equipment', 'civil'].includes(row.category)) ? row.category : 'cable' 
          });
        }
      } else if (type === 'works') {
        if (row.name) {
          let associatedMaterials: any[] = [];
          if (row.associatedMaterials && typeof row.associatedMaterials === 'string') {
            const matsStr = String(row.associatedMaterials).trim();
            if (matsStr) {
              const matPairs = matsStr.split('|');
              for (const pair of matPairs) {
                const [taskName, qtyStr] = pair.split(':').map(s => s.trim());
                if (taskName) {
                  const task = taskTypes.find((t: any) => 
                    t.name.toLowerCase() === taskName.toLowerCase() ||
                    t.name === taskName
                  );
                  if (task) {
                    associatedMaterials.push({
                      taskTypeId: task.id,
                      defaultQuantity: parseInt(qtyStr) || 1
                    });
                  } else {
                    errors.push(`Row ${index + 1}: Task "${taskName}" not found.`);
                  }
                }
              }
            }
          }
          validData.push({ name: String(row.name).trim(), associatedMaterials });
        }
      } else {
        if (row.name) validData.push({ name: row.name });
      }
    });

    if (errors.length > 0) {
       toast({ 
         variant: "destructive", 
         title: "Import Issues", 
         description: `${errors.length} issues. First: ${errors[0]}` 
       });
    }

    if (validData.length === 0) {
      if (errors.length === 0) {
         toast({ variant: "destructive", title: "Invalid Data", description: "No valid records found matching the template." });
      }
      return;
    }

    let successCount = 0;
    for (const item of validData) {
      try {
        if (type === 'centrals') {
          await masterDataApi.createCentral(item);
        } else if (type === 'cables') {
          await masterDataApi.createCable(item);
        } else if (type === 'faults') {
          await masterDataApi.createFaultType(item);
        } else if (type === 'works') {
          await masterDataApi.createWorkType(item);
        } else if (type === 'tasks') {
          await masterDataApi.createTaskType(item);
        } else if (type === 'contractors') {
          await masterDataApi.createContractor(item);
        }
        successCount++;
      } catch (error) {
        console.error("Failed to create item:", error);
      }
    }

    await fetchAllData();
    toast({ title: "Import Complete", description: `Imported ${successCount} of ${validData.length} records.` });
  };

  const handleManualAdd = async (type: string) => {
    if (!manualEntry.name && type !== 'cables') return;
    if (type === 'cables' && !manualEntry.number) return;

    try {
      if (type === 'centrals') {
        if (!manualEntry.name || !manualEntry.code) {
          toast({ variant: "destructive", title: "Missing Data", description: "Please enter name and code." });
          return;
        }
        await masterDataApi.createCentral({ name: manualEntry.name, code: manualEntry.code });
      } else if (type === 'cables') {
        let centralId = '';
        if (manualEntry.centralCode) {
          const central = centrals.find(c => 
            c.code === manualEntry.centralCode || 
            c.name === manualEntry.centralCode ||
            c.code.toLowerCase() === manualEntry.centralCode.toLowerCase() ||
            c.name.toLowerCase() === manualEntry.centralCode.toLowerCase()
          );
          if (central) centralId = central.id;
        }
        
        if (!centralId) {
          toast({ 
            variant: "destructive", 
            title: "Central Not Found", 
            description: `Central with code "${manualEntry.centralCode}" not found. Available codes: ${centrals.map(c => c.code).join(', ')}` 
          });
          return;
        }
        
        const exists = cables.some(c => c.centralId === centralId && c.number === manualEntry.number);
        if (exists) {
          toast({ 
            variant: "destructive", 
            title: "Duplicate Cable", 
            description: `Cable "${manualEntry.number}" already exists in this Central.` 
          });
          return;
        }
        
        await masterDataApi.createCable({ 
          centralId, 
          number: manualEntry.number, 
          cableNumber: manualEntry.cableNumber || null,
          cabinetNumber: manualEntry.cabinetNumber || null,
          type: manualEntry.type || 'copper' 
        });
      } else if (type === 'faults') {
        await masterDataApi.createFaultType({ 
          name: manualEntry.name, 
          category: manualEntry.category || 'cable' 
        });
      } else if (type === 'works') {
        await masterDataApi.createWorkType({ 
          name: manualEntry.name,
          associatedMaterials: manualEntry.associatedMaterials || []
        });
      } else if (type === 'tasks') {
        await masterDataApi.createTaskType({ name: manualEntry.name });
      } else if (type === 'contractors') {
        await masterDataApi.createContractor({ name: manualEntry.name });
      } else if (type === 'excavation-workers') {
        if (!manualEntry.name || !manualEntry.nationalId) {
          toast({ variant: "destructive", title: "بيانات ناقصة", description: "يرجى إدخال الاسم والرقم القومي." });
          return;
        }
        await masterDataApi.createExcavationWorker({ name: manualEntry.name, nationalId: manualEntry.nationalId });
      }

      await fetchAllData();
      setManualEntry({});
      toast({ title: "Success", description: "Record added successfully." });
    } catch (error: any) {
      console.error("Failed to add record:", error);
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to add record." });
    }
  };

  const handleDelete = async (type: string, id: string) => {
    if (!confirm("Are you sure you want to delete this record?")) return;

    try {
      if (type === 'centrals') {
        await masterDataApi.deleteCentral(id);
      } else if (type === 'cables') {
        await masterDataApi.deleteCable(id);
      } else if (type === 'faults') {
        await masterDataApi.deleteFaultType(id);
      } else if (type === 'works') {
        await masterDataApi.deleteWorkType(id);
      } else if (type === 'tasks') {
        await masterDataApi.deleteTaskType(id);
      } else if (type === 'contractors') {
        await masterDataApi.deleteContractor(id);
      } else if (type === 'excavation-workers') {
        await masterDataApi.deleteExcavationWorker(id);
      }

      await fetchAllData();
      toast({ title: "Deleted", description: "Record deleted successfully." });
    } catch (error: any) {
      console.error("Failed to delete:", error);
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to delete record." });
    }
  };

  const handleUpdate = async (type: string, id: string, data: any) => {
    try {
      if (type === 'centrals') {
        await masterDataApi.updateCentral(id, { name: data.name, code: data.code });
      } else if (type === 'cables') {
        await masterDataApi.updateCable(id, { number: data.number, cableNumber: data.cableNumber, cabinetNumber: data.cabinetNumber, type: data.type });
      } else if (type === 'faults') {
        await masterDataApi.updateFaultType(id, { name: data.name, category: data.category });
      } else if (type === 'works') {
        await masterDataApi.updateWorkType(id, { 
          name: data.name,
          associatedMaterials: data.associatedMaterials || []
        });
      } else if (type === 'tasks') {
        await masterDataApi.updateTaskType(id, { name: data.name });
      } else if (type === 'contractors') {
        await masterDataApi.updateContractor(id, { name: data.name });
      } else if (type === 'excavation-workers') {
        await masterDataApi.updateExcavationWorker(id, { name: data.name, nationalId: data.nationalId });
      }

      await fetchAllData();
      toast({ title: "Updated", description: "Record updated successfully." });
    } catch (error: any) {
      console.error("Failed to update:", error);
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to update record." });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Database className="text-primary" /> {t.masterData}
        </h1>
        <p className="text-sm text-muted-foreground">Manage system reference data</p>
      </div>

      <Tabs defaultValue="centrals" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-7 bg-secondary/50">
          <TabsTrigger value="centrals">{t.central}</TabsTrigger>
          <TabsTrigger value="cables">{t.cable}</TabsTrigger>
          <TabsTrigger value="faults">{t.faultType}</TabsTrigger>
          <TabsTrigger value="works">{t.workType}</TabsTrigger>
          <TabsTrigger value="tasks">{t.taskType}</TabsTrigger>
          <TabsTrigger value="contractors">{t.contractors}</TabsTrigger>
          <TabsTrigger value="excavation-workers">عمال الحفر</TabsTrigger>
        </TabsList>
        
        <TabsContent value="centrals">
           <DataSection 
             title="Centrals" 
             type="centrals" 
             items={centrals} 
             columns={['Name', 'Code']}
             manualEntry={manualEntry}
             setManualEntry={setManualEntry}
             handleManualAdd={handleManualAdd}
             downloadTemplate={downloadTemplate}
             handleFileUpload={handleFileUpload}
             fileInputRef={fileInputRef}
             t={t}
             centrals={centrals}
             handleDelete={handleDelete}
             handleUpdate={handleUpdate}
             loading={loading}
             renderManualForm={(entry: any, setEntry: any) => (
               <>
                 <div className="grid gap-2">
                   <Label>Name</Label>
                   <Input 
                     value={entry.name || ''} 
                     onChange={e => setEntry({...entry, name: e.target.value})} 
                     placeholder="Central Name"
                   />
                 </div>
                 <div className="grid gap-2">
                   <Label>Code</Label>
                   <Input 
                     value={entry.code || ''} 
                     onChange={e => setEntry({...entry, code: e.target.value})} 
                     placeholder="Code (e.g. DTC)"
                   />
                 </div>
               </>
             )}
           />
        </TabsContent>

        <TabsContent value="cables">
           <DataSection 
             title="Cables" 
             type="cables" 
             items={cables} 
             columns={['Central', 'Number', 'رقم الكابل', 'رقم الكابينه', 'Type']}
             manualEntry={manualEntry}
             setManualEntry={setManualEntry}
             handleManualAdd={handleManualAdd}
             downloadTemplate={downloadTemplate}
             handleFileUpload={handleFileUpload}
             fileInputRef={fileInputRef}
             t={t}
             centrals={centrals}
             handleDelete={handleDelete}
             handleUpdate={handleUpdate}
             loading={loading}
             renderManualForm={(entry: any, setEntry: any) => (
               <>
                 <div className="grid gap-2 min-w-[200px]">
                   <Label>Central Code</Label>
                   <Input 
                     value={entry.centralCode || ''} 
                     onChange={e => setEntry({...entry, centralCode: e.target.value})} 
                     placeholder="Existing Central Code"
                   />
                 </div>
                 <div className="grid gap-2">
                   <Label>Number</Label>
                   <Input 
                     value={entry.number || ''} 
                     onChange={e => setEntry({...entry, number: e.target.value})} 
                     placeholder="Cable #"
                   />
                 </div>
                 <div className="grid gap-2">
                   <Label>رقم الكابل</Label>
                   <Input 
                     value={entry.cableNumber || ''} 
                     onChange={e => setEntry({...entry, cableNumber: e.target.value})} 
                     placeholder="رقم الكابل"
                   />
                 </div>
                 <div className="grid gap-2">
                   <Label>رقم الكابينه</Label>
                   <Input 
                     value={entry.cabinetNumber || ''} 
                     onChange={e => setEntry({...entry, cabinetNumber: e.target.value})} 
                     placeholder="رقم الكابينه"
                   />
                 </div>
                 <div className="grid gap-2">
                   <Label>Type</Label>
                   <select 
                     className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                     value={entry.type || 'copper'}
                     onChange={e => setEntry({...entry, type: e.target.value})}
                   >
                     <option value="copper">Copper</option>
                     <option value="fiber">Fiber</option>
                   </select>
                 </div>
               </>
             )}
           />
        </TabsContent>

        <TabsContent value="faults">
           <DataSection 
             title="Fault Types" 
             type="faults" 
             items={faultTypes} 
             columns={['Name', 'Category']}
             manualEntry={manualEntry}
             setManualEntry={setManualEntry}
             handleManualAdd={handleManualAdd}
             downloadTemplate={downloadTemplate}
             handleFileUpload={handleFileUpload}
             fileInputRef={fileInputRef}
             t={t}
             centrals={centrals}
             handleDelete={handleDelete}
             handleUpdate={handleUpdate}
             loading={loading}
             renderManualForm={(entry: any, setEntry: any) => (
                <>
                 <div className="grid gap-2 flex-1">
                   <Label>Fault Name</Label>
                   <Input 
                     value={entry.name || ''} 
                     onChange={e => setEntry({...entry, name: e.target.value})} 
                     placeholder="Fault Description"
                   />
                 </div>
                 <div className="grid gap-2 w-40">
                   <Label>Category</Label>
                   <select 
                     className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                     value={entry.category || 'cable'}
                     onChange={e => setEntry({...entry, category: e.target.value})}
                   >
                     <option value="cable">Cable</option>
                     <option value="equipment">Equipment</option>
                     <option value="civil">Civil</option>
                   </select>
                 </div>
               </>
             )}
           />
        </TabsContent>

        <TabsContent value="works">
           <DataSection 
             title="Work Types" 
             type="works" 
             items={workTypes} 
             columns={['Name', 'Associated Materials']}
             manualEntry={manualEntry}
             setManualEntry={setManualEntry}
             handleManualAdd={handleManualAdd}
             downloadTemplate={downloadTemplate}
             handleFileUpload={handleFileUpload}
             fileInputRef={fileInputRef}
             t={t}
             centrals={centrals}
             handleDelete={handleDelete}
             handleUpdate={handleUpdate}
             loading={loading}
             taskTypes={taskTypes}
             renderManualForm={(entry: any, setEntry: any) => (
               <div className="space-y-4 flex-1">
                 <div className="grid gap-2">
                   <Label>Work Type Name</Label>
                   <Input 
                     value={entry.name || ''} 
                     onChange={e => setEntry({...entry, name: e.target.value})} 
                     placeholder="e.g. Splicing"
                   />
                 </div>
                 <div className="grid gap-2">
                   <Label className="flex items-center justify-between">
                     <span>المهمات المرتبطة (اختياري)</span>
                     <Button 
                       type="button" 
                       variant="ghost" 
                       size="sm"
                       onClick={() => {
                         const materials = entry.associatedMaterials || [];
                         setEntry({...entry, associatedMaterials: [...materials, {taskTypeId: '', defaultQuantity: 1}]});
                       }}
                     >
                       <Plus size={12} /> إضافة مهمة
                     </Button>
                   </Label>
                   {(entry.associatedMaterials || []).map((mat: any, idx: number) => (
                     <div key={idx} className="flex gap-2 items-center">
                       <Select 
                         value={mat.taskTypeId} 
                         onValueChange={(val) => {
                           const mats = [...(entry.associatedMaterials || [])];
                           mats[idx] = {...mats[idx], taskTypeId: val};
                           setEntry({...entry, associatedMaterials: mats});
                         }}
                       >
                         <SelectTrigger className="flex-1"><SelectValue placeholder="اختر المهمة" /></SelectTrigger>
                         <SelectContent>
                           {taskTypes.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                         </SelectContent>
                       </Select>
                       <Input 
                         type="number" 
                         className="w-20" 
                         value={mat.defaultQuantity} 
                         onChange={(e) => {
                           const mats = [...(entry.associatedMaterials || [])];
                           mats[idx] = {...mats[idx], defaultQuantity: Number(e.target.value)};
                           setEntry({...entry, associatedMaterials: mats});
                         }}
                         placeholder="الكمية"
                       />
                       <Button 
                         type="button" 
                         variant="ghost" 
                         size="icon"
                         onClick={() => {
                           const mats = [...(entry.associatedMaterials || [])];
                           mats.splice(idx, 1);
                           setEntry({...entry, associatedMaterials: mats});
                         }}
                       >
                         <Trash2 size={14} className="text-destructive" />
                       </Button>
                     </div>
                   ))}
                 </div>
               </div>
             )}
           />
        </TabsContent>

        <TabsContent value="tasks">
           <DataSection 
             title="Task/Item Names" 
             type="tasks" 
             items={taskTypes} 
             columns={['Name']}
             manualEntry={manualEntry}
             setManualEntry={setManualEntry}
             handleManualAdd={handleManualAdd}
             downloadTemplate={downloadTemplate}
             handleFileUpload={handleFileUpload}
             fileInputRef={fileInputRef}
             t={t}
             centrals={centrals}
             handleDelete={handleDelete}
             handleUpdate={handleUpdate}
             loading={loading}
             renderManualForm={(entry: any, setEntry: any) => (
               <div className="grid gap-2 flex-1">
                 <Label>Item Name</Label>
                 <Input 
                   value={entry.name || ''} 
                   onChange={e => setEntry({...entry, name: e.target.value})} 
                   placeholder="e.g. Connector"
                 />
               </div>
             )}
           />
        </TabsContent>

        <TabsContent value="contractors">
           <DataSection 
             title="Contractors" 
             type="contractors" 
             items={contractors} 
             columns={['Name']}
             manualEntry={manualEntry}
             setManualEntry={setManualEntry}
             handleManualAdd={handleManualAdd}
             downloadTemplate={downloadTemplate}
             handleFileUpload={handleFileUpload}
             fileInputRef={fileInputRef}
             t={t}
             centrals={centrals}
             handleDelete={handleDelete}
             handleUpdate={handleUpdate}
             loading={loading}
             renderManualForm={(entry: any, setEntry: any) => (
               <div className="grid gap-2 flex-1">
                 <Label>Contractor Name</Label>
                 <Input 
                   value={entry.name || ''} 
                   onChange={e => setEntry({...entry, name: e.target.value})} 
                   placeholder="e.g. ABC Company"
                 />
               </div>
             )}
           />
        </TabsContent>

        <TabsContent value="excavation-workers">
           <DataSection 
             title="عمال الحفر" 
             type="excavation-workers" 
             items={excavationWorkers} 
             columns={['الاسم', 'الرقم القومي']}
             manualEntry={manualEntry}
             setManualEntry={setManualEntry}
             handleManualAdd={handleManualAdd}
             downloadTemplate={downloadTemplate}
             handleFileUpload={handleFileUpload}
             fileInputRef={fileInputRef}
             t={t}
             centrals={centrals}
             handleDelete={handleDelete}
             handleUpdate={handleUpdate}
             loading={loading}
             renderManualForm={(entry: any, setEntry: any) => (
               <div className="flex gap-4 flex-1">
                 <div className="grid gap-2 flex-1">
                   <Label>اسم العامل</Label>
                   <Input 
                     value={entry.name || ''} 
                     onChange={e => setEntry({...entry, name: e.target.value})} 
                     placeholder="مثال: أحمد محمد"
                   />
                 </div>
                 <div className="grid gap-2 flex-1">
                   <Label>الرقم القومي</Label>
                   <Input 
                     value={entry.nationalId || ''} 
                     onChange={e => setEntry({...entry, nationalId: e.target.value})} 
                     placeholder="مثال: 29901234567890"
                   />
                 </div>
               </div>
             )}
           />
        </TabsContent>

      </Tabs>
    </div>
  );
}

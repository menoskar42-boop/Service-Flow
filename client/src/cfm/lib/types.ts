
export type Role = 
  | 'admin' 
  | 'external_affairs' 
  | 'ext_tech' 
  | 'splice_tech' 
  | 'cable_engineer' 
  | 'supervisor';

export type User = {
  id: string;
  username: string;
  password?: string; // Hashed/Mocked
  name: string;
  role: Role;
  avatar?: string;
  isInitialPassword?: boolean;
};

export type Central = {
  id: string;
  name: string; // Arabic name
  code: string;
};

export type CableType = 'copper' | 'fiber';

export type Cable = {
  id: string;
  centralId: string;
  number: string;
  type: CableType;
};

export type FaultType = {
  id: string;
  name: string; // Arabic name
  category: 'cable' | 'equipment' | 'civil';
};

export type WorkType = {
  id: string;
  name: string; // Arabic name
};

export type TaskType = {
  id: string;
  name: string; // Arabic name
};

// New Status Logic
export type TicketStatus = 
  | 'open' 
  | 'pending_confirmation' 
  | 'closed' 
  | 'cancelled';

export type WorkItem = {
  id: string;
  workTypeId: string;
  quantity: number;
};

export type UsedTaskItem = {
  id: string;
  taskTypeId: string;
  quantity: number;
};

export type WorkEntry = {
  id: string;
  items: WorkItem[];
  notes?: string;
  performedBy: string; // Technician Name
  worksBy?: WorksBy;
  contractorId?: string;
  createdAt: string;
  createdBy: string;
};

export type UsedTaskEntry = {
  id: string;
  items: UsedTaskItem[];
  notes?: string;
  performedBy: string; // Technician Name
  createdAt: string;
  createdBy: string;
};

export type MeasurementDirection = 'cable' | 'cabinet';

export type MeasurementEntry = {
  id: string;
  reading: string;
  distance?: number;
  direction?: MeasurementDirection;
  notes?: string;
  performedBy?: string; // Technician Name
  works: WorkEntry[]; // Works associated with this measurement
  usedTasks: UsedTaskEntry[]; // Used tasks associated with this measurement
  createdAt: string;
  createdBy: string;
};

export type WorksBy = 'self' | 'contractor';

// إجراء الإصلاح النهائى (Mode C) — كان مستخدَم فى Ticket و store من غير تعريف.
export type RepairAction = {
  id: string;
  description: string;
  repairedAt: string;
  repairedBy: string;
};

// WorkEntry معرَّف فوق مرة واحدة — كان مكرَّر بنفس الحقول بالظبط (تعريفين لنفس
// الاسم فى نفس الملف)، والتانى بيطغى على الأول من غير ما حد ياخد باله.

export type Contractor = {
  id: string;
  name: string;
};

export type InventoryTransaction = {
  id: string;
  type: 'incoming' | 'outgoing';
  taskTypeId: string;
  quantity: number;
  date: string;
  ticketId?: string; // Only for outgoing
  notes?: string;
};

export type InventoryItem = {
  id: string;
  taskTypeId: string;
  quantity: number;
};

export type Ticket = {
  id: string;
  ticketNumber: string;
  centralDepartment: string; // "External Plant", "Transmission", etc.
  centralId: string;
  cableId: string;
  cabinet: string;
  box: string;
  faultTypeId: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  status: TicketStatus;
  
  // Data for the 3 modes
  works: WorkEntry[]; // For Mode A (Works without repair)
  usedTasks: UsedTaskEntry[]; // For Mode A (Used Tasks)
  measurements: MeasurementEntry[]; // For Mode B (Measurements + Works)
  finalRepair?: RepairAction; // For Mode C (Final Repair)
  
  closedAt?: string;
  closedBy?: string; // Name of the person who confirmed closing

  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export const MOCK_CONTRACTORS: Contractor[] = [
  { id: 'cnt1', name: 'شركة التوحيد للمقاولات' },
  { id: 'cnt2', name: 'مؤسسة الأمل' },
];

export const MOCK_INVENTORY: InventoryItem[] = [
  { id: 'inv1', taskTypeId: 'tsk1', quantity: 100 },
  { id: 'inv2', taskTypeId: 'tsk2', quantity: 50 },
  { id: 'inv3', taskTypeId: 'tsk3', quantity: 20 },
];


// Initial Mock Data (Arabic Defaults)
export const MOCK_CENTRALS: Central[] = [
  { id: 'c1', name: 'سنترال وسط البلد', code: 'DTC' },
  { id: 'c2', name: 'سنترال المنطقة الشمالية', code: 'NDC' },
  { id: 'c3', name: 'سنترال المنطقة الصناعية', code: 'IZC' },
];

export const MOCK_CABLES: Cable[] = [
  { id: 'cab1', centralId: 'c1', number: '101', type: 'copper' },
  { id: 'cab2', centralId: 'c1', number: '102', type: 'fiber' },
  { id: 'cab3', centralId: 'c1', number: '205', type: 'copper' },
  { id: 'cab4', centralId: 'c2', number: 'N-01', type: 'fiber' },
  { id: 'cab5', centralId: 'c2', number: 'N-02', type: 'copper' },
  { id: 'cab6', centralId: 'c3', number: 'IND-99', type: 'fiber' },
];

export const MOCK_FAULT_TYPES: FaultType[] = [
  { id: 'f1', name: 'قطع كابل', category: 'cable' },
  { id: 'f2', name: 'عزل منخفض', category: 'cable' },
  { id: 'f3', name: 'تشويش خط', category: 'cable' },
  { id: 'f4', name: 'تلف كابينة', category: 'equipment' },
  { id: 'f5', name: 'بوكس مكسور', category: 'equipment' },
];

export const MOCK_WORK_TYPES: WorkType[] = [
  { id: 'w1', name: 'حفر' },
  { id: 'w2', name: 'لحام' },
  { id: 'w3', name: 'تمديد' },
  { id: 'w4', name: 'ردم' },
];

export const MOCK_TASK_TYPES: TaskType[] = [
  { id: 'tsk1', name: 'تجهيز مسار' },
  { id: 'tsk2', name: 'تركيب وصلة' },
  { id: 'tsk3', name: 'اختبار توصيل' },
];

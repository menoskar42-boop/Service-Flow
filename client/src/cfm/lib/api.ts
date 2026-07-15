// API Client for Cable Guardian Application

// Types matching backend
export interface User {
  id: string;
  username: string;
  name: string;
  role: string;
  avatar?: string | null;
  isInitialPassword: boolean;
  createdAt: string;
}

export interface Central {
  id: string;
  name: string;
  code: string;
  createdAt: string;
}

export interface Cable {
  id: string;
  centralId: string;
  number: string;
  cableNumber?: string | null;
  cabinetNumber?: string | null;
  type: 'copper' | 'fiber';
  createdAt: string;
}

export interface FaultType {
  id: string;
  name: string;
  category: 'cable' | 'equipment' | 'civil';
  createdAt: string;
}

export interface AssociatedMaterial {
  taskTypeId: string;
  defaultQuantity: number;
}

export interface WorkType {
  id: string;
  name: string;
  associatedMaterials?: AssociatedMaterial[] | null;
  createdAt: string;
}

export interface TaskType {
  id: string;
  name: string;
  createdAt: string;
}

export interface Contractor {
  id: string;
  name: string;
  createdAt: string;
}

export interface ExcavationWorker {
  id: string;
  name: string;
  nationalId: string;
  createdAt: string;
}

export interface WorkItem {
  id: string;
  workTypeId: string;
  quantity: number;
  excavationWorkerId?: string;
  excavationLength?: number;
  excavationWidth?: number;
  excavationDepth?: number;
}

export interface TaskItem {
  id: string;
  taskTypeId: string;
  quantity: number;
}

export interface WorkEntry {
  id: string;
  ticketId: string;
  measurementId?: string | null;
  items: WorkItem[];
  notes?: string | null;
  performedBy: string;
  worksBy?: string | null;
  contractorId?: string | null;
  createdBy: string;
  recordedAt: string;
  createdAt: string;
}

export interface UsedTaskEntry {
  id: string;
  ticketId: string;
  measurementId?: string | null;
  items: TaskItem[];
  notes?: string | null;
  performedBy: string;
  createdBy: string;
  recordedAt: string;
  createdAt: string;
}

export interface MeasurementEntry {
  id: string;
  ticketId: string;
  reading: string;
  distance?: number | null;
  direction?: string | null;
  notes?: string | null;
  performedBy?: string | null;
  createdBy: string;
  recordedAt: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  centralDepartment: string;
  centralId: string;
  cableId: string;
  cabinet: string;
  box: string;
  faultTypeId: string;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: 'open' | 'pending_confirmation' | 'closed' | 'cancelled';
  finalRepairId?: string | null;
  finalRepairDescription?: string | null;
  finalRepairRepairedAt?: string | null;
  finalRepairRepairedBy?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  central?: Central;
  cable?: Cable;
  faultType?: FaultType;
  createdByUser?: User;
  works?: WorkEntry[];
  usedTasks?: UsedTaskEntry[];
  measurements?: MeasurementEntry[];
}

export interface InventoryTransaction {
  id: string;
  type: 'incoming' | 'outgoing';
  taskTypeId: string;
  quantity: number;
  date: string;
  ticketId?: string | null;
  notes?: string | null;
  createdAt: string;
}

let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`/api/cfm${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });

  if (response.status === 401) {
    if (endpoint !== '/auth/login' && endpoint !== '/auth/me') {
      if (onSessionExpired) {
        onSessionExpired();
      }
      throw new Error('SESSION_EXPIRED');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'Request failed',
    }));
    const errorMessage = error.details 
      ? `${error.error}: ${error.details}` 
      : (error.error || `HTTP ${response.status}`);
    throw new Error(errorMessage);
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: (username: string, password: string) =>
    apiFetch<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  me: () => apiFetch<User>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ success: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

// User Management API - Note: Server returns arrays directly
export const usersApi = {
  getAll: () => apiFetch<User[]>('/users'),
  getTechnicians: () => apiFetch<User[]>('/users/technicians'),

  create: (data: {
    username: string;
    password: string;
    name: string;
    role: string;
    avatar?: string;
  }) => apiFetch<{ user: User }>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  update: (id: string, data: { name?: string; role?: string; avatar?: string }) =>
    apiFetch<{ user: User }>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<{ success: boolean }>(`/users/${id}`, { method: 'DELETE' }),

  resetPassword: (id: string, newPassword: string) =>
    apiFetch<{ success: boolean }>(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
};

// Master Data API - Note: Server returns arrays/objects directly, not wrapped
export const masterDataApi = {
  // Centrals
  getCentrals: () => apiFetch<Central[]>('/master-data/centrals'),
  // أسماء السنترالات المرجعية الصحيحة من FCC (phone_lines) — لشاشة توحيد الأسماء
  getFccCentrals: () => apiFetch<string[]>('/master-data/fcc-centrals'),
  createCentral: (data: { name: string; code: string }) =>
    apiFetch<Central>('/master-data/centrals', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCentral: (id: string, data: { name?: string; code?: string }) =>
    apiFetch<Central>(`/master-data/centrals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteCentral: (id: string) =>
    apiFetch<{ success: boolean }>(`/master-data/centrals/${id}`, {
      method: 'DELETE',
    }),

  // Cables
  getCables: () => apiFetch<Cable[]>('/master-data/cables'),
  createCable: (data: { centralId: string; number: string; cableNumber?: string | null; cabinetNumber?: string | null; type: 'copper' | 'fiber' }) =>
    apiFetch<Cable>('/master-data/cables', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCable: (id: string, data: { centralId?: string; number?: string; cableNumber?: string | null; cabinetNumber?: string | null; type?: 'copper' | 'fiber' }) =>
    apiFetch<Cable>(`/master-data/cables/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteCable: (id: string) =>
    apiFetch<{ success: boolean }>(`/master-data/cables/${id}`, {
      method: 'DELETE',
    }),

  // Fault Types
  getFaultTypes: () => apiFetch<FaultType[]>('/master-data/fault-types'),
  createFaultType: (data: { name: string; category: 'cable' | 'equipment' | 'civil' }) =>
    apiFetch<FaultType>('/master-data/fault-types', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateFaultType: (id: string, data: { name?: string; category?: 'cable' | 'equipment' | 'civil' }) =>
    apiFetch<FaultType>(`/master-data/fault-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteFaultType: (id: string) =>
    apiFetch<{ success: boolean }>(`/master-data/fault-types/${id}`, {
      method: 'DELETE',
    }),

  // Work Types
  getWorkTypes: () => apiFetch<WorkType[]>('/master-data/work-types'),
  createWorkType: (data: { name: string; associatedMaterials?: AssociatedMaterial[] }) =>
    apiFetch<WorkType>('/master-data/work-types', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateWorkType: (id: string, data: { name: string; associatedMaterials?: AssociatedMaterial[] }) =>
    apiFetch<WorkType>(`/master-data/work-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteWorkType: (id: string) =>
    apiFetch<{ success: boolean }>(`/master-data/work-types/${id}`, {
      method: 'DELETE',
    }),

  // Task Types
  getTaskTypes: () => apiFetch<TaskType[]>('/master-data/task-types'),
  createTaskType: (data: { name: string }) =>
    apiFetch<TaskType>('/master-data/task-types', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTaskType: (id: string, data: { name: string }) =>
    apiFetch<TaskType>(`/master-data/task-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteTaskType: (id: string) =>
    apiFetch<{ success: boolean }>(`/master-data/task-types/${id}`, {
      method: 'DELETE',
    }),

  // Contractors
  getContractors: () => apiFetch<Contractor[]>('/master-data/contractors'),
  createContractor: (data: { name: string }) =>
    apiFetch<Contractor>('/master-data/contractors', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateContractor: (id: string, data: { name: string }) =>
    apiFetch<Contractor>(`/master-data/contractors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteContractor: (id: string) =>
    apiFetch<{ success: boolean }>(`/master-data/contractors/${id}`, {
      method: 'DELETE',
    }),

  // Excavation Workers
  getExcavationWorkers: () => apiFetch<ExcavationWorker[]>('/master-data/excavation-workers'),
  createExcavationWorker: (data: { name: string; nationalId: string }) =>
    apiFetch<ExcavationWorker>('/master-data/excavation-workers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateExcavationWorker: (id: string, data: { name?: string; nationalId?: string }) =>
    apiFetch<ExcavationWorker>(`/master-data/excavation-workers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteExcavationWorker: (id: string) =>
    apiFetch<{ success: boolean }>(`/master-data/excavation-workers/${id}`, {
      method: 'DELETE',
    }),

  // Bulk Import
  bulkImport: (type: string, data: any[]) =>
    apiFetch<{ success: boolean; count: number }>(`/master-data/${type}/bulk`, {
      method: 'POST',
      body: JSON.stringify({ items: data }),
    }),
};

// Tickets API
export const ticketsApi = {
  getAll: () => apiFetch<Ticket[]>('/tickets'),

  getById: (id: string) => apiFetch<Ticket>(`/tickets/${id}`),

  create: (data: {
    centralDepartment: string;
    centralId: string;
    cableId: string;
    cabinet: string;
    box: string;
    faultTypeId: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
  }) => apiFetch<{ ticket: Ticket }>('/tickets', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  updateStatus: (id: string, status: string) =>
    apiFetch<{ ticket: Ticket }>(`/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  delete: (id: string) =>
    apiFetch<{ success: boolean; message: string }>(`/tickets/${id}`, {
      method: 'DELETE',
    }),

  addWork: (id: string, data: {
    items: WorkItem[];
    notes?: string;
    performedBy: string;
    worksBy?: string;
    contractorId?: string;
    measurementId?: string;
    recordedAt?: Date | string;
  }) => apiFetch<{ work: WorkEntry }>(`/tickets/${id}/works`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  addTask: (id: string, data: {
    items: TaskItem[];
    notes?: string;
    performedBy: string;
    measurementId?: string;
    recordedAt?: Date | string;
  }) => apiFetch<{ task: UsedTaskEntry }>(`/tickets/${id}/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  addMeasurement: (id: string, data: {
    reading: string;
    distance?: number;
    direction?: string;
    notes?: string;
    performedBy?: string;
    recordedAt?: Date | string;
  }) => apiFetch<{ measurement: MeasurementEntry }>(`/tickets/${id}/measurements`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  addFinalRepair: (id: string, data: {
    finalRepairDescription?: string;
  }) => apiFetch<{ ticket: Ticket }>(`/tickets/${id}/final-repair`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  confirm: (id: string) =>
    apiFetch<{ ticket: Ticket }>(`/tickets/${id}/confirm`, {
      method: 'POST',
    }),

  revertRepair: (id: string) =>
    apiFetch<Ticket>(`/tickets/${id}/revert-repair`, {
      method: 'POST',
    }),

  deleteWork: (ticketId: string, workId: string) =>
    apiFetch<{ success: boolean }>(`/tickets/${ticketId}/works/${workId}`, {
      method: 'DELETE',
    }),

  deleteTask: (ticketId: string, taskId: string) =>
    apiFetch<{ success: boolean }>(`/tickets/${ticketId}/tasks/${taskId}`, {
      method: 'DELETE',
    }),

  deleteMeasurement: (ticketId: string, measurementId: string) =>
    apiFetch<{ success: boolean }>(`/tickets/${ticketId}/measurements/${measurementId}`, {
      method: 'DELETE',
    }),
};

// Inventory API
export const inventoryApi = {
  getTransactions: () =>
    apiFetch<InventoryTransaction[]>('/inventory/transactions'),

  addIncoming: (data: {
    taskTypeId: string;
    quantity: number;
    date: string;
    notes?: string;
  }) => apiFetch<InventoryTransaction>('/inventory/incoming', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};

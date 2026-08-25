import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  Ticket, 
  User, 
  MOCK_CENTRALS, 
  MOCK_CABLES, 
  MOCK_FAULT_TYPES, 
  MOCK_WORK_TYPES,
  MOCK_TASK_TYPES,
  MOCK_CONTRACTORS,
  MOCK_INVENTORY,
  Central, 
  Cable, 
  FaultType,
  WorkType,
  TaskType,
  Contractor,
  InventoryItem,
  InventoryTransaction,
  MeasurementEntry,
  WorkEntry,
  UsedTaskEntry,
  RepairAction
} from './types';

interface AppState {
  user: User | null; // Null when not logged in
  users: User[]; // List of all users
  tickets: Ticket[];
  
  // Master Data
  centrals: Central[];
  cables: Cable[];
  faultTypes: FaultType[];
  workTypes: WorkType[];
  taskTypes: TaskType[];
  contractors: Contractor[];
  inventoryTransactions: InventoryTransaction[];
  
  language: 'en' | 'ar';
  sessionExpiredMessage: string | null;
  setSessionExpiredMessage: (msg: string | null) => void;
  
  // Actions
  addTicket: (ticket: Omit<Ticket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt' | 'createdBy' | 'status' | 'works' | 'measurements' | 'usedTasks'>) => void;
  
  // New actions for the 3 modes
  addWorkEntry: (ticketId: string, work: Omit<WorkEntry, 'id' | 'createdAt' | 'createdBy'>) => void;
  addUsedTaskEntry: (ticketId: string, task: Omit<UsedTaskEntry, 'id' | 'createdAt' | 'createdBy'>) => void;
  
  addMeasurementEntry: (ticketId: string, measurement: Omit<MeasurementEntry, 'id' | 'createdAt' | 'createdBy' | 'works' | 'usedTasks'>) => void;
  
  // Nested additions to measurements
  addMeasurementWork: (ticketId: string, measurementId: string, work: Omit<WorkEntry, 'id' | 'createdAt' | 'createdBy'>) => void;
  addMeasurementUsedTask: (ticketId: string, measurementId: string, task: Omit<UsedTaskEntry, 'id' | 'createdAt' | 'createdBy'>) => void;

  recordFinalRepair: (ticketId: string, repair: Omit<RepairAction, 'id' | 'repairedAt' | 'repairedBy'>) => void;
  confirmRepair: (ticketId: string) => void;
  
  // Master Data Actions
  importMasterData: (type: 'centrals' | 'cables' | 'faults' | 'works' | 'tasks' | 'contractors', data: any[]) => void;
  updateMasterData: (type: 'centrals' | 'cables' | 'faults' | 'works' | 'tasks' | 'contractors', id: string, data: any) => void;
  deleteMasterData: (type: 'centrals' | 'cables' | 'faults' | 'works' | 'tasks' | 'contractors', id: string) => void;
  
  // Inventory Actions
  addIncomingTransaction: (taskTypeId: string, quantity: number, date: string) => void;

  setLanguage: (lang: 'en' | 'ar') => void;
  setUserRole: (role: User['role']) => void;

  // Auth Actions
  setUser: (user: User | null) => void;
  login: (username: string, password: string) => boolean;
  logout: () => void;
  changePassword: (password: string) => void;
  
  // User Management (Admin)
  addUser: (user: Omit<User, 'id'>) => void;
  updateUser: (id: string, data: Partial<User>) => void;
  deleteUser: (id: string) => void;
  resetUserPassword: (id: string, newPassword: string) => void;
}

// Initial mock tickets
const INITIAL_TICKETS: Ticket[] = [
  {
    id: 't1',
    ticketNumber: 'TKT-2024-001',
    centralDepartment: 'External Plant',
    centralId: 'c1',
    cableId: 'cab1',
    cabinet: 'A1',
    box: '10',
    faultTypeId: 'f1',
    notes: 'حفريات بجوار الكابل',
    status: 'open',
    createdBy: 'u1',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    latitude: 30.0444,
    longitude: 31.2357,
    works: [],
    usedTasks: [],
    measurements: []
  },
  {
    id: 't2',
    ticketNumber: 'TKT-2024-002',
    centralDepartment: 'External Plant',
    centralId: 'c2',
    cableId: 'cab4',
    cabinet: 'B2',
    box: '5',
    faultTypeId: 'f3',
    status: 'pending_confirmation',
    createdBy: 'u2',
    createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    latitude: 30.05,
    longitude: 31.24,
    works: [],
    usedTasks: [],
    measurements: [],
    finalRepair: {
      id: 'r1',
      description: 'تم استبدال الوصلة بالكامل',
      repairedAt: new Date(Date.now() - 3600000).toISOString(),
      repairedBy: 'u3'
    }
  }
];

// Mock "Hashing" (Simple string prefix for mock purposes to avoid btoa/unicode issues)
const hashPassword = (pwd: string) => `hashed_${pwd}`;

const INITIAL_USERS: User[] = [
  { 
    id: 'u1', 
    username: 'admin', 
    password: hashPassword('admin123'), 
    name: 'مدير النظام', 
    role: 'admin',
    isInitialPassword: false 
  },
  { 
    id: 'u2', 
    username: 'tech1', 
    password: hashPassword('123456'), 
    name: 'فني شؤون خارجية 1', 
    role: 'ext_tech',
    isInitialPassword: true
  }
];

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null, 
      users: INITIAL_USERS,
      tickets: INITIAL_TICKETS,
      centrals: MOCK_CENTRALS,
      cables: MOCK_CABLES,
      faultTypes: MOCK_FAULT_TYPES,
      workTypes: MOCK_WORK_TYPES,
      taskTypes: MOCK_TASK_TYPES,
      contractors: MOCK_CONTRACTORS,
      inventoryTransactions: [], 
      language: 'ar', 
      sessionExpiredMessage: null,
      setSessionExpiredMessage: (msg) => set({ sessionExpiredMessage: msg }),

      // Auth
      setUser: (user) => set({ user }),

      login: (username, password) => {
        const state = get();
        const user = state.users.find(u => u.username === username && u.password === hashPassword(password));
        if (user) {
          set({ user });
          return true;
        }
        return false;
      },

      logout: () => set({ user: null }),

      changePassword: (password) => set((state) => {
        if (!state.user) return {};
        const newHash = hashPassword(password);
        const updatedUser = { ...state.user, password: newHash, isInitialPassword: false };
        return {
          user: updatedUser,
          users: state.users.map(u => u.id === state.user!.id ? updatedUser : u)
        };
      }),

      addUser: (userData) => set((state) => ({
        users: [...state.users, { 
          ...userData, 
          id: Math.random().toString(36).substr(2, 9),
          password: hashPassword(userData.password || '123456') 
        }]
      })),

      updateUser: (id, data) => set((state) => {
        // Don't update password here directly unless specific reset action
        const { password, ...safeData } = data as any;
        return {
          users: state.users.map(u => u.id === id ? { ...u, ...safeData } : u)
        };
      }),

      deleteUser: (id) => set((state) => ({
        users: state.users.filter(u => u.id !== id)
      })),

      resetUserPassword: (id, newPassword) => set((state) => ({
        users: state.users.map(u => u.id === id ? { ...u, password: hashPassword(newPassword), isInitialPassword: true } : u)
      })),

      addTicket: (ticketData) => set((state) => {
        if (!state.user) return {};
        const newTicket: Ticket = {
          ...ticketData,
          id: Math.random().toString(36).substr(2, 9),
          ticketNumber: `TKT-2025-${(state.tickets.length + 1).toString().padStart(3, '0')}`,
          status: 'open',
          createdBy: state.user?.id ?? '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          works: [],
          usedTasks: [],
          measurements: []
        };
        return { tickets: [newTicket, ...state.tickets] };
      }),


      addWorkEntry: (ticketId, workData) => set((state) => ({
        tickets: state.tickets.map(t => {
          if (t.id !== ticketId) return t;
          const newWork: WorkEntry = {
            ...workData,
            id: Math.random().toString(36).substr(2, 9),
            createdAt: new Date().toISOString(),
            createdBy: state.user?.id ?? ''
          };
          return { ...t, works: [newWork, ...t.works], updatedAt: new Date().toISOString() };
        })
      })),

      addUsedTaskEntry: (ticketId, taskData) => set((state) => {
        // Create outgoing transactions
        const newTransactions: InventoryTransaction[] = taskData.items.map(item => ({
          id: Math.random().toString(36).substr(2, 9),
          type: 'outgoing',
          taskTypeId: item.taskTypeId,
          quantity: item.quantity,
          date: new Date().toISOString(),
          ticketId: ticketId
        }));

        return {
          inventoryTransactions: [...state.inventoryTransactions, ...newTransactions],
          tickets: state.tickets.map(t => {
            if (t.id !== ticketId) return t;
            const newTask: UsedTaskEntry = {
              ...taskData,
              id: Math.random().toString(36).substr(2, 9),
              createdAt: new Date().toISOString(),
              createdBy: state.user?.id ?? ''
            };
            return { ...t, usedTasks: [newTask, ...t.usedTasks], updatedAt: new Date().toISOString() };
          })
        };
      }),

      addMeasurementEntry: (ticketId, measurementData) => set((state) => ({
        tickets: state.tickets.map(t => {
          if (t.id !== ticketId) return t;
          const newMeasurement: MeasurementEntry = {
            ...measurementData,
            id: Math.random().toString(36).substr(2, 9),
            works: [],
            usedTasks: [],
            createdAt: new Date().toISOString(),
            createdBy: state.user?.id ?? ''
          };
          return { ...t, measurements: [newMeasurement, ...t.measurements], updatedAt: new Date().toISOString() };
        })
      })),

      addMeasurementWork: (ticketId, measurementId, workData) => set((state) => ({
        tickets: state.tickets.map(t => {
          if (t.id !== ticketId) return t;
          return {
            ...t,
            measurements: t.measurements.map(m => {
              if (m.id !== measurementId) return m;
              const newWork: WorkEntry = {
                ...workData,
                id: Math.random().toString(36).substr(2, 9),
                createdAt: new Date().toISOString(),
                createdBy: state.user?.id ?? ''
              };
              return { ...m, works: [newWork, ...m.works] };
            }),
            updatedAt: new Date().toISOString()
          };
        })
      })),

      addMeasurementUsedTask: (ticketId, measurementId, taskData) => set((state) => {
        // Create outgoing transactions for nested tasks
        const newTransactions: InventoryTransaction[] = taskData.items.map(item => ({
          id: Math.random().toString(36).substr(2, 9),
          type: 'outgoing',
          taskTypeId: item.taskTypeId,
          quantity: item.quantity,
          date: new Date().toISOString(),
          ticketId: ticketId
        }));

        return {
          inventoryTransactions: [...state.inventoryTransactions, ...newTransactions],
          tickets: state.tickets.map(t => {
            if (t.id !== ticketId) return t;
            return {
              ...t,
              measurements: t.measurements.map(m => {
                if (m.id !== measurementId) return m;
                const newTask: UsedTaskEntry = {
                  ...taskData,
                  id: Math.random().toString(36).substr(2, 9),
                  createdAt: new Date().toISOString(),
                  createdBy: state.user?.id ?? ''
                };
                return { ...m, usedTasks: [newTask, ...m.usedTasks] };
              }),
              updatedAt: new Date().toISOString()
            };
          })
        };
      }),

      recordFinalRepair: (ticketId, repairData) => set((state) => ({
        tickets: state.tickets.map(t => {
          if (t.id !== ticketId) return t;
          const repair: RepairAction = {
            ...repairData,
            id: Math.random().toString(36).substr(2, 9),
            repairedAt: new Date().toISOString(),
            repairedBy: state.user?.id ?? ''
          };
          return { 
            ...t, 
            finalRepair: repair, 
            status: 'pending_confirmation',
            updatedAt: new Date().toISOString() 
          };
        })
      })),

      confirmRepair: (ticketId) => set((state) => ({
        tickets: state.tickets.map(t => 
          t.id === ticketId ? { 
            ...t, 
            status: 'closed', 
            closedAt: new Date().toISOString(),
            closedBy: state.user?.name ?? '', // Record closer name
            updatedAt: new Date().toISOString() 
          } : t
        )
      })),

      importMasterData: (type, data) => set((state) => {
        // Simple append or replace logic could go here. For MVP we append new IDs.
        // In a real app, this would validate schema.
        const addIds = (items: any[]) => items.map(i => ({...i, id: Math.random().toString(36).substr(2, 9)}));
        
        switch(type) {
          case 'centrals': return { centrals: [...state.centrals, ...addIds(data)] };
          case 'cables': return { cables: [...state.cables, ...addIds(data)] };
          case 'faults': return { faultTypes: [...state.faultTypes, ...addIds(data)] };
          case 'works': return { workTypes: [...state.workTypes, ...addIds(data)] };
          case 'tasks': return { taskTypes: [...state.taskTypes, ...addIds(data)] };
          case 'contractors': return { contractors: [...state.contractors, ...addIds(data)] };
          default: return {};
        }
      }),

      updateMasterData: (type, id, data) => set((state) => {
        const update = (items: any[]) => items.map(i => i.id === id ? { ...i, ...data } : i);
        switch(type) {
          case 'centrals': return { centrals: update(state.centrals) };
          case 'cables': return { cables: update(state.cables) };
          case 'faults': return { faultTypes: update(state.faultTypes) };
          case 'works': return { workTypes: update(state.workTypes) };
          case 'tasks': return { taskTypes: update(state.taskTypes) };
          case 'contractors': return { contractors: update(state.contractors) };
          default: return {};
        }
      }),

      deleteMasterData: (type, id) => set((state) => {
        const remove = (items: any[]) => items.filter(i => i.id !== id);
        switch(type) {
          case 'centrals': return { centrals: remove(state.centrals) };
          case 'cables': return { cables: remove(state.cables) };
          case 'faults': return { faultTypes: remove(state.faultTypes) };
          case 'works': return { workTypes: remove(state.workTypes) };
          case 'tasks': return { taskTypes: remove(state.taskTypes) };
          case 'contractors': return { contractors: remove(state.contractors) };
          default: return {};
        }
      }),

      addIncomingTransaction: (taskTypeId, quantity, date) => set((state) => ({
         inventoryTransactions: [
           ...state.inventoryTransactions,
           {
             id: Math.random().toString(36).substr(2, 9),
             type: 'incoming',
             taskTypeId,
             quantity,
             date: date || new Date().toISOString()
           }
         ]
      })),

      setLanguage: (language) => set({ language }),
      
      // مفيش مستخدم مسجّل → مافيش دور نغيّره (بدل ما يتعمل كائن ناقص الحقول)
      setUserRole: (role) => set((state) => (state.user ? { user: { ...state.user, role } } : {})),
    }),
    {
      name: 'cable-guardian-storage-v6', // Bump version
      partialize: (state) => ({ 
        users: state.users, // Persist users
        user: state.user, // Persist session (optional, but good for refresh)
        tickets: state.tickets, 
        language: state.language,
        centrals: state.centrals,
        cables: state.cables,
        faultTypes: state.faultTypes,
        workTypes: state.workTypes,
        taskTypes: state.taskTypes,
        contractors: state.contractors,
        inventoryTransactions: state.inventoryTransactions
      }), 
    }
  )
);

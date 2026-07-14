import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  cfmUsers as users,
  centrals,
  cables,
  faultTypes,
  workTypes,
  taskTypes,
  contractors,
  excavationWorkers,
  tickets,
  workEntries,
  usedTaskEntries,
  measurementEntries,
  inventoryTransactions,
  type CfmUser as User,
  type InsertCfmUser as InsertUser,
  type Central,
  type InsertCentral,
  type Cable,
  type InsertCable,
  type FaultType,
  type InsertFaultType,
  type WorkType,
  type InsertWorkType,
  type TaskType,
  type InsertTaskType,
  type Contractor,
  type InsertContractor,
  type ExcavationWorker,
  type InsertExcavationWorker,
  type Ticket,
  type InsertTicket,
  type WorkEntry,
  type InsertWorkEntry,
  type UsedTaskEntry,
  type InsertUsedTaskEntry,
  type MeasurementEntry,
  type InsertMeasurementEntry,
  type InventoryTransaction,
  type InsertInventoryTransaction,
} from "@shared/cfm-schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;
  getAllUsers(): Promise<User[]>;
  
  // Auth
  updateUserPassword(id: string, password: string): Promise<User | undefined>;
  
  // Centrals
  getAllCentrals(): Promise<Central[]>;
  createCentral(central: InsertCentral): Promise<Central>;
  updateCentral(id: string, central: Partial<InsertCentral>): Promise<Central | undefined>;
  deleteCentral(id: string): Promise<void>;
  
  // Cables
  getAllCables(): Promise<Cable[]>;
  createCable(cable: InsertCable): Promise<Cable>;
  updateCable(id: string, cable: Partial<InsertCable>): Promise<Cable | undefined>;
  deleteCable(id: string): Promise<void>;
  
  // FaultTypes
  getAllFaultTypes(): Promise<FaultType[]>;
  createFaultType(faultType: InsertFaultType): Promise<FaultType>;
  updateFaultType(id: string, faultType: Partial<InsertFaultType>): Promise<FaultType | undefined>;
  deleteFaultType(id: string): Promise<void>;
  
  // WorkTypes
  getAllWorkTypes(): Promise<WorkType[]>;
  createWorkType(workType: InsertWorkType): Promise<WorkType>;
  updateWorkType(id: string, workType: Partial<InsertWorkType>): Promise<WorkType | undefined>;
  deleteWorkType(id: string): Promise<void>;
  
  // TaskTypes
  getAllTaskTypes(): Promise<TaskType[]>;
  createTaskType(taskType: InsertTaskType): Promise<TaskType>;
  updateTaskType(id: string, taskType: Partial<InsertTaskType>): Promise<TaskType | undefined>;
  deleteTaskType(id: string): Promise<void>;
  
  // Contractors
  getAllContractors(): Promise<Contractor[]>;
  createContractor(contractor: InsertContractor): Promise<Contractor>;
  updateContractor(id: string, contractor: Partial<InsertContractor>): Promise<Contractor | undefined>;
  deleteContractor(id: string): Promise<void>;
  
  // ExcavationWorkers
  getAllExcavationWorkers(): Promise<ExcavationWorker[]>;
  createExcavationWorker(worker: InsertExcavationWorker): Promise<ExcavationWorker>;
  updateExcavationWorker(id: string, worker: Partial<InsertExcavationWorker>): Promise<ExcavationWorker | undefined>;
  deleteExcavationWorker(id: string): Promise<void>;
  
  // Tickets
  getAllTickets(): Promise<Ticket[]>;
  getTicketById(id: string): Promise<Ticket | undefined>;
  createTicket(ticket: InsertTicket): Promise<Ticket>;
  updateTicket(id: string, ticket: Partial<InsertTicket>): Promise<Ticket | undefined>;
  
  // WorkEntries
  getWorkEntriesByTicketId(ticketId: string): Promise<WorkEntry[]>;
  getWorkEntryById(id: string): Promise<WorkEntry | undefined>;
  createWorkEntry(workEntry: InsertWorkEntry): Promise<WorkEntry>;
  deleteWorkEntry(id: string): Promise<void>;
  
  // UsedTaskEntries
  getUsedTaskEntriesByTicketId(ticketId: string): Promise<UsedTaskEntry[]>;
  getUsedTaskEntryById(id: string): Promise<UsedTaskEntry | undefined>;
  createUsedTaskEntry(usedTaskEntry: InsertUsedTaskEntry): Promise<UsedTaskEntry>;
  deleteUsedTaskEntry(id: string): Promise<void>;
  
  // MeasurementEntries
  getMeasurementEntriesByTicketId(ticketId: string): Promise<MeasurementEntry[]>;
  getMeasurementEntryById(id: string): Promise<MeasurementEntry | undefined>;
  createMeasurementEntry(measurementEntry: InsertMeasurementEntry): Promise<MeasurementEntry>;
  deleteMeasurementEntry(id: string): Promise<void>;
  
  // InventoryTransactions
  getAllInventoryTransactions(): Promise<InventoryTransaction[]>;
  createInventoryTransaction(inventoryTransaction: InsertInventoryTransaction): Promise<InventoryTransaction>;
}

export class DatabaseStorage implements IStorage {
  // ===== USERS ===== //
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0] ?? undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0] ?? undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }

  async updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined> {
    const result = await db.update(users).set(user).where(eq(users.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  // ===== AUTH ===== //
  async updateUserPassword(id: string, password: string): Promise<User | undefined> {
    const result = await db.update(users).set({ password, isInitialPassword: false }).where(eq(users.id, id)).returning();
    return result[0] ?? undefined;
  }

  // ===== CENTRALS ===== //
  async getAllCentrals(): Promise<Central[]> {
    return await db.select().from(centrals);
  }

  async createCentral(central: InsertCentral): Promise<Central> {
    const result = await db.insert(centrals).values(central).returning();
    return result[0];
  }

  async updateCentral(id: string, central: Partial<InsertCentral>): Promise<Central | undefined> {
    const result = await db.update(centrals).set(central).where(eq(centrals.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteCentral(id: string): Promise<void> {
    await db.delete(centrals).where(eq(centrals.id, id));
  }

  // ===== CABLES ===== //
  async getAllCables(): Promise<Cable[]> {
    return await db.select().from(cables);
  }

  async createCable(cable: InsertCable): Promise<Cable> {
    const result = await db.insert(cables).values(cable).returning();
    return result[0];
  }

  async updateCable(id: string, cable: Partial<InsertCable>): Promise<Cable | undefined> {
    const result = await db.update(cables).set(cable).where(eq(cables.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteCable(id: string): Promise<void> {
    await db.delete(cables).where(eq(cables.id, id));
  }

  // ===== FAULT TYPES ===== //
  async getAllFaultTypes(): Promise<FaultType[]> {
    return await db.select().from(faultTypes);
  }

  async createFaultType(faultType: InsertFaultType): Promise<FaultType> {
    const result = await db.insert(faultTypes).values(faultType).returning();
    return result[0];
  }

  async updateFaultType(id: string, faultType: Partial<InsertFaultType>): Promise<FaultType | undefined> {
    const result = await db.update(faultTypes).set(faultType).where(eq(faultTypes.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteFaultType(id: string): Promise<void> {
    await db.delete(faultTypes).where(eq(faultTypes.id, id));
  }

  // ===== WORK TYPES ===== //
  async getAllWorkTypes(): Promise<WorkType[]> {
    return await db.select().from(workTypes);
  }

  async createWorkType(workType: InsertWorkType): Promise<WorkType> {
    const result = await db.insert(workTypes).values(workType).returning();
    return result[0];
  }

  async updateWorkType(id: string, workType: Partial<InsertWorkType>): Promise<WorkType | undefined> {
    const result = await db.update(workTypes).set(workType).where(eq(workTypes.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteWorkType(id: string): Promise<void> {
    await db.delete(workTypes).where(eq(workTypes.id, id));
  }

  // ===== TASK TYPES ===== //
  async getAllTaskTypes(): Promise<TaskType[]> {
    return await db.select().from(taskTypes);
  }

  async createTaskType(taskType: InsertTaskType): Promise<TaskType> {
    const result = await db.insert(taskTypes).values(taskType).returning();
    return result[0];
  }

  async updateTaskType(id: string, taskType: Partial<InsertTaskType>): Promise<TaskType | undefined> {
    const result = await db.update(taskTypes).set(taskType).where(eq(taskTypes.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteTaskType(id: string): Promise<void> {
    await db.delete(taskTypes).where(eq(taskTypes.id, id));
  }

  // ===== CONTRACTORS ===== //
  async getAllContractors(): Promise<Contractor[]> {
    return await db.select().from(contractors);
  }

  async createContractor(contractor: InsertContractor): Promise<Contractor> {
    const result = await db.insert(contractors).values(contractor).returning();
    return result[0];
  }

  async updateContractor(id: string, contractor: Partial<InsertContractor>): Promise<Contractor | undefined> {
    const result = await db.update(contractors).set(contractor).where(eq(contractors.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteContractor(id: string): Promise<void> {
    await db.delete(contractors).where(eq(contractors.id, id));
  }

  // ===== EXCAVATION WORKERS ===== //
  async getAllExcavationWorkers(): Promise<ExcavationWorker[]> {
    return await db.select().from(excavationWorkers);
  }

  async createExcavationWorker(worker: InsertExcavationWorker): Promise<ExcavationWorker> {
    const result = await db.insert(excavationWorkers).values(worker).returning();
    return result[0];
  }

  async updateExcavationWorker(id: string, worker: Partial<InsertExcavationWorker>): Promise<ExcavationWorker | undefined> {
    const result = await db.update(excavationWorkers).set(worker).where(eq(excavationWorkers.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteExcavationWorker(id: string): Promise<void> {
    await db.delete(excavationWorkers).where(eq(excavationWorkers.id, id));
  }

  // ===== TICKETS ===== //
  async getAllTickets(): Promise<Ticket[]> {
    return await db.query.tickets.findMany({
      with: {
        central: true,
        cable: true,
        faultType: true,
        createdByUser: true,
        works: true,
        usedTasks: true,
        measurements: true,
      },
    }) as any;
  }

  async getTicketById(id: string): Promise<Ticket | undefined> {
    const result = await db.query.tickets.findFirst({
      where: eq(tickets.id, id),
      with: {
        central: true,
        cable: true,
        faultType: true,
        createdByUser: true,
        works: {
          with: {
            contractor: true,
          },
        },
        usedTasks: true,
        measurements: true,
      },
    }) as any;
    return result ?? undefined;
  }

  async createTicket(ticket: InsertTicket): Promise<Ticket> {
    const result = await db.insert(tickets).values(ticket as any).returning();
    return result[0];
  }

  async updateTicket(id: string, ticket: Partial<InsertTicket>): Promise<Ticket | undefined> {
    const updateData = { ...ticket, updatedAt: new Date() };
    const result = await db.update(tickets).set(updateData as any).where(eq(tickets.id, id)).returning();
    return result[0] ?? undefined;
  }

  async deleteTicket(id: string): Promise<boolean> {
    const result = await db.delete(tickets).where(eq(tickets.id, id)).returning();
    return result.length > 0;
  }

  // ===== WORK ENTRIES ===== //
  async getWorkEntriesByTicketId(ticketId: string): Promise<WorkEntry[]> {
    return await db.select().from(workEntries).where(eq(workEntries.ticketId, ticketId));
  }

  async getWorkEntryById(id: string): Promise<WorkEntry | undefined> {
    const result = await db.select().from(workEntries).where(eq(workEntries.id, id));
    return result[0] ?? undefined;
  }

  async createWorkEntry(workEntry: InsertWorkEntry): Promise<WorkEntry> {
    const result = await db.insert(workEntries).values(workEntry).returning();
    return result[0];
  }

  async deleteWorkEntry(id: string): Promise<void> {
    await db.delete(workEntries).where(eq(workEntries.id, id));
  }

  // ===== USED TASK ENTRIES ===== //
  async getUsedTaskEntriesByTicketId(ticketId: string): Promise<UsedTaskEntry[]> {
    return await db.select().from(usedTaskEntries).where(eq(usedTaskEntries.ticketId, ticketId));
  }

  async getUsedTaskEntryById(id: string): Promise<UsedTaskEntry | undefined> {
    const result = await db.select().from(usedTaskEntries).where(eq(usedTaskEntries.id, id));
    return result[0] ?? undefined;
  }

  async createUsedTaskEntry(usedTaskEntry: InsertUsedTaskEntry): Promise<UsedTaskEntry> {
    const result = await db.insert(usedTaskEntries).values(usedTaskEntry).returning();
    return result[0];
  }

  async deleteUsedTaskEntry(id: string): Promise<void> {
    await db.delete(usedTaskEntries).where(eq(usedTaskEntries.id, id));
  }

  // ===== MEASUREMENT ENTRIES ===== //
  async getMeasurementEntriesByTicketId(ticketId: string): Promise<MeasurementEntry[]> {
    return await db.select().from(measurementEntries).where(eq(measurementEntries.ticketId, ticketId));
  }

  async getMeasurementEntryById(id: string): Promise<MeasurementEntry | undefined> {
    const result = await db.select().from(measurementEntries).where(eq(measurementEntries.id, id));
    return result[0] ?? undefined;
  }

  async createMeasurementEntry(measurementEntry: InsertMeasurementEntry): Promise<MeasurementEntry> {
    const result = await db.insert(measurementEntries).values(measurementEntry).returning();
    return result[0];
  }

  async deleteMeasurementEntry(id: string): Promise<void> {
    await db.delete(measurementEntries).where(eq(measurementEntries.id, id));
  }

  // ===== INVENTORY TRANSACTIONS ===== //
  async getAllInventoryTransactions(): Promise<InventoryTransaction[]> {
    return await db.select().from(inventoryTransactions);
  }

  async createInventoryTransaction(inventoryTransaction: InsertInventoryTransaction): Promise<InventoryTransaction> {
    const result = await db.insert(inventoryTransactions).values(inventoryTransaction).returning();
    return result[0];
  }
}

export const storage = new DatabaseStorage();

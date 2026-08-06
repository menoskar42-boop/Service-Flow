// ============================================================================
// shared/cfm-schema.ts — تعريفات جداول Cable-Fault-Manager (المدمج) بـ Drizzle.
// منقول من schema.ts بتاع CFM مع إعادة تسمية users → cfmUsers (جدول "cfm_users")
// لتجنّب التعارض مع users بتاع Service-Flow. باقى الجداول بأسماءها الأصلية.
// ============================================================================
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, json, jsonb, doublePrecision, index, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ===== USERS (cfm_users) ===== //
export const cfmUsers = pgTable("cfm_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(), // 'admin' | 'external_affairs' | 'ext_tech' | 'splice_tech' | 'cable_engineer' | 'supervisor'
  avatar: text("avatar"),
  isInitialPassword: boolean("is_initial_password").default(true),
  // موجود فى ensureSchema من زمان — كان ناقص هنا فيبان كعمود «زايد» فى أى diff
  suspended: boolean("suspended").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCfmUserSchema = createInsertSchema(cfmUsers).omit({ id: true, createdAt: true });
export type InsertCfmUser = z.infer<typeof insertCfmUserSchema>;
export type CfmUser = typeof cfmUsers.$inferSelect;

// ===== MASTER DATA ===== //
export const centrals = pgTable("centrals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cables = pgTable("cables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  centralId: varchar("central_id").notNull().references(() => centrals.id, { onDelete: 'cascade' }),
  number: text("number").notNull(),
  cableNumber: text("cable_number"),
  cabinetNumber: text("cabinet_number"),
  type: text("type").notNull(), // 'copper' | 'fiber'
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCablePerCentral: unique().on(table.centralId, table.number),
}));

export const faultTypes = pgTable("fault_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  category: text("category").notNull(), // 'cable' | 'equipment' | 'civil'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workTypes = pgTable("work_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  associatedMaterials: jsonb("associated_materials").$type<{taskTypeId: string, defaultQuantity: number}[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const taskTypes = pgTable("task_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contractors = pgTable("contractors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const excavationWorkers = pgTable("excavation_workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  nationalId: text("national_id").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ===== TICKETS ===== //
export const tickets = pgTable("tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketNumber: text("ticket_number").notNull().unique(),
  centralDepartment: text("central_department").notNull(),
  centralId: varchar("central_id").notNull().references(() => centrals.id),
  cableId: varchar("cable_id").notNull().references(() => cables.id),
  cabinet: text("cabinet").notNull(),
  box: text("box").notNull(),
  faultTypeId: varchar("fault_type_id").notNull().references(() => faultTypes.id),
  notes: text("notes"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  status: text("status").notNull().default('open'),
  finalRepairId: varchar("final_repair_id"),
  finalRepairDescription: text("final_repair_description"),
  finalRepairRepairedAt: timestamp("final_repair_repaired_at"),
  finalRepairRepairedBy: varchar("final_repair_repaired_by"),
  closedAt: timestamp("closed_at"),
  closedBy: text("closed_by"),
  createdBy: varchar("created_by").notNull().references(() => cfmUsers.id),
  // اسم معروض بديل فى خانة «تم الفتح بواسطة» — بتستخدمه التكتات اللى بتتفتح تلقائياً
  // من Service-Flow، بصيغة «اسم الفنى-المصدر» (مثال: اسلام-OM / اسلام-طلبات).
  // created_by بيفضل مفتاح أجنبى حقيقى لحساب موجود (للتدقيق)، والعرض بياخد ده لو موجود.
  openedByLabel: text("opened_by_label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ticketNumberIdx: index("ticket_number_idx").on(table.ticketNumber),
  statusIdx: index("status_idx").on(table.status),
}));

export const measurementEntries = pgTable("measurement_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  reading: text("reading").notNull(),
  distance: doublePrecision("distance"),
  direction: text("direction"),
  notes: text("notes"),
  performedBy: text("performed_by"),
  createdBy: varchar("created_by").notNull().references(() => cfmUsers.id),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workEntries = pgTable("work_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  measurementId: varchar("measurement_id").references(() => measurementEntries.id, { onDelete: 'cascade' }),
  items: json("items").notNull().$type<Array<{id: string, workTypeId: string, quantity: number, excavationWorkerId?: string, excavationLength?: number, excavationWidth?: number, excavationDepth?: number}>>(),
  notes: text("notes"),
  performedBy: text("performed_by").notNull(),
  worksBy: text("works_by"),
  contractorId: varchar("contractor_id").references(() => contractors.id),
  createdBy: varchar("created_by").notNull().references(() => cfmUsers.id),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usedTaskEntries = pgTable("used_task_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  measurementId: varchar("measurement_id").references(() => measurementEntries.id, { onDelete: 'cascade' }),
  items: json("items").notNull().$type<Array<{id: string, taskTypeId: string, quantity: number}>>(),
  notes: text("notes"),
  performedBy: text("performed_by").notNull(),
  createdBy: varchar("created_by").notNull().references(() => cfmUsers.id),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // 'incoming' | 'outgoing'
  taskTypeId: varchar("task_type_id").notNull().references(() => taskTypes.id),
  quantity: integer("quantity").notNull(),
  date: timestamp("date").notNull(),
  ticketId: varchar("ticket_id").references(() => tickets.id, { onDelete: 'set null' }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ===== RELATIONS ===== //
export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  central: one(centrals, { fields: [tickets.centralId], references: [centrals.id] }),
  cable: one(cables, { fields: [tickets.cableId], references: [cables.id] }),
  faultType: one(faultTypes, { fields: [tickets.faultTypeId], references: [faultTypes.id] }),
  createdByUser: one(cfmUsers, { fields: [tickets.createdBy], references: [cfmUsers.id] }),
  works: many(workEntries),
  usedTasks: many(usedTaskEntries),
  measurements: many(measurementEntries),
  inventoryTransactions: many(inventoryTransactions),
}));

export const cablesRelations = relations(cables, ({ one }) => ({
  central: one(centrals, { fields: [cables.centralId], references: [centrals.id] }),
}));

export const workEntriesRelations = relations(workEntries, ({ one }) => ({
  ticket: one(tickets, { fields: [workEntries.ticketId], references: [tickets.id] }),
  measurement: one(measurementEntries, { fields: [workEntries.measurementId], references: [measurementEntries.id] }),
  contractor: one(contractors, { fields: [workEntries.contractorId], references: [contractors.id] }),
}));

export const usedTaskEntriesRelations = relations(usedTaskEntries, ({ one }) => ({
  ticket: one(tickets, { fields: [usedTaskEntries.ticketId], references: [tickets.id] }),
  measurement: one(measurementEntries, { fields: [usedTaskEntries.measurementId], references: [measurementEntries.id] }),
}));

export const measurementEntriesRelations = relations(measurementEntries, ({ one, many }) => ({
  ticket: one(tickets, { fields: [measurementEntries.ticketId], references: [tickets.id] }),
  works: many(workEntries),
  usedTasks: many(usedTaskEntries),
}));

export const inventoryTransactionsRelations = relations(inventoryTransactions, ({ one }) => ({
  taskType: one(taskTypes, { fields: [inventoryTransactions.taskTypeId], references: [taskTypes.id] }),
  ticket: one(tickets, { fields: [inventoryTransactions.ticketId], references: [tickets.id] }),
}));

// ===== INSERT SCHEMAS ===== //
export const insertCentralSchema = createInsertSchema(centrals).omit({ id: true, createdAt: true });
export const insertCableSchema = createInsertSchema(cables).omit({ id: true, createdAt: true });
export const insertFaultTypeSchema = createInsertSchema(faultTypes).omit({ id: true, createdAt: true });
export const insertWorkTypeSchema = createInsertSchema(workTypes).omit({ id: true, createdAt: true });
export const insertTaskTypeSchema = createInsertSchema(taskTypes).omit({ id: true, createdAt: true });
export const insertContractorSchema = createInsertSchema(contractors).omit({ id: true, createdAt: true });
export const insertExcavationWorkerSchema = createInsertSchema(excavationWorkers).omit({ id: true, createdAt: true });
export const insertTicketSchema = createInsertSchema(tickets).omit({ id: true, ticketNumber: true, createdAt: true, updatedAt: true });
export const insertWorkEntrySchema = createInsertSchema(workEntries).omit({ id: true, createdAt: true });
export const insertUsedTaskEntrySchema = createInsertSchema(usedTaskEntries).omit({ id: true, createdAt: true });
export const insertMeasurementEntrySchema = createInsertSchema(measurementEntries).omit({ id: true, createdAt: true });
export const insertInventoryTransactionSchema = createInsertSchema(inventoryTransactions).omit({ id: true, createdAt: true });

// ===== TYPES ===== //
export type InsertCentral = z.infer<typeof insertCentralSchema>;
export type InsertCable = z.infer<typeof insertCableSchema>;
export type InsertFaultType = z.infer<typeof insertFaultTypeSchema>;
export type InsertWorkType = z.infer<typeof insertWorkTypeSchema>;
export type InsertTaskType = z.infer<typeof insertTaskTypeSchema>;
export type InsertContractor = z.infer<typeof insertContractorSchema>;
export type InsertExcavationWorker = z.infer<typeof insertExcavationWorkerSchema>;
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type InsertWorkEntry = z.infer<typeof insertWorkEntrySchema>;
export type InsertUsedTaskEntry = z.infer<typeof insertUsedTaskEntrySchema>;
export type InsertMeasurementEntry = z.infer<typeof insertMeasurementEntrySchema>;
export type InsertInventoryTransaction = z.infer<typeof insertInventoryTransactionSchema>;

export type Central = typeof centrals.$inferSelect;
export type Cable = typeof cables.$inferSelect;
export type FaultType = typeof faultTypes.$inferSelect;
export type WorkType = typeof workTypes.$inferSelect;
export type TaskType = typeof taskTypes.$inferSelect;
export type Contractor = typeof contractors.$inferSelect;
export type ExcavationWorker = typeof excavationWorkers.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type WorkEntry = typeof workEntries.$inferSelect;
export type UsedTaskEntry = typeof usedTaskEntries.$inferSelect;
export type MeasurementEntry = typeof measurementEntries.$inferSelect;
export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;

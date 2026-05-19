import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Roles
export const ROLES = {
  SALES: "sales",
  TECH: "tech",
  ADMIN: "admin",
  EXTERNAL: "external",
  DATA_MANAGER: "data_manager",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

// Order Status
export const ORDER_STATUS = {
  PENDING: "pending",
  FEASIBLE: "feasible",
  NOT_FEASIBLE: "not_feasible",
  NEEDS_EXTERNAL: "needs_external",
  EXTERNAL_FEASIBLE: "external_feasible",
  EXTERNAL_NOT_FEASIBLE: "external_not_feasible",
} as const;

export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];

// Contract Status
export const CONTRACT_STATUS = {
  CONTRACTED: "تم التعاقد",
  NOT_CONTRACTED: "لم يتم التعاقد",
} as const;

export type ContractStatus = typeof CONTRACT_STATUS[keyof typeof CONTRACT_STATUS];

// Rejection Reasons for Tech Response
export const REJECTION_REASONS = {
  BOX_BROKEN: "بوكس معطل",
  BOX_FULL: "بوكس مليان",
  NO_NETWORK: "لا توجد شبكة",
  OTHER: "أخرى",
} as const;

export type RejectionReason = typeof REJECTION_REASONS[keyof typeof REJECTION_REASONS];

// Central Names for Tech Response (when box is broken or full)
export const CENTRAL_NAMES = {
  GHANAIM: "الغنايم",
  GHANAIM_DEIR: "الغنايم-دير الجنادله",
  GHANAIM_AZAIZA: "الغنايم-العزايزة",
  GHANAIM_OMDA: "الغنايم-نجع العمدة",
} as const;

export type CentralName = typeof CENTRAL_NAMES[keyof typeof CENTRAL_NAMES];

// Users Table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull(),
  suspended: boolean("suspended").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Orders Table
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),

  // Sales Inputs
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerAddress: text("customer_address").notNull(),
  nationalId: text("national_id"),
  serialNumber: text("serial_number"),
  salesId: integer("sales_id").references(() => users.id).notNull(),
  salesName: text("sales_name").notNull(),

  // Tech Inputs
  status: text("status").default("pending").notNull(),
  isFeasible: boolean("is_feasible"),
  rejectionReason: text("rejection_reason"),
  cabinNumber: text("cabin_number"),
  boxNumber: text("box_number"),
  nearestBoxDistance: text("nearest_box_distance"),
  additionalNotes: text("additional_notes"),
  centralName: text("central_name"),
  techId: integer("tech_id").references(() => users.id),
  techName: text("tech_name"),
  techResponseAt: timestamp("tech_response_at"),

  // External Affairs Inputs
  externalId: integer("external_id").references(() => users.id),
  externalName: text("external_name"),
  externalResponseAt: timestamp("external_response_at"),
  isFeasibleExternal: boolean("is_feasible_external"),
  externalRejectionReason: text("external_rejection_reason"),
  externalCabinNumber: text("external_cabin_number"),
  externalBoxNumber: text("external_box_number"),
  externalNearestBoxDistance: text("external_nearest_box_distance"),
  externalAdditionalNotes: text("external_additional_notes"),
  externalCentralName: text("external_central_name"),

  // Contract Status
  contractStatus: text("contract_status").default("لم يتم التعاقد").notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Phone Lines Table (migrated from in-memory JSON seed)
export const phoneLines = pgTable("phone_lines", {
  id: serial("id").primaryKey(),
  telNo: text("tel_no").notNull(),
  central: text("central").notNull(),
  iduNo: text("idu_no"),
  oduNo: text("odu_no"),
  cabinNumber: text("cabin_number"),
  primaryBlockNo: text("primary_block_no"),
  cabinetIn: text("cabinet_in"),
  secBlockNo: text("sec_block_no"),
  cabinetOut: text("cabinet_out"),
  boxNumber: text("box_number"),
  dpTerminal: text("dp_terminal"),
  port: text("port"),
  len: text("len"),
  fiberBlock: text("fiber_block"),
  fiberOut: text("fiber_out"),
  telNumTxt: text("tel_num_txt"),
  fullPhone: text("full_phone").notNull().unique(),
});

// Phone Line Edits Audit Table
export const phoneLineEdits = pgTable("phone_line_edits", {
  id: serial("id").primaryKey(),
  phoneLineId: integer("phone_line_id").references(() => phoneLines.id).notNull(),
  fullPhone: text("full_phone").notNull(),
  central: text("central").notNull(),
  oldCabinNumber: text("old_cabin_number"),
  newCabinNumber: text("new_cabin_number"),
  oldBoxNumber: text("old_box_number"),
  newBoxNumber: text("new_box_number"),
  oldDpTerminal: text("old_dp_terminal"),
  newDpTerminal: text("new_dp_terminal"),
  // pending → completed | rolled_back
  status: text("status").default("pending").notNull(),
  editedById: integer("edited_by_id").references(() => users.id).notNull(),
  editedByName: text("edited_by_name").notNull(),
  editedAt: timestamp("edited_at").defaultNow().notNull(),
  confirmedById: integer("confirmed_by_id").references(() => users.id),
  confirmedByName: text("confirmed_by_name"),
  confirmedAt: timestamp("confirmed_at"),
  rolledBackById: integer("rolled_back_by_id").references(() => users.id),
  rolledBackByName: text("rolled_back_by_name"),
  rolledBackAt: timestamp("rolled_back_at"),
});

export type PhoneLineEdit = typeof phoneLineEdits.$inferSelect;

// Schemas
export const insertUserSchema = createInsertSchema(users);
export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  salesId: true,
  salesName: true,
  status: true,
  isFeasible: true,
  rejectionReason: true,
  cabinNumber: true,
  boxNumber: true,
  nearestBoxDistance: true,
  additionalNotes: true,
  techId: true,
  techName: true,
  techResponseAt: true,
  externalId: true,
  externalName: true,
  externalResponseAt: true,
  isFeasibleExternal: true,
  externalRejectionReason: true,
  externalCabinNumber: true,
  externalBoxNumber: true,
  externalNearestBoxDistance: true,
  externalAdditionalNotes: true,
  externalCentralName: true,
});

export const updateOrderSchema = createInsertSchema(orders).pick({
  isFeasible: true,
  rejectionReason: true,
  cabinNumber: true,
  boxNumber: true,
  nearestBoxDistance: true,
  additionalNotes: true,
  centralName: true,
}).partial();

export const updateExternalResponseSchema = createInsertSchema(orders).pick({
  isFeasibleExternal: true,
  externalRejectionReason: true,
  externalCabinNumber: true,
  externalBoxNumber: true,
  externalNearestBoxDistance: true,
  externalAdditionalNotes: true,
  externalCentralName: true,
}).partial();

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;
export type UpdateExternal = z.infer<typeof updateExternalResponseSchema>;
export type PhoneLine = typeof phoneLines.$inferSelect;

// WebSocket Events
export const WS_EVENTS = {
  ORDER_UPDATE: 'ORDER_UPDATE',
  ORDER_CREATE: 'ORDER_CREATE',
} as const;

import { pgTable, text, serial, integer, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Roles
export const ROLES = {
  SALES: "sales",
  TECH: "tech",
  ADMIN: "admin",
  EXTERNAL: "external",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

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

// Order Status Values
export const ORDER_STATUS = {
  PENDING: "pending",
  FEASIBLE: "feasible",
  NOT_FEASIBLE: "not_feasible",
  NEEDS_EXTERNAL: "needs_external",
  EXTERNAL_FEASIBLE: "external_feasible",
  EXTERNAL_NOT_FEASIBLE: "external_not_feasible",
} as const;

// Users Table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull(), // sales, tech, admin, external
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
  nationalId: text("national_id"), // National ID - visible only to Sales and Admin
  salesId: integer("sales_id").references(() => users.id).notNull(),
  salesName: text("sales_name").notNull(), // Denormalized for easier display/export

  // Tech Inputs
  status: text("status").default("pending").notNull(), // pending, feasible, not_feasible, needs_external, external_feasible, external_not_feasible
  isFeasible: boolean("is_feasible"),
  rejectionReason: text("rejection_reason"), // Required if isFeasible is false
  cabinNumber: text("cabin_number"),
  boxNumber: text("box_number"),
  nearestBoxDistance: text("nearest_box_distance"), // Required if rejectionReason is "بوكس مليان"
  additionalNotes: text("additional_notes"), // Required if rejectionReason is "أخرى"
  centralName: text("central_name"), // Required if rejectionReason is "بوكس معطل" or "بوكس مليان"
  techId: integer("tech_id").references(() => users.id),
  techName: text("tech_name"),
  techResponseAt: timestamp("tech_response_at"),

  // External Affairs Response (additive layer, preserves tech response)
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

  // Contract Status (administrative, not technical)
  contractStatus: text("contract_status").default("لم يتم التعاقد").notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const updateExternalResponseSchema = z.object({
  isFeasibleExternal: z.boolean(),
  externalRejectionReason: z.string().nullable().optional(),
  externalCabinNumber: z.string().nullable().optional(),
  externalBoxNumber: z.string().nullable().optional(),
  externalNearestBoxDistance: z.string().nullable().optional(),
  externalAdditionalNotes: z.string().nullable().optional(),
  externalCentralName: z.string().nullable().optional(),
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;
export type UpdateExternalResponse = z.infer<typeof updateExternalResponseSchema>;

// WebSocket Events
export const WS_EVENTS = {
  ORDER_UPDATE: 'ORDER_UPDATE',
  ORDER_CREATE: 'ORDER_CREATE',
} as const;

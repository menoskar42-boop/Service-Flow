import { pgTable, text, serial, integer, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Roles
export const ROLES = {
  SALES: "sales",
  TECH: "tech",
  ADMIN: "admin",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

// Rejection Reasons for Tech Response
export const REJECTION_REASONS = {
  BOX_BROKEN: "بوكس معطل",
  BOX_FULL: "بوكس مليان",
  NO_NETWORK: "لا توجد شبكة",
  OTHER: "أخرى",
} as const;

export type RejectionReason = typeof REJECTION_REASONS[keyof typeof REJECTION_REASONS];

// Users Table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull(), // sales, tech, admin
  createdAt: timestamp("created_at").defaultNow(),
});

// Orders Table
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  // Sales Inputs
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerAddress: text("customer_address").notNull(),
  salesId: integer("sales_id").references(() => users.id).notNull(),
  salesName: text("sales_name").notNull(), // Denormalized for easier display/export

  // Tech Inputs
  status: text("status").default("pending").notNull(), // pending, feasible, not_feasible
  isFeasible: boolean("is_feasible"),
  rejectionReason: text("rejection_reason"), // Required if isFeasible is false
  cabinNumber: text("cabin_number"),
  boxNumber: text("box_number"),
  nearestBoxDistance: text("nearest_box_distance"), // Required if rejectionReason is "بوكس مليان"
  additionalNotes: text("additional_notes"), // Required if rejectionReason is "أخرى"
  techId: integer("tech_id").references(() => users.id),
  techName: text("tech_name"),
  techResponseAt: timestamp("tech_response_at"),

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
  techResponseAt: true
});

export const updateOrderSchema = createInsertSchema(orders).pick({
  isFeasible: true,
  rejectionReason: true,
  cabinNumber: true,
  boxNumber: true,
  nearestBoxDistance: true,
  additionalNotes: true,
}).partial();

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;

// WebSocket Events
export const WS_EVENTS = {
  ORDER_UPDATE: 'ORDER_UPDATE',
  ORDER_CREATE: 'ORDER_CREATE',
} as const;

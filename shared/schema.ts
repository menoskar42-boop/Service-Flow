import { pgTable, text, serial, integer, timestamp, boolean, bigint, unique, jsonb, date, real } from "drizzle-orm/pg-core";
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

// Notifications Table — alerts targeted at a specific recipient user
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  orderId: integer("order_id").references(() => orders.id),
  type: text("type").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;

// Work Orders Table — uploaded from تركيبات Excel by admin
export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  centralName: text("central_name").notNull(),
  workOrderId: bigint("work_order_id", { mode: "number" }).notNull(),
  phoneNumber: text("phone_number").notNull(),
  serviceType: text("service_type").notNull(),
  closeDate: timestamp("close_date").notNull(),
  itemName: text("item_name"),
  cableQuantity: text("cable_quantity"),
  techName: text("tech_name").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
}, (table) => ({
  // التفرّد على (اسم السنترال + رقم امر الشغل) بدل رقم الأمر وحده
  centralWoUniq: unique("work_orders_central_wo_uniq").on(table.centralName, table.workOrderId),
}));

export type WorkOrder = typeof workOrders.$inferSelect;

// Cable Entries Table — استكمال بيانات: كمية السلك التى يضيفها الفنى يدوياً
// لكل (رقم تليفون محلى + نوع امر الشغل). رقم امر الشغل فى تقرير التركيبات يكون مثل
// 88-2657290 لكن الفنى يُدخل 2657290 فقط — نخزّن المحلى (أرقام فقط) ونعيد بناء 88-.
export const cableEntries = pgTable("cable_entries", {
  id: serial("id").primaryKey(),
  phoneLocal: text("phone_local").notNull(),   // 2657290 (أرقام فقط، بدون 88-)
  phoneFull: text("phone_full").notNull(),     // 88-2657290
  workOrderType: text("work_order_type").notNull(), // "تركيب" | "نقل"
  cableQuantity: text("cable_quantity").notNull(),  // كمية السلك بالمتر (رقم، يقبل العشرى)
  createdById: integer("created_by_id").references(() => users.id),
  createdByName: text("created_by_name").notNull(),
  // قفل التعديل بعد طباعة تقرير أوامر الشغل
  printedAt: timestamp("printed_at", { withTimezone: true }),       // وقت الطباعة (يقفل التعديل)
  editUnlockedAt: timestamp("edit_unlocked_at", { withTimezone: true }), // منح الأدمن صلاحية تعديل (خلال 3 أيام)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // كل (رقم محلى + نوع) مرة واحدة — يُحدَّث عند إعادة الإدخال
  phoneTypeUniq: unique("cable_entries_phone_type_uniq").on(t.phoneLocal, t.workOrderType),
}));

export type CableEntry = typeof cableEntries.$inferSelect;

// Manual Close-By Table — فنى الإغلاق الذى يضيفه الأدمن يدوياً لشكوى فنى إغلاقها
// غير معروف. يصبح "المرجعية الأولى" فى عرض التجاوزات وفى إحصائيات الفنيين.
export const manualCloseBy = pgTable("manual_close_by", {
  id: serial("id").primaryKey(),
  complainNo: text("complain_no").notNull().unique(),
  techName: text("tech_name").notNull(),
  assignedById: integer("assigned_by_id").references(() => users.id),
  assignedByName: text("assigned_by_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ManualCloseBy = typeof manualCloseBy.$inferSelect;

// إسناد يدوى لفنى كود كابينة MSAN غير معروف (تقارير متعذرات OM)
export const msanTechOverrides = pgTable("msan_tech_overrides", {
  id: serial("id").primaryKey(),
  cabinCode: text("cabin_code").notNull().unique(),
  techName: text("tech_name").notNull(),
  assignedById: integer("assigned_by_id").references(() => users.id),
  assignedByName: text("assigned_by_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MsanTechOverride = typeof msanTechOverrides.$inferSelect;

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

// Maintenance Work Orders Table — from Work_Orders Excel (أوامر شغل الأعطال)
export const maintenanceOrders = pgTable("maintenance_orders", {
  id: serial("id").primaryKey(),
  centralName: text("central_name").notNull(),
  workOrderId: bigint("work_order_id", { mode: "number" }).notNull(),
  phoneNumber: text("phone_number").notNull(),
  workOrderType: text("work_order_type"),
  stage: text("stage"),
  status: text("status"),
  priority: text("priority"),
  currentWorkspec: text("current_workspec"),
  notes: text("notes"),
  description: text("description"),
  creationDate: timestamp("creation_date"),
  mobile: text("mobile"),
  customerName: text("customer_name"),
  address: text("address"),
  referenceNo: text("reference_no"),
  exchCabinet: text("exch_cabinet"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
}, (t) => ({
  uniq: unique("maintenance_orders_central_wo_uniq").on(t.centralName, t.workOrderId),
}));

export type MaintenanceOrder = typeof maintenanceOrders.$inferSelect;

// Ticket Queue Table — from TicketQueue Excel (شكاوى)
export const ticketQueue = pgTable("ticket_queue", {
  id: serial("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  centralCode: text("central_code").notNull(),
  centralName: text("central_name").notNull(),
  phoneNumber: text("phone_number"),
  complaintTime: timestamp("complaint_time"),
  techCode: text("tech_code"),
  lineTypeCode: text("line_type_code"),
  cabinetNo: text("cabinet_no"),
  priorityCode: text("priority_code"),
  closeDate: timestamp("close_date"),
  operationType: text("operation_type"),
  complainTypeName: text("complain_type_name"),
  statusCode: text("status_code"),
  onu: text("onu"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
}, (t) => ({
  uniq: unique("ticket_queue_ticket_status_uniq").on(t.ticketId, t.statusCode),
}));

export type TicketQueueRow = typeof ticketQueue.$inferSelect;

// Complaint Details Table — from التفاصيل sheet (430D_Trial Excel)
export const complaintDetails = pgTable("complaint_details", {
  id: serial("id").primaryKey(),
  complainNo: text("complain_no").notNull().unique(),
  sector: text("sector"),
  region: text("region"),
  exchangeName: text("exchange_name"),
  centralName: text("central_name"),
  phoneNumber: text("phone_number"),
  msanId: text("msan_id"),
  cabinetNo: text("cabinet_no"),
  complainTime: timestamp("complain_time"),
  closeTime: timestamp("close_time"),
  closeCode: text("close_code"),
  statusCode: text("status_code"),
  complainSideName: text("complain_side_name"),
  complainTypeName: text("complain_type_name"),
  closeBy: text("close_by"),
  timeTillNow: real("time_till_now"),
  timeTillNowFull: real("time_till_now_full"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export type ComplaintDetail = typeof complaintDetails.$inferSelect;

// Start-of-day + current snapshot companions for complaint_details (430D التفاصيل).
export const complaintDetailsSod = pgTable("complaint_details_sod", {
  id: serial("id").primaryKey(),
  complainNo: text("complain_no").notNull().unique(),
  sector: text("sector"),
  region: text("region"),
  exchangeName: text("exchange_name"),
  phoneNumber: text("phone_number"),
  msanId: text("msan_id"),
  cabinetNo: text("cabinet_no"),
  complainTime: timestamp("complain_time"),
  closeTime: timestamp("close_time"),
  closeCode: text("close_code"),
  statusCode: text("status_code"),
  complainSideName: text("complain_side_name"),
  complainTypeName: text("complain_type_name"),
  closeBy: text("close_by"),
  timeTillNow: real("time_till_now"),
  timeTillNowFull: real("time_till_now_full"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export const complaintDetailsCurrent = pgTable("complaint_details_current", {
  id: serial("id").primaryKey(),
  complainNo: text("complain_no").notNull().unique(),
  sector: text("sector"),
  region: text("region"),
  exchangeName: text("exchange_name"),
  phoneNumber: text("phone_number"),
  msanId: text("msan_id"),
  cabinetNo: text("cabinet_no"),
  complainTime: timestamp("complain_time"),
  closeTime: timestamp("close_time"),
  closeCode: text("close_code"),
  statusCode: text("status_code"),
  complainSideName: text("complain_side_name"),
  complainTypeName: text("complain_type_name"),
  closeBy: text("close_by"),
  timeTillNow: real("time_till_now"),
  timeTillNowFull: real("time_till_now_full"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

// Remaining (open) Complaints Table — from تفاصيل متبقى sheet (430D_Trial Excel)
// Replaced in full on each upload (snapshot of currently-open faults).
export const remainingComplaints = pgTable("remaining_complaints", {
  id: serial("id").primaryKey(),
  complainNo: text("complain_no").notNull().unique(),
  sector: text("sector"),
  region: text("region"),
  exchangeName: text("exchange_name"),
  phoneNumber: text("phone_number"),
  complainTime: timestamp("complain_time"),
  dispatchTime: timestamp("dispatch_time"),
  dispatchUser: text("dispatch_user"),
  msanId: text("msan_id"),
  closeTime: timestamp("close_time"),
  closeCode: text("close_code"),
  closeBy: text("close_by"),
  statusCode: text("status_code"),
  cabinetNo: text("cabinet_no"),
  complainType: text("complain_type"),
  timeTillNow: real("time_till_now"),
  timeTillNowFull: real("time_till_now_full"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export type RemainingComplaint = typeof remainingComplaints.$inferSelect;

// Start-of-day + current snapshot companions for remaining_complaints (تفاصيل متبقى).
export const remainingComplaintsSod = pgTable("remaining_complaints_sod", {
  id: serial("id").primaryKey(),
  complainNo: text("complain_no").notNull().unique(),
  sector: text("sector"),
  region: text("region"),
  exchangeName: text("exchange_name"),
  phoneNumber: text("phone_number"),
  complainTime: timestamp("complain_time"),
  dispatchTime: timestamp("dispatch_time"),
  dispatchUser: text("dispatch_user"),
  msanId: text("msan_id"),
  closeTime: timestamp("close_time"),
  closeCode: text("close_code"),
  closeBy: text("close_by"),
  statusCode: text("status_code"),
  cabinetNo: text("cabinet_no"),
  complainType: text("complain_type"),
  timeTillNow: real("time_till_now"),
  timeTillNowFull: real("time_till_now_full"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export const remainingComplaintsCurrent = pgTable("remaining_complaints_current", {
  id: serial("id").primaryKey(),
  complainNo: text("complain_no").notNull().unique(),
  sector: text("sector"),
  region: text("region"),
  exchangeName: text("exchange_name"),
  phoneNumber: text("phone_number"),
  complainTime: timestamp("complain_time"),
  dispatchTime: timestamp("dispatch_time"),
  dispatchUser: text("dispatch_user"),
  msanId: text("msan_id"),
  closeTime: timestamp("close_time"),
  closeCode: text("close_code"),
  closeBy: text("close_by"),
  statusCode: text("status_code"),
  cabinetNo: text("cabinet_no"),
  complainType: text("complain_type"),
  timeTillNow: real("time_till_now"),
  timeTillNowFull: real("time_till_now_full"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

// FTTH / ADSL Subscribers Table — from FTTH-Subscibers sheet (full replace each upload)
export const ftthSubscribers = pgTable("ftth_subscribers", {
  id: serial("id").primaryKey(),
  sector: text("sector"),
  region: text("region"),
  mainEx: text("main_ex"),
  subEx: text("sub_ex"),
  fccCode: text("fcc_code"),
  type: text("type"),
  msanGponCode: text("msan_gpon_code"),
  fbbSubs: integer("fbb_subs"),
  fvSubs: integer("fv_subs"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export type FtthSubscriber = typeof ftthSubscribers.$inferSelect;

// حاله 138 Table — DSL fault cases (full replace each upload)
export const case138 = pgTable("case_138", {
  id: serial("id").primaryKey(),
  centralName: text("central_name"),
  phoneShort: text("phone_short"),
  complainNo: text("complain_no"),
  score: integer("score"),
  currentSpeed: text("current_speed"),
  maxSpeed: text("max_speed"),
  fullPhone: text("full_phone"),
  accountNo: text("account_no"),
  statusCode: text("status_code"),
  cabinetNo: text("cabinet_no"),
  boxNo: text("box_no"),
  complainTypeName: text("complain_type_name"),
  complainTime: timestamp("complain_time"),
  customerName: text("customer_name"),
  dispatchTime: timestamp("dispatch_time"),
  techCode: text("tech_code"),
  closeDate: timestamp("close_date"),
  onu: text("onu"),
  faultType: text("fault_type"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export type Case138 = typeof case138.$inferSelect;

// الفنيين بأرقام الكباين — full replace each upload
export const cabinetTechnicians = pgTable("cabinet_technicians", {
  id: serial("id").primaryKey(),
  centralName: text("central_name"),
  cabinNumber: text("cabin_number"),
  workerCode: text("worker_code"),
  hayaKarima: text("haya_karima"),
  regionName: text("region_name"),
  active: text("active"),
  centralFinish: text("central_finish"),
  villageCode: text("village_code"),
  cabinCode: text("cabin_code"),
  idu: text("idu"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export type CabinetTechnician = typeof cabinetTechnicians.$inferSelect;

// أسماء الفنيين (كود العامل + الاسم) — full replace each upload
export const technicianNames = pgTable("technician_names", {
  id: serial("id").primaryKey(),
  workerCode: text("worker_code").notNull(),
  techName: text("tech_name").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export type TechnicianName = typeof technicianNames.$inferSelect;

// منافذ MSAN (phone_ports) — مفتاحها رقم التليفون (upsert على كل رفعة)
export const phonePorts = pgTable("phone_ports", {
  id: serial("id").primaryKey(),
  phoneNumber: text("phone_number").notNull().unique(),
  areaCode: text("area_code"),
  msanCode: text("msan_code"),
  frame: text("frame"),
  shelf: text("shelf"),
  slot: text("slot"),
  portNumber: text("port_number"),
  portType: text("port_type"),
  voiceStatus: text("voice_status"),
  dataStatus: text("data_status"),
  operator: text("operator"),
  onu: text("onu"),                      // ONU من ملف بيانات التليفونات/المنافذ
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export type PhonePort = typeof phonePorts.$inferSelect;

// ─── Ticket snapshot tables (mirror ticket_queue + onu) ─────────────────────
// Defined here so drizzle-kit treats them as managed and never drops them on
// publish. Column types mirror the raw SQL in server/db.ts (timestamptz).
const ticketCols = () => ({
  id: serial("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  centralCode: text("central_code"),
  centralName: text("central_name"),
  phoneNumber: text("phone_number"),
  complaintTime: timestamp("complaint_time", { withTimezone: true }),
  techCode: text("tech_code"),
  lineTypeCode: text("line_type_code"),
  cabinetNo: text("cabinet_no"),
  priorityCode: text("priority_code"),
  closeDate: timestamp("close_date", { withTimezone: true }),
  operationType: text("operation_type"),
  complainTypeName: text("complain_type_name"),
  statusCode: text("status_code"),
  onu: text("onu"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export const ticketDslSod = pgTable("ticket_dsl_sod", ticketCols(), (t) => ({
  uniq: unique("ticket_dsl_sod_uniq").on(t.ticketId, t.statusCode),
}));
export const ticketDslCurrent = pgTable("ticket_dsl_current", ticketCols());
export const ticketFtth = pgTable("ticket_ftth", ticketCols(), (t) => ({
  uniq: unique("ticket_ftth_uniq").on(t.ticketId, t.statusCode),
}));
export const ticketFtthSod = pgTable("ticket_ftth_sod", ticketCols(), (t) => ({
  uniq: unique("ticket_ftth_sod_uniq").on(t.ticketId, t.statusCode),
}));
export const ticketFtthCurrent = pgTable("ticket_ftth_current", ticketCols());

// ─── WFM work-order snapshot tables (mirror maintenance_orders) ─────────────
const wfmCols = () => ({
  id: serial("id").primaryKey(),
  centralName: text("central_name").notNull(),
  workOrderId: bigint("work_order_id", { mode: "number" }).notNull(),
  phoneNumber: text("phone_number").notNull(),
  workOrderType: text("work_order_type"),
  stage: text("stage"),
  status: text("status"),
  priority: text("priority"),
  currentWorkspec: text("current_workspec"),
  notes: text("notes"),
  description: text("description"),
  creationDate: timestamp("creation_date", { withTimezone: true }),
  mobile: text("mobile"),
  customerName: text("customer_name"),
  address: text("address"),
  referenceNo: text("reference_no"),
  exchCabinet: text("exch_cabinet"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export const wfmSod = pgTable("wfm_sod", wfmCols(), (t) => ({
  uniq: unique("wfm_sod_central_wo_uniq").on(t.centralName, t.workOrderId),
}));
export const wfmCurrent = pgTable("wfm_current", wfmCols());

// ─── الأرشيف اليومى للمنتظمات (أعطال/تركيبات/معاينات) ───────────────────────
export const regularizedDaily = pgTable("regularized_daily", {
  id: serial("id").primaryKey(),
  snapshotDate: date("snapshot_date").notNull(),
  category: text("category").notNull(),
  itemKey: text("item_key").notNull(),
  centralName: text("central_name"),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniq: unique("regularized_daily_cat_key_uniq").on(t.category, t.itemKey),
}));

// ─── FTTH provisioning orders (ملف Order): تاريخي + حالي + أرشيف سنوي ────────
const ftthOrderCols = () => ({
  id: serial("id").primaryKey(),
  serviceOrderId: text("service_order_id").notNull(),
  customerOrderId: text("customer_order_id"),
  product: text("product"),
  serviceNumber: text("service_number"),
  customerName: text("customer_name"),
  orderStatus: text("order_status"),
  orderCreateTime: timestamp("order_create_time", { withTimezone: true }),
  exchangeName: text("exchange_name"),
  serviceType: text("service_type"),
  msanCode: text("msan_code"),
  areaCode: text("area_code"),
  customerMobile: text("customer_mobile"),
  currentActivity: text("current_activity"),
  errorName: text("error_name"),
  governorate: text("governorate"),
  lineType: text("line_type"),
  fccExchange: text("fcc_exchange"),
  serialNumber: text("serial_number"),   // المسلسل (عمود Serial Number)
  serviceName: text("service_name"),     // Service Name (مثل FV Survey)
  installAddress: text("install_address"), // عنوان التركيب من ملف OM
  raw: jsonb("raw"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id),
});

export const ftthOrders = pgTable("ftth_orders", ftthOrderCols(), (t) => ({
  uniq: unique("ftth_orders_uniq").on(t.serviceOrderId),
}));
export const ftthOrdersCurrent = pgTable("ftth_orders_current", ftthOrderCols());
export const ftthOrdersSoy = pgTable("ftth_orders_soy", ftthOrderCols()); // بداية السنة (يُرفع يدوياً)
export const ftthOrdersArchive = pgTable("ftth_orders_archive", {
  archivedYear: integer("archived_year"),
  ...ftthOrderCols(),
});

// line_accounts — أرقام الأكونت للخطوط (مزامنة من شيت 138 + إدخال يدوى)
export const lineAccounts = pgTable("line_accounts", {
  id: serial("id").primaryKey(),
  fullPhone: text("full_phone").notNull().unique(),
  accountNo: text("account_no").notNull(),
  source: text("source").notNull().default("manual"), // 'case_138' | 'manual'
  updatedById: integer("updated_by_id").references(() => users.id),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LineAccount = typeof lineAccounts.$inferSelect;

// line_account_edits — سجل تاريخى لكل تعديل على رقم الأكونت
export const lineAccountEdits = pgTable("line_account_edits", {
  id: serial("id").primaryKey(),
  fullPhone: text("full_phone").notNull(),
  oldAccountNo: text("old_account_no"),
  newAccountNo: text("new_account_no").notNull(),
  editedById: integer("edited_by_id").references(() => users.id),
  editedByName: text("edited_by_name"),
  editedAt: timestamp("edited_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LineAccountEdit = typeof lineAccountEdits.$inferSelect;

// lines_no_account — خطوط معلَّمة يدوياً بأنها "بدون رقم أكونت" (تُخفى من تقرير الخطوط بدون أكونت)
export const linesNoAccount = pgTable("lines_no_account", {
  fullPhone: text("full_phone").primaryKey(),
  markedById: integer("marked_by_id").references(() => users.id),
  markedByName: text("marked_by_name"),
  markedAt: timestamp("marked_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LineNoAccount = typeof linesNoAccount.$inferSelect;

// WebSocket Events
export const WS_EVENTS = {
  ORDER_UPDATE: 'ORDER_UPDATE',
  ORDER_CREATE: 'ORDER_CREATE',
  NOTIFICATION: 'NOTIFICATION',
} as const;

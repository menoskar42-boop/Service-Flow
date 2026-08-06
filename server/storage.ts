import { users, orders, notifications, type User, type InsertUser, type Order, type InsertOrder, type UpdateOrder, type UpdateExternal, type Notification, ORDER_STATUS } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, count } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(id: number, password: string): Promise<User>;
  updateUserWorkerCode(id: number, workerCode: string): Promise<User>;
  deleteUser(id: number): Promise<void>;
  suspendUser(id: number, suspended: boolean): Promise<User>;
  getUsers(): Promise<User[]>;
  
  getOrders(): Promise<Order[]>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrdersBySalesId(salesId: number): Promise<Order[]>;
  getOrdersForExternal(): Promise<Order[]>;
  createOrder(order: InsertOrder & { salesId: number; salesName: string }): Promise<Order>;
  updateOrder(id: number, order: UpdateOrder & { 
    status?: string, 
    techId?: number, 
    techName?: string, 
    techResponseAt?: Date 
  }): Promise<Order>;
  resetTechResponse(id: number): Promise<Order>;
  updateContractStatus(id: number, contractStatus: string): Promise<Order>;
  requestExternalReview(id: number): Promise<Order>;
  updateExternalResponse(id: number, data: UpdateExternal & {
    externalId: number;
    externalName: string;
    externalResponseAt: Date;
    status: string;
  }): Promise<Order>;

  createNotification(data: { userId: number; orderId?: number; type: string; message: string }): Promise<Notification>;
  getNotificationsByUser(userId: number): Promise<Notification[]>;
  getUnreadCount(userId: number): Promise<number>;
  markNotificationRead(id: number, userId: number): Promise<void>;
  markAllNotificationsRead(userId: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserPassword(id: number, password: string): Promise<User> {
    const [user] = await db.update(users)
      .set({ password })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUserWorkerCode(id: number, workerCode: string): Promise<User> {
    const [user] = await db.update(users)
      .set({ workerCode })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async suspendUser(id: number, suspended: boolean): Promise<User> {
    const [user] = await db.update(users)
      .set({ suspended })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getOrders(): Promise<Order[]> {
    return await db.select().from(orders).orderBy(desc(orders.createdAt));
  }

  async getOrder(id: number): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async getOrdersBySalesId(salesId: number): Promise<Order[]> {
    return await db.select().from(orders).where(eq(orders.salesId, salesId)).orderBy(desc(orders.createdAt));
  }

  async getOrdersForExternal(): Promise<Order[]> {
    return await db.select().from(orders)
      .where(eq(orders.status, ORDER_STATUS.NEEDS_EXTERNAL))
      .orderBy(desc(orders.createdAt));
  }

  async createOrder(insertOrder: InsertOrder & { salesId: number; salesName: string }): Promise<Order> {
    const [order] = await db.insert(orders).values(insertOrder).returning();
    return order;
  }

  async updateOrder(id: number, update: UpdateOrder & { 
    status?: string, 
    techId?: number, 
    techName?: string, 
    techResponseAt?: Date 
  }): Promise<Order> {
    const [order] = await db.update(orders)
      .set(update)
      .where(eq(orders.id, id))
      .returning();
    return order;
  }

  async resetTechResponse(id: number): Promise<Order> {
    const [order] = await db.update(orders)
      .set({
        status: "pending",
        isFeasible: null,
        rejectionReason: null,
        cabinNumber: null,
        boxNumber: null,
        nearestBoxDistance: null,
        additionalNotes: null,
        centralName: null,
        techId: null,
        techName: null,
        techResponseAt: null,
      })
      .where(eq(orders.id, id))
      .returning();
    return order;
  }

  async updateContractStatus(id: number, contractStatus: string): Promise<Order> {
    const [order] = await db.update(orders)
      .set({ contractStatus })
      .where(eq(orders.id, id))
      .returning();
    return order;
  }

  async requestExternalReview(id: number): Promise<Order> {
    const [order] = await db.update(orders)
      .set({ status: ORDER_STATUS.NEEDS_EXTERNAL })
      .where(eq(orders.id, id))
      .returning();
    return order;
  }

  async updateExternalResponse(id: number, data: UpdateExternal & {
    externalId: number;
    externalName: string;
    externalResponseAt: Date;
    status: string;
  }): Promise<Order> {
    const [order] = await db.update(orders)
      .set(data)
      .where(eq(orders.id, id))
      .returning();
    return order;
  }

  async createNotification(data: { userId: number; orderId?: number; type: string; message: string }): Promise<Notification> {
    const [notification] = await db.insert(notifications).values(data).returning();
    return notification;
  }

  async getNotificationsByUser(userId: number): Promise<Notification[]> {
    return db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(100);
  }

  async getUnreadCount(userId: number): Promise<number> {
    const [row] = await db.select({ c: count() }).from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return row?.c ?? 0;
  }

  async markNotificationRead(id: number, userId: number): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }
}

export const storage = new DatabaseStorage();

import { users, orders, type User, type InsertUser, type Order, type InsertOrder, type UpdateOrder } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(id: number, password: string): Promise<User>;
  deleteUser(id: number): Promise<void>;
  getUsers(): Promise<User[]>;
  
  getOrders(): Promise<Order[]>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrdersBySalesId(salesId: number): Promise<Order[]>;
  createOrder(order: InsertOrder & { salesId: number; salesName: string }): Promise<Order>;
  updateOrder(id: number, order: UpdateOrder & { 
    status?: string, 
    techId?: number, 
    techName?: string, 
    techResponseAt?: Date 
  }): Promise<Order>;
  resetTechResponse(id: number): Promise<Order>;
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

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
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
}

export const storage = new DatabaseStorage();

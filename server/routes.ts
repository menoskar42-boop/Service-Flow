import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { pool } from "./db";
import { insertOrderSchema, updateOrderSchema, updateExternalResponseSchema, ROLES, WS_EVENTS, CONTRACT_STATUS, ORDER_STATUS } from "@shared/schema";
import { api } from "@shared/routes";
import { z } from "zod";
import multer from "multer";
import * as XLSX from "xlsx";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import MemoryStore from "memorystore";

const scryptAsync = promisify(scrypt);
const SessionStore = MemoryStore(session);

// Work-order reports are restricted to these centrals (الغنايم وفروعها).
// Matching is tolerant of differences in dashes, spaces, hamza, ة/ه, ى/ي.
const normalizeCentral = (s: any): string =>
  String(s ?? "")
    .replace(/[ً-ْٰ]/g, "")   // tashkeel/diacritics
    .replace(/ـ/g, "")                    // tatweel ـ
    .replace(/[إأآٱ]/g, "ا")                    // alef variants → ا
    .replace(/ى/g, "ي")                         // alef maksura → ي
    .replace(/ة/g, "ه")                         // taa marbuta → ه
    .replace(/[ؤئء]/g, "")                       // hamza forms removed
    .replace(/[\s_]/g, "")                       // spaces/underscore
    .replace(/[-‐-―−]/g, "")      // all dash types
    .trim();

const ALLOWED_WORK_ORDER_CENTRALS = new Set(
  ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"].map(
    normalizeCentral,
  ),
);

const isAllowedCentral = (name: any): boolean =>
  ALLOWED_WORK_ORDER_CENTRALS.has(normalizeCentral(name));

// Central code (Organization / Field3 in the attached sheet) → Arabic name.
// The work-orders import derives the central from this code, so sub-centrals
// that share the same generic name in the file are still separated correctly.
const CENTRAL_CODE_TO_NAME: Record<string, string> = {
  GHNAT: "الغنايم",
  AMZAT: "الغنايم-العزايزة",
  DRGAT: "الغنايم-دير الجنادله",
  NGOAT: "الغنايم-نجع العمدة",
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // === WebSocket Setup ===
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcast = (data: any) => {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    ws.on('error', console.error);
  });

  // Notify the sales rep who created the order + all admins when an order
  // becomes feasible (by tech or external affairs).
  const notifyOrderFeasible = async (order: any, source: "tech" | "external") => {
    const sourceLabel = source === "external" ? "الشئون الخارجية" : "القسم الفني";
    const recipientIds = new Set<number>();
    if (order.salesId) recipientIds.add(order.salesId);
    const admins = (await storage.getUsers()).filter((u) => u.role === ROLES.ADMIN);
    admins.forEach((a) => recipientIds.add(a.id));

    await Promise.all(
      Array.from(recipientIds).map((userId) =>
        storage.createNotification({
          userId,
          orderId: order.id,
          type: "order_feasible",
          message: `طلب العميل ${order.customerName} أصبح قابلاً للتنفيذ (${sourceLabel})`,
        }),
      ),
    );
    broadcast({ type: WS_EVENTS.NOTIFICATION });
  };

  // === Auth Setup ===
  async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  }

  async function comparePassword(supplied: string, stored: string) {
    const [hashed, salt] = stored.split(".");
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  }

  // Seed users if they don't exist
  const seedUsers = async () => {
    const roles = [
      { user: "sales", pass: "sales", role: ROLES.SALES },
      { user: "tech", pass: "tech", role: ROLES.TECH },
      { user: "admin", pass: "admin", role: ROLES.ADMIN },
    ];

    for (const r of roles) {
      const existing = await storage.getUserByUsername(r.user);
      if (!existing) {
        const password = await hashPassword(r.pass);
        await storage.createUser({ username: r.user, password, role: r.role });
        console.log(`Created user: ${r.user}`);
      }
    }
  };
  seedUsers();

  app.use(
    session({
      store: new SessionStore({ checkPeriod: 86400000 }),
      secret: "super-secret-session-key",
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 86400000 },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user) return done(null, false);
        if (user.suspended) return done(null, false, { message: "User is suspended" });
        const isValid = await comparePassword(password, user.password);
        if (!isValid) return done(null, false);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  // === Auth Routes ===
  app.post(api.auth.login.path, passport.authenticate("local"), (req, res) => {
    res.json(req.user);
  });

  app.post(api.auth.logout.path, (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logged out" });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });

  // === Middleware ===
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) return next();
    res.sendStatus(401);
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && req.user.role === ROLES.ADMIN) return next();
    res.status(403).json({ message: "Admin access required" });
  };

  const requireTechOrAdmin = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && (req.user.role === ROLES.TECH || req.user.role === ROLES.ADMIN)) return next();
    res.status(403).json({ message: "Tech or Admin access required" });
  };

  const requireDataManager = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && req.user.role === ROLES.DATA_MANAGER) return next();
    res.status(403).json({ message: "Data Manager access required" });
  };

  // === User Management Routes ===
  app.get(api.users.list.path, requireAuth, requireAdmin, async (req, res) => {
    const userList = await storage.getUsers();
    const sanitized = userList.map(u => ({ id: u.id, username: u.username, role: u.role, suspended: u.suspended, createdAt: u.createdAt }));
    res.json(sanitized);
  });

  app.post(api.users.create.path, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { username, password, role } = req.body;
      
      if (!username || !password || !role) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      const validRoles = [ROLES.SALES, ROLES.TECH, ROLES.EXTERNAL, ROLES.DATA_MANAGER];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: "Role must be sales, tech, external, or data_manager" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({ username, password: hashedPassword, role });
      res.status(201).json({ id: user.id, username: user.username, role: user.role });
    } catch (e) {
      res.status(500).json({ message: "Error creating user" });
    }
  });

  app.put(api.users.changePassword.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const dbUser = await storage.getUser(user.id);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const isValid = await comparePassword(currentPassword, dbUser.password);
      if (!isValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUserPassword(user.id, hashedPassword);
      res.json({ message: "Password updated successfully" });
    } catch (e) {
      res.status(500).json({ message: "Error updating password" });
    }
  });

  app.delete(api.users.delete.path, requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const currentUser = req.user as any;

      if (userId === currentUser.id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      const userToDelete = await storage.getUser(userId);
      if (!userToDelete) {
        return res.status(404).json({ message: "User not found" });
      }

      await storage.deleteUser(userId);
      res.json({ message: "User deleted successfully" });
    } catch (e) {
      res.status(500).json({ message: "Error deleting user" });
    }
  });

  app.put(api.users.suspend.path, requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const currentUser = req.user as any;
      const { suspended } = req.body;

      if (userId === currentUser.id) {
        return res.status(400).json({ message: "Cannot suspend your own account" });
      }

      const userToSuspend = await storage.getUser(userId);
      if (!userToSuspend) {
        return res.status(404).json({ message: "User not found" });
      }

      const updatedUser = await storage.suspendUser(userId, suspended);
      res.json({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role, suspended: updatedUser.suspended });
    } catch (e) {
      res.status(500).json({ message: "Error updating user suspension" });
    }
  });

  // === Order Routes ===

  app.get(api.orders.list.path, requireAuth, async (req, res) => {
    const user = req.user as any;

    if (user.role === ROLES.SALES) {
      const allOrders = await storage.getOrdersBySalesId(user.id);
      // Sales sees non-contracted orders only
      const filteredOrders = allOrders.filter(o => o.contractStatus === CONTRACT_STATUS.NOT_CONTRACTED);
      return res.json(filteredOrders);
    }

    if (user.role === ROLES.EXTERNAL) {
      // External sees only orders in needs_external state
      const externalOrders = await storage.getOrdersForExternal();
      return res.json(externalOrders);
    }

    if (user.role === ROLES.TECH) {
      // Tech sees all orders EXCEPT those in needs_external state
      const allOrders = await storage.getOrders();
      const techOrders = allOrders.filter(o => o.status !== ORDER_STATUS.NEEDS_EXTERNAL);
      return res.json(techOrders);
    }

    // Admin sees all orders
    const orders = await storage.getOrders();
    res.json(orders);
  });

  app.post(api.orders.create.path, requireAuth, async (req, res) => {
    const user = req.user as any;
    if (user.role !== ROLES.SALES && user.role !== ROLES.ADMIN) {
      return res.status(403).json({ message: "Only Sales can create orders" });
    }

    try {
      const input = insertOrderSchema.parse(req.body);
      const order = await storage.createOrder({
        ...input,
        salesId: user.id,
        salesName: user.username,
      });
      
      broadcast({ type: WS_EVENTS.ORDER_CREATE, payload: order });
      res.status(201).json(order);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        throw e;
      }
    }
  });

  app.put(api.orders.update.path, requireAuth, async (req, res) => {
    const user = req.user as any;
    // Only Tech (or Admin) can update status/feasibility
    if (user.role !== ROLES.TECH && user.role !== ROLES.ADMIN) {
      return res.status(403).json({ message: "Only Tech can update order status" });
    }

    try {
      const id = parseInt(req.params.id);
      const input = updateOrderSchema.parse(req.body);
      
      // Determine status
      let status = "pending";
      if (input.isFeasible === true) status = "feasible";
      if (input.isFeasible === false) status = "not_feasible";

      const order = await storage.updateOrder(id, {
        ...input,
        status,
        techId: user.id,
        techName: user.username,
        techResponseAt: new Date(),
      });

      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      if (status === "feasible") {
        await notifyOrderFeasible(order, "tech");
      }
      res.json(order);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        throw e;
      }
    }
  });

  app.post(api.orders.resetTechResponse.path, requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      const order = await storage.resetTechResponse(id);
      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      res.json(order);
    } catch (e) {
      res.status(500).json({ message: "Error resetting order" });
    }
  });

  app.put(api.orders.updateContractStatus.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id);
      const { contractStatus } = req.body;

      if (contractStatus !== CONTRACT_STATUS.CONTRACTED && contractStatus !== CONTRACT_STATUS.NOT_CONTRACTED) {
        return res.status(400).json({ message: "Invalid contract status" });
      }

      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (user.role === ROLES.SALES) {
        if (existingOrder.salesId !== user.id) {
          return res.status(403).json({ message: "Cannot update orders of other sales" });
        }
        if (contractStatus !== CONTRACT_STATUS.CONTRACTED) {
          return res.status(403).json({ message: "Sales can only mark as contracted" });
        }
        if (existingOrder.status === "pending") {
          return res.status(400).json({ message: "Cannot mark as contracted before tech response" });
        }
      } else if (user.role !== ROLES.ADMIN) {
        return res.status(403).json({ message: "Only Sales or Admin can update contract status" });
      }

      const order = await storage.updateContractStatus(id, contractStatus);
      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      res.json(order);
    } catch (e) {
      res.status(500).json({ message: "Error updating contract status" });
    }
  });

  // === External Review Routes ===

  app.post(api.orders.requestExternalReview.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id);

      if (user.role !== ROLES.SALES && user.role !== ROLES.ADMIN) {
        return res.status(403).json({ message: "Only Sales or Admin can request external review" });
      }

      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (user.role === ROLES.SALES && existingOrder.salesId !== user.id) {
        return res.status(403).json({ message: "Cannot request external review for other sales orders" });
      }

      if (existingOrder.status !== ORDER_STATUS.NOT_FEASIBLE) {
        return res.status(400).json({ message: "External review can only be requested for not_feasible orders" });
      }

      const order = await storage.requestExternalReview(id);
      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      res.json(order);
    } catch (e) {
      res.status(500).json({ message: "Error requesting external review" });
    }
  });

  app.put(api.orders.externalResponse.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id);

      if (user.role !== ROLES.EXTERNAL && user.role !== ROLES.ADMIN) {
        return res.status(403).json({ message: "Only External Affairs can respond to orders" });
      }

      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (existingOrder.status !== ORDER_STATUS.NEEDS_EXTERNAL) {
        return res.status(400).json({ message: "Order is not awaiting external review" });
      }

      const input = updateExternalResponseSchema.parse(req.body);
      const newStatus = input.isFeasibleExternal ? ORDER_STATUS.EXTERNAL_FEASIBLE : ORDER_STATUS.EXTERNAL_NOT_FEASIBLE;

      const order = await storage.updateExternalResponse(id, {
        ...input,
        externalId: user.id,
        externalName: user.username,
        externalResponseAt: new Date(),
        status: newStatus,
      });

      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      if (newStatus === ORDER_STATUS.EXTERNAL_FEASIBLE) {
        await notifyOrderFeasible(order, "external");
      }
      res.json(order);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        res.status(500).json({ message: "Error saving external response" });
      }
    }
  });

  // === Notifications ===
  app.get("/api/notifications", requireAuth, async (req, res) => {
    const user = req.user as any;
    const [items, unread] = await Promise.all([
      storage.getNotificationsByUser(user.id),
      storage.getUnreadCount(user.id),
    ]);
    res.json({ items, unread });
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
    const user = req.user as any;
    await storage.markNotificationRead(parseInt(req.params.id), user.id);
    res.json({ success: true });
  });

  app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
    const user = req.user as any;
    await storage.markAllNotificationsRead(user.id);
    res.json({ success: true });
  });

  // === Phone Lines Reports ===

  // GET /api/phone-lines/filter-options — returns unique centrals, cabins per central, boxes per central+cabin
  app.get("/api/phone-lines/filter-options", requireAuth, async (req, res) => {
    const { rows } = await pool.query(`
      SELECT DISTINCT central, cabin_number, box_number
      FROM phone_lines
      WHERE central IS NOT NULL AND central <> ''
    `);

    const centralSet = new Set<string>();
    const cabinMap = new Map<string, Set<string>>();
    const boxMap = new Map<string, Set<string>>();

    for (const r of rows) {
      const central = r.central || "";
      const cabin = r.cabin_number || "";
      const box = r.box_number || "";
      if (central) centralSet.add(central);
      if (central && cabin) {
        if (!cabinMap.has(central)) cabinMap.set(central, new Set());
        cabinMap.get(central)!.add(cabin);
      }
      if (central && cabin && box) {
        const key = `${central}||${cabin}`;
        if (!boxMap.has(key)) boxMap.set(key, new Set());
        boxMap.get(key)!.add(box);
      }
    }

    const centrals = Array.from(centralSet).sort((a, b) => a.localeCompare(b, "ar"));
    const cabins: Record<string, string[]> = {};
    for (const [central, set] of cabinMap) {
      cabins[central] = Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
    }
    const boxes: Record<string, string[]> = {};
    for (const [key, set] of boxMap) {
      const sorted = Array.from(set).sort((a, b) => {
        const na = parseInt(a), nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        if (!isNaN(na)) return -1;
        if (!isNaN(nb)) return 1;
        return a.localeCompare(b);
      });
      boxes[key] = sorted;
    }

    res.json({ centrals, cabins, boxes });
  });

  // GET /api/phone-lines/dp-options — distinct dp_terminals for central+cabin+box
  app.get("/api/phone-lines/dp-options", requireAuth, async (req, res) => {
    const { central = "", cabin = "", box = "" } = req.query as Record<string, string>;
    if (!central || !cabin || !box) return res.json([]);
    const { rows } = await pool.query(
      `SELECT DISTINCT dp_terminal FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND box_number = $3 AND dp_terminal IS NOT NULL ORDER BY dp_terminal`,
      [central, cabin, box]
    );
    res.json(rows.map((r: any) => r.dp_terminal));
  });

  // GET /api/phone-lines/field-options — cascading options for edit form (cabins → boxes → dpTerminals)
  app.get("/api/phone-lines/field-options", requireAuth, async (req, res) => {
    const { central = "", cabin = "", box = "" } = req.query as Record<string, string>;
    const result: { cabins: string[]; boxes: string[]; dpTerminals: string[]; cabinetIns: string[] } = { cabins: [], boxes: [], dpTerminals: [], cabinetIns: [] };
    if (!central) return res.json(result);
    const { rows: cabinRows } = await pool.query(
      `SELECT DISTINCT cabin_number FROM phone_lines WHERE central = $1 AND cabin_number IS NOT NULL ORDER BY cabin_number`,
      [central]
    );
    result.cabins = cabinRows.map((r: any) => r.cabin_number);
    if (cabin) {
      const { rows: boxRows } = await pool.query(
        `SELECT DISTINCT box_number FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND box_number IS NOT NULL ORDER BY box_number`,
        [central, cabin]
      );
      result.boxes = boxRows.map((r: any) => r.box_number);
      const { rows: cabinInRows } = await pool.query(
        `SELECT DISTINCT cabinet_in FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND cabinet_in IS NOT NULL ORDER BY cabinet_in`,
        [central, cabin]
      );
      result.cabinetIns = cabinInRows.map((r: any) => r.cabinet_in);
      if (box) {
        const { rows: dpRows } = await pool.query(
          `SELECT DISTINCT dp_terminal FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND box_number = $3 AND dp_terminal IS NOT NULL ORDER BY dp_terminal`,
          [central, cabin, box]
        );
        result.dpTerminals = dpRows.map((r: any) => r.dp_terminal);
      }
    }
    res.json(result);
  });

  // GET /api/phone-lines — paginated, with optional central/cabin/box or text search filters
  app.get("/api/phone-lines", requireAuth, async (req, res) => {
    const { search = "", central = "", cabin = "", box = "", page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit)));
    const q = search.trim().toLowerCase();

    const conds: string[] = [];
    const params: any[] = [];
    if (central) { params.push(central); conds.push(`central = $${params.length}`); }
    if (cabin) { params.push(cabin); conds.push(`cabin_number = $${params.length}`); }
    if (box) { params.push(box); conds.push(`box_number = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      conds.push(`(LOWER(full_phone) LIKE ${p} OR LOWER(tel_no) LIKE ${p} OR LOWER(central) LIKE ${p} OR LOWER(cabin_number) LIKE ${p} OR LOWER(box_number) LIKE ${p})`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c FROM phone_lines ${where}`, params);
    const total = totalRes.rows[0].c as number;

    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `SELECT id, tel_no AS "telNo", central, idu_no AS "iduNo", odu_no AS "oduNo",
              cabin_number AS "cabinNumber", primary_block_no AS "primaryBlockNo",
              cabinet_in AS "cabinetIn", sec_block_no AS "secBlockNo", cabinet_out AS "cabinetOut",
              box_number AS "boxNumber", dp_terminal AS "dpTerminal", port, len,
              fiber_block AS "fiberBlock", fiber_out AS "fiberOut",
              tel_num_txt AS "telNumTxt", full_phone AS "fullPhone"
       FROM phone_lines ${where}
       ORDER BY id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ data: dataRes.rows, total, page: pageNum, pageSize });
  });

  // GET /api/phone-lines/box-summary — count of lines per box
  app.get("/api/phone-lines/box-summary", requireAuth, async (req, res) => {
    const { search = "" } = req.query as Record<string, string>;
    const q = search.trim().toLowerCase();

    const { rows } = await pool.query(`
      SELECT central,
             COALESCE(cabin_number, '') AS "cabinNumber",
             COALESCE(box_number, '') AS "boxNumber",
             COUNT(*)::int AS count
      FROM phone_lines
      GROUP BY central, cabin_number, box_number
    `);

    let summary = rows.sort((a: any, b: any) => {
      const cc = a.central.localeCompare(b.central, "ar");
      if (cc !== 0) return cc;
      const cab = a.cabinNumber.localeCompare(b.cabinNumber, "ar");
      if (cab !== 0) return cab;
      return parseInt(a.boxNumber) - parseInt(b.boxNumber) || a.boxNumber.localeCompare(b.boxNumber);
    });

    if (q) {
      summary = summary.filter((r: any) =>
        r.central.toLowerCase().includes(q) ||
        r.cabinNumber.toLowerCase().includes(q) ||
        r.boxNumber.toLowerCase().includes(q),
      );
    }

    res.json(summary);
  });

  // === Work Orders (تركيبات) ===
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  // POST /api/work-orders/import — admin uploads تركيبات xlsx
  app.post("/api/work-orders/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ message: "لم يتم إرسال ملف" });
    try {
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (rows.length < 2) return res.status(400).json({ message: "الملف فارغ" });

      // Detect column indices from header row by partial (case-insensitive)
      // match — supports the WFM "Voice Installation Raw Data" English layout
      // as well as the older Arabic تركيبات layout.
      const header = rows[0].map((h: any) => String(h ?? "").trim().toLowerCase());
      const findCol = (...keywords: string[]) =>
        header.findIndex((h) => h !== "" && keywords.some((k) => h.includes(k.toLowerCase())));

      const iCentral   = findCol("سنترال", "central");
      const iOrg       = findCol("organization", "كود السنترال", "المنظمه");
      const iCloseCat  = findCol("close category", "success", "حاله الاغلاق", "نتيجه الاغلاق");
      const iWorkOrder = findCol("work order id", "امر الشغل", "رقم الامر", "تذكرة");
      const iPhone     = findCol("service no", "التليفون", "تليفون", "هاتف", "phone");
      const iService   = findCol("work order type", "نوع الخدمه", "نوع الخدمة", "service type");
      const iDate      = findCol("close date", "تاريخ الاغلاق", "تاريخ الإغلاق", "الاغلاق");
      const iItem      = findCol("اسم الصنف", "الصنف", "item name");
      const iCable     = findCol("consumed cables", "كميه السلك", "كمية السلك", "السلك", "cable");
      const iTech      = findCol("tech name", "اسم الفنى", "اسم الفني", "الفنى");

      // central header is blank in the WFM export → fall back to first column
      const g = (row: any[], detected: number, fallback: number) =>
        row[detected >= 0 ? detected : fallback] ?? "";
      // optional fields: blank when the column is absent (no positional guess)
      const opt = (row: any[], detected: number) =>
        detected >= 0 ? (row[detected] ?? "") : "";

      const dataRows = rows.slice(1).filter((r) => {
        const id = g(r, iWorkOrder, 1);
        return id !== "" && id !== null && id !== undefined;
      });

      let inserted = 0;
      let skipped = 0;

      for (const r of dataRows) {
        // لا تُحمَّل إلا أوامر الشغل المغلقة بنجاح (Close Category = Success).
        const closeCategory = String(g(r, iCloseCat, 10)).trim().toLowerCase();
        if (closeCategory !== "success") { skipped++; continue; }
        // اسم السنترال يُستخرج من كود Organization ويُقارن بأكواد الملف المرفق.
        // أي كود غير موجود ضمن السنترالات المسموحة (الغنايم وفروعها) يُتخطّى.
        const orgCode = String(g(r, iOrg, 4)).trim().toUpperCase();
        const centralName = CENTRAL_CODE_TO_NAME[orgCode];
        if (!centralName) { skipped++; continue; }
        const workOrderId  = parseInt(String(g(r, iWorkOrder, 1)));
        const phoneNumber  = String(g(r, iPhone, 7)).replace(/^'/, "").trim();
        // IIf([Work Order Type]="Fixed Voice Installation MSAN";"تركيب جديد";"نقل")
        const rawServiceType = String(g(r, iService, 5)).trim();
        const serviceType  = rawServiceType === "Fixed Voice Installation MSAN" ? "تركيب جديد" : "نقل";
        const rawDate      = g(r, iDate, 12);
        const itemName     = "سلك واحد جوز"; // اسم الصنف ثابت دائماً
        const cableQuantity = ""; // كميه السلك تُترك فارغة عمداً (لا تؤخذ من الملف)
        const techName     = String(g(r, iTech, 15)).trim();

        if (!workOrderId || isNaN(workOrderId)) { skipped++; continue; }

        let closeDate: Date;
        if (rawDate instanceof Date) {
          closeDate = rawDate;
        } else if (typeof rawDate === "number") {
          closeDate = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
        } else {
          closeDate = new Date(rawDate);
        }
        if (isNaN(closeDate.getTime())) { skipped++; continue; }

        // المقارنة على (اسم السنترال + رقم امر الشغل): لو موجود يُتخطّى، لو جديد يُضاف.
        const ins = await pool.query(
          `INSERT INTO work_orders (central_name, work_order_id, phone_number, service_type, close_date, item_name, cable_quantity, tech_name, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (central_name, work_order_id) DO NOTHING`,
          [centralName, workOrderId, phoneNumber, serviceType, closeDate, itemName || null, cableQuantity || null, techName, (req.user as any).id],
        );
        if (ins.rowCount && ins.rowCount > 0) inserted++; else skipped++;
      }

      // Purge any previously-stored work orders for non-allowed centrals,
      // so the report stays restricted to الغنايم وفروعها even after older uploads.
      const { rows: existingCentrals } = await pool.query(
        "SELECT DISTINCT central_name FROM work_orders",
      );
      const centralsToDrop = existingCentrals
        .map((c: any) => c.central_name)
        .filter((c: string) => !isAllowedCentral(c));
      let purged = 0;
      if (centralsToDrop.length > 0) {
        const del = await pool.query(
          "DELETE FROM work_orders WHERE central_name = ANY($1)",
          [centralsToDrop],
        );
        purged = del.rowCount ?? 0;
      }

      console.log(`work-orders import: purged=${purged}, headers=${JSON.stringify(header)}, cols={central:${iCentral},order:${iWorkOrder},phone:${iPhone},svc:${iService},date:${iDate},item:${iItem},cable:${iCable},tech:${iTech}}, rows=${dataRows.length}, inserted=${inserted}, skipped=${skipped}`);
      res.json({ ok: true, inserted, skipped, purged, total: dataRows.length });
    } catch (e: any) {
      console.error("work-orders import error:", e);
      res.status(500).json({ message: "خطأ أثناء معالجة الملف", detail: e.message });
    }
  });

  // GET /api/work-orders — list with date range filter
  app.get("/api/work-orders", requireAuth, async (req, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];

    if (dateFrom) { params.push(dateFrom); conds.push(`close_date >= $${params.length}::date`); }
    if (dateTo) { params.push(dateTo); conds.push(`close_date < ($${params.length}::date + interval '1 day')`); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT id, central_name AS "centralName", work_order_id AS "workOrderId",
              phone_number AS "phoneNumber", service_type AS "serviceType",
              close_date AS "closeDate", item_name AS "itemName",
              cable_quantity AS "cableQuantity", tech_name AS "techName"
       FROM work_orders ${where}
       ORDER BY close_date ASC`,
      params,
    );
    res.json(rows);
  });

  // === Multi-file upload section ===

  // POST /api/maintenance-orders/import — admin uploads Work_Orders Excel
  app.post("/api/maintenance-orders/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      if (rows.length < 2) return res.json({ inserted: 0, skipped: 0 });

      const dataRows = rows.slice(1); // row 0 = headers
      let inserted = 0, skipped = 0;

      for (const r of dataRows) {
        const orgCode = String(r[2] ?? "").trim().toUpperCase();
        const centralName = CENTRAL_CODE_TO_NAME[orgCode];
        if (!centralName) { skipped++; continue; }

        const workOrderId = parseInt(String(r[1] ?? ""));
        if (!workOrderId || isNaN(workOrderId)) { skipped++; continue; }

        // phone: strip leading '88-' or '88'
        const rawPhone = String(r[7] ?? "").replace(/^88[-‐]?/, "").trim();

        // creation date — Excel serial number
        let creationDate: Date | null = null;
        const rawDate = r[0];
        if (typeof rawDate === "number" && rawDate > 1) {
          const d = XLSX.SSF.parse_date_code(rawDate);
          creationDate = new Date(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0, d.S ?? 0);
        }

        const ins = await pool.query(
          `INSERT INTO maintenance_orders
             (central_name, work_order_id, phone_number, work_order_type, stage, status, priority,
              current_workspec, notes, description, creation_date, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (central_name, work_order_id) DO NOTHING`,
          [
            centralName, workOrderId, rawPhone,
            String(r[13] ?? "") || null,
            String(r[16] ?? "") || null,
            String(r[17] ?? "") || null,
            String(r[18] ?? "") || null,
            String(r[20] ?? "") || null,
            String(r[21] ?? "") || null,
            String(r[22] ?? "") || null,
            creationDate,
            (req.user as any).id,
          ],
        );
        if (ins.rowCount && ins.rowCount > 0) inserted++; else skipped++;
      }

      res.json({ inserted, skipped });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // POST /api/ticket-queue/import — admin uploads TicketQueue Excel
  app.post("/api/ticket-queue/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      if (rows.length < 2) return res.json({ inserted: 0, skipped: 0 });

      const dataRows = rows.slice(1); // row 0 = headers
      let inserted = 0, skipped = 0;

      const parseTs = (v: any): Date | null => {
        if (!v) return null;
        const s = String(v).trim();
        if (!s) return null;
        const d = new Date(s.replace(" ", "T").replace(/\.0$/, ""));
        return isNaN(d.getTime()) ? null : d;
      };

      for (const r of dataRows) {
        const orgCode = String(r[3] ?? "").trim().toUpperCase();
        const centralName = CENTRAL_CODE_TO_NAME[orgCode];
        if (!centralName) { skipped++; continue; }

        const ticketId = String(r[1] ?? "").trim();
        if (!ticketId) { skipped++; continue; }

        const ins = await pool.query(
          `INSERT INTO ticket_queue
             (ticket_id, central_code, central_name, phone_number, complaint_time, tech_code,
              line_type_code, cabinet_no, priority_code, close_date, operation_type,
              complain_type_name, status_code, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (ticket_id, status_code) DO NOTHING`,
          [
            ticketId, orgCode, centralName,
            String(r[10] ?? "") || null,
            parseTs(r[4]),
            String(r[6]  ?? "") || null,
            String(r[7]  ?? "") || null,
            String(r[15] ?? "") || null,
            String(r[20] ?? "") || null,
            parseTs(r[22]),
            String(r[24] ?? "") || null,
            String(r[27] ?? "") || null,
            String(r[2]  ?? "") || null,
            (req.user as any).id,
          ],
        );
        if (ins.rowCount && ins.rowCount > 0) inserted++; else skipped++;
      }

      res.json({ inserted, skipped });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/maintenance-orders — list with date filter
  app.get("/api/maintenance-orders", requireAuth, async (req, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];
    if (dateFrom) { params.push(dateFrom); conds.push(`creation_date >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo + " 23:59:59"); conds.push(`creation_date <= $${params.length}`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id, central_name AS "centralName", work_order_id AS "workOrderId",
              phone_number AS "phoneNumber", work_order_type AS "workOrderType",
              stage, status, priority, current_workspec AS "currentWorkspec",
              notes, description, creation_date AS "creationDate"
       FROM maintenance_orders ${where}
       ORDER BY creation_date DESC NULLS LAST`,
      params,
    );
    res.json(rows);
  });

  // GET /api/ticket-queue — list with date filter
  app.get("/api/ticket-queue", requireAuth, async (req, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];
    if (dateFrom) { params.push(dateFrom); conds.push(`complaint_time >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo + " 23:59:59"); conds.push(`complaint_time <= $${params.length}`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id, ticket_id AS "ticketId", central_code AS "centralCode",
              central_name AS "centralName", phone_number AS "phoneNumber",
              complaint_time AS "complaintTime", tech_code AS "techCode",
              line_type_code AS "lineTypeCode", cabinet_no AS "cabinetNo",
              priority_code AS "priorityCode", close_date AS "closeDate",
              operation_type AS "operationType", complain_type_name AS "complainTypeName",
              status_code AS "statusCode"
       FROM ticket_queue ${where}
       ORDER BY complaint_time DESC NULLS LAST`,
      params,
    );
    res.json(rows);
  });

  // POST /api/complaint-details/import — REPLACE all data from التفاصيل + تفاصيل متبقى sheets
  app.post("/api/complaint-details/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });

      const parseExcelDate = (v: any): Date | null => {
        if (typeof v === "number" && v > 1) {
          const d = XLSX.SSF.parse_date_code(v);
          return new Date(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0, d.S ?? 0);
        }
        return null;
      };

      // collect rows from both sheets
      const allInserts: any[][] = [];

      // Sheet 1: التفاصيل — headers at row[1], data from row[2]
      const ws1 = wb.Sheets["التفاصيل"];
      if (ws1) {
        const rows1: any[][] = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: "" }) as any[][];
        for (let i = 2; i < rows1.length; i++) {
          const r = rows1[i];
          const complainNo = String(r[6] ?? "").trim();
          if (!complainNo || complainNo === "0") continue;
          allInserts.push([
            complainNo,
            String(r[1] ?? "") || null, // sector
            String(r[2] ?? "") || null, // region
            String(r[3] ?? "") || null, // exchange_name
            String(r[5] ?? "") || null, // phone_number
            String(r[7] ?? "") || null, // msan_id
            String(r[8] ?? "") || null, // cabinet_no
            parseExcelDate(r[12]),      // complain_time
            parseExcelDate(r[13]),      // close_time
            String(r[11] ?? "") || null, // close_code
            String(r[14] ?? "") || null, // complain_side_name
            String(r[15] ?? "") || null, // complain_type_name
            String(r[16] ?? "") || null, // close_by
          ]);
        }
      }

      // Sheet 2: تفاصيل متبقى — headers at row[0], data from row[1]
      const ws2 = wb.Sheets["تفاصيل متبقى"];
      if (ws2) {
        const rows2: any[][] = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: "" }) as any[][];
        for (let i = 1; i < rows2.length; i++) {
          const r = rows2[i];
          const complainNo = String(r[4] ?? "").trim();
          if (!complainNo || complainNo === "0") continue;
          allInserts.push([
            complainNo,
            String(r[1] ?? "") || null, // sector
            String(r[2] ?? "") || null, // region
            String(r[3] ?? "") || null, // exchange_name
            String(r[5] ?? "") || null, // phone_number (Tel No)
            String(r[10] ?? "") || null, // msan_id
            String(r[16] ?? "") || null, // cabinet_no
            parseExcelDate(r[6]),        // complain_time
            parseExcelDate(r[11]),       // close_time
            String(r[12] ?? "") || null, // close_code
            null,                        // complain_side_name (not in this sheet)
            String(r[18] ?? "") || null, // complain_type_name
            String(r[13] ?? "") || null, // close_by
          ]);
        }
      }

      // REPLACE: delete all existing rows then insert fresh
      await pool.query("DELETE FROM complaint_details");

      let inserted = 0;
      const BATCH = 200;
      for (let s = 0; s < allInserts.length; s += BATCH) {
        const chunk = allInserts.slice(s, s + BATCH);
        const placeholders = chunk.map((_, ci) => {
          const o = ci * 13;
          return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10},$${o+11},$${o+12},$${o+13})`;
        }).join(",");
        const values = chunk.flat();
        const r = await pool.query(
          `INSERT INTO complaint_details
             (complain_no, sector, region, exchange_name, phone_number, msan_id, cabinet_no,
              complain_time, close_time, close_code, complain_side_name, complain_type_name, close_by)
           VALUES ${placeholders}
           ON CONFLICT (complain_no) DO NOTHING`,
          values,
        );
        inserted += r.rowCount ?? 0;
      }

      res.json({ inserted, total: allInserts.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/complaint-details — list with date filter + search (Ghanaim centrals only by default)
  app.get("/api/complaint-details", requireAuth, async (req, res) => {
    const { dateFrom, dateTo, q, all } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];
    // Show only الغنايم branches unless all=true
    if (all !== "true") {
      conds.push(`(exchange_name = 'الغنايم' OR exchange_name = 'الغنايم-العزايزة' OR exchange_name = 'الغنايم-دير الجنادله' OR exchange_name = 'الغنايم-نجع العمدة')`);
    }
    if (dateFrom) { params.push(dateFrom); conds.push(`complain_time >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo + " 23:59:59"); conds.push(`complain_time <= $${params.length}`); }
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      conds.push(`(complain_no ILIKE ${p} OR phone_number ILIKE ${p} OR exchange_name ILIKE ${p} OR cabinet_no ILIKE ${p})`);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id, complain_no AS "complainNo", sector, region,
              exchange_name AS "exchangeName", phone_number AS "phoneNumber",
              msan_id AS "msanId", cabinet_no AS "cabinetNo",
              complain_time AS "complainTime", close_time AS "closeTime",
              close_code AS "closeCode", complain_side_name AS "complainSideName",
              complain_type_name AS "complainTypeName", close_by AS "closeBy"
       FROM complaint_details ${where}
       ORDER BY complain_time DESC NULLS LAST
       LIMIT 5000`,
      params,
    );
    res.json(rows);
  });

  // === External API (token-protected, for other sites) ===
  // Requires header: Authorization: Bearer <SF_API_TOKEN>
  const requireApiToken = (req: any, res: any, next: any) => {
    const configured = process.env.SF_API_TOKEN;
    if (!configured) {
      return res.status(503).json({ ok: false, error: "API token not configured" });
    }
    const h = req.headers["authorization"] || "";
    const t = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!t || t !== configured) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
  };

  // GET /api/box-summary — paginated box summary for external consumers
  app.get("/api/box-summary", requireApiToken, async (req, res) => {
    try {
      const { page = "1", limit = "100", q } = req.query as Record<string, string>;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const pageSize = Math.min(1000, Math.max(1, parseInt(limit) || 100));
      const offset = (pageNum - 1) * pageSize;

      const params: any[] = [];
      let where = "";
      if (q && q.trim()) {
        params.push(`%${q.trim().toLowerCase()}%`);
        const p = `$${params.length}`;
        where = `WHERE (LOWER(central) LIKE ${p} OR LOWER(cabin_number) LIKE ${p} OR LOWER(box_number) LIKE ${p})`;
      }

      const totalRes = await pool.query(
        `SELECT COUNT(*)::int AS c FROM (
           SELECT 1 FROM phone_lines ${where}
           GROUP BY central, cabin_number, box_number
         ) sub`,
        params,
      );
      const total = totalRes.rows[0].c as number;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `SELECT central,
                COALESCE(cabin_number, '') AS "cabinNumber",
                COALESCE(box_number, '') AS "boxNumber",
                COUNT(*)::int AS count
         FROM phone_lines ${where}
         GROUP BY central, cabin_number, box_number
         ORDER BY central, cabin_number, box_number
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      res.json({ ok: true, data: rows, total, page: pageNum, limit: pageSize });
    } catch (e) {
      res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // GET /api/phone-report — token-protected, returns phone_lines rows with filters
  app.get("/api/phone-report", requireApiToken, async (req, res) => {
    try {
      const pageNum  = Math.max(1, parseInt(String(req.query.page  || "1"))  || 1);
      const pageSize = Math.min(12000, Math.max(1, parseInt(String(req.query.limit || "100")) || 100));
      const offset   = (pageNum - 1) * pageSize;
      const q        = String(req.query.q        || "").trim();
      const exchange = String(req.query.exchange || "").trim();
      const cabinet  = String(req.query.cabinet  || "").trim();
      const box      = String(req.query.box      || "").trim();

      const params: any[] = [];
      const conds: string[] = [];

      if (exchange) { params.push(`%${exchange}%`); conds.push(`central ILIKE $${params.length}`); }
      if (cabinet)  { params.push(`%${cabinet}%`);  conds.push(`cabin_number ILIKE $${params.length}`); }
      if (box)      { params.push(`%${box}%`);      conds.push(`box_number ILIKE $${params.length}`); }
      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;
        conds.push(`(full_phone ILIKE ${p} OR tel_no ILIKE ${p} OR central ILIKE ${p} OR cabin_number ILIKE ${p} OR box_number ILIKE ${p})`);
      }

      const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

      const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM phone_lines ${where}`, params);
      const total = countRes.rows[0].c as number;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `SELECT id,
                tel_no AS "telNo",
                central,
                idu_no AS "iduNo",
                odu_no AS "oduNo",
                cabin_number AS "cabinNumber",
                primary_block_no AS "primaryBlockNo",
                cabinet_in AS "cabinetIn",
                sec_block_no AS "secBlockNo",
                cabinet_out AS "cabinetOut",
                box_number AS "boxNumber",
                dp_terminal AS "dpTerminal",
                port,
                len,
                fiber_block AS "fiberBlock",
                fiber_out AS "fiberOut",
                tel_num_txt AS "telNumTxt",
                full_phone AS "fullPhone"
         FROM phone_lines ${where}
         ORDER BY id
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      res.json({ ok: true, data: rows, total, page: pageNum, limit: pageSize });
    } catch (e) {
      res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // === Phone Line Edits ===

  // PUT /api/phone-lines/:id — edit cabin/box/dpTerminal + create audit record
  app.put("/api/phone-lines/:id", requireAuth, requireTechOrAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = req.user as any;
    const { cabinNumber, boxNumber, dpTerminal, cabinetIn } = req.body;

    if (!cabinNumber || !boxNumber || !dpTerminal) {
      return res.status(400).json({ message: "cabinNumber و boxNumber و dpTerminal مطلوبة" });
    }

    // Load current line
    const lineRes = await pool.query(
      `SELECT id, central, cabin_number, box_number, dp_terminal, full_phone FROM phone_lines WHERE id = $1`,
      [id],
    );
    if (lineRes.rows.length === 0) return res.status(404).json({ message: "الخط غير موجود" });
    const line = lineRes.rows[0];

    // Skip if nothing changed
    if (line.cabin_number === cabinNumber && line.box_number === boxNumber && line.dp_terminal === dpTerminal) {
      return res.status(200).json({ message: "لا يوجد تغيير في البيانات" });
    }

    const cabinChanged = line.cabin_number !== cabinNumber;
    if (cabinChanged && !cabinetIn) {
      return res.status(400).json({ message: "عند تغيير الكابينة يجب تحديد قيمة الدخل (cabinet_in)" });
    }

    // Uniqueness check: same (central, cabinNumber, boxNumber, dpTerminal) in another record
    const conflict = await pool.query(
      `SELECT id, full_phone FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND box_number = $3 AND dp_terminal = $4 AND id <> $5 LIMIT 1`,
      [line.central, cabinNumber, boxNumber, dpTerminal, id],
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({
        message: "هذه البيانات مستخدمة بالفعل مع خط آخر",
        conflictLine: { fullPhone: conflict.rows[0].full_phone, id: conflict.rows[0].id },
      });
    }

    // Update phone_lines (also update cabinet_in + idu_no/odu_no when cabin changes)
    if (cabinChanged) {
      // Derive canonical idu/odu from the new (central, cabin) pair
      const iduOduRes = await pool.query(
        `SELECT idu_no, odu_no FROM phone_lines
         WHERE central = $1 AND cabin_number = $2 AND idu_no IS NOT NULL
         LIMIT 1`,
        [line.central, cabinNumber],
      );
      const newIduNo = iduOduRes.rows[0]?.idu_no ?? null;
      const newOduNo = iduOduRes.rows[0]?.odu_no ?? null;

      await pool.query(
        `UPDATE phone_lines SET cabin_number = $1, box_number = $2, dp_terminal = $3, cabinet_in = $4, idu_no = $5, odu_no = $6 WHERE id = $7`,
        [cabinNumber, boxNumber, dpTerminal, cabinetIn, newIduNo, newOduNo, id],
      );
    } else {
      await pool.query(
        `UPDATE phone_lines SET cabin_number = $1, box_number = $2, dp_terminal = $3 WHERE id = $4`,
        [cabinNumber, boxNumber, dpTerminal, id],
      );
    }

    // Insert audit record
    await pool.query(
      `INSERT INTO phone_line_edits
         (phone_line_id, full_phone, central, old_cabin_number, new_cabin_number, old_box_number, new_box_number, old_dp_terminal, new_dp_terminal, edited_by_id, edited_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, line.full_phone, line.central, line.cabin_number, cabinNumber, line.box_number, boxNumber, line.dp_terminal, dpTerminal, user.id, user.username],
    );

    res.json({ success: true });
  });

  // POST /api/phone-lines/edits/:id/rollback — admin: any pending; tech: only their own
  app.post("/api/phone-lines/edits/:id/rollback", requireAuth, requireTechOrAdmin, async (req, res) => {
    const editId = parseInt(req.params.id);
    const user = req.user as any;

    const editRes = await pool.query(
      `SELECT * FROM phone_line_edits WHERE id = $1`,
      [editId],
    );
    if (editRes.rows.length === 0) return res.status(404).json({ message: "السجل غير موجود" });
    const edit = editRes.rows[0];

    if (edit.status !== "pending") {
      return res.status(400).json({ message: "لا يمكن التراجع — السجل ليس تحت التنفيذ" });
    }

    // Tech can only rollback their own edits
    if (user.role === ROLES.TECH && edit.edited_by_id !== user.id) {
      return res.status(403).json({ message: "يمكنك فقط التراجع عن تعديلاتك الشخصية" });
    }

    // Revert phone_lines to old values
    await pool.query(
      `UPDATE phone_lines SET cabin_number = $1, box_number = $2, dp_terminal = $3 WHERE id = $4`,
      [edit.old_cabin_number, edit.old_box_number, edit.old_dp_terminal, edit.phone_line_id],
    );

    // Mark edit as rolled_back
    await pool.query(
      `UPDATE phone_line_edits SET status = 'rolled_back', rolled_back_by_id = $1, rolled_back_by_name = $2, rolled_back_at = now() WHERE id = $3`,
      [user.id, user.username, editId],
    );

    res.json({ success: true });
  });

  // POST /api/phone-lines/edits/:id/confirm — data_manager only
  app.post("/api/phone-lines/edits/:id/confirm", requireAuth, requireDataManager, async (req, res) => {
    const editId = parseInt(req.params.id);
    const user = req.user as any;

    const editRes = await pool.query(
      `SELECT status FROM phone_line_edits WHERE id = $1`,
      [editId],
    );
    if (editRes.rows.length === 0) return res.status(404).json({ message: "السجل غير موجود" });
    if (editRes.rows[0].status !== "pending") {
      return res.status(400).json({ message: "السجل ليس تحت التنفيذ" });
    }

    await pool.query(
      `UPDATE phone_line_edits SET status = 'completed', confirmed_by_id = $1, confirmed_by_name = $2, confirmed_at = now() WHERE id = $3`,
      [user.id, user.username, editId],
    );

    res.json({ success: true });
  });

  // GET /api/phone-lines/edits — list edits, optional ?status=pending|completed|rolled_back&search=<phone>
  app.get("/api/phone-lines/edits", requireAuth, async (req, res) => {
    const user = req.user as any;
    const allowed = [ROLES.ADMIN, ROLES.TECH, ROLES.DATA_MANAGER];
    if (!allowed.includes(user.role)) return res.status(403).json({ message: "Forbidden" });

    const { status = "", search = "" } = req.query as Record<string, string>;
    const conds: string[] = [];
    const params: any[] = [];

    if (status) { params.push(status); conds.push(`status = $${params.length}`); }
    if (search.trim()) { params.push(`%${search.trim()}%`); conds.push(`full_phone ILIKE $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT id, phone_line_id AS "phoneLineId", full_phone AS "fullPhone", central,
              old_cabin_number AS "oldCabinNumber", new_cabin_number AS "newCabinNumber",
              old_box_number AS "oldBoxNumber", new_box_number AS "newBoxNumber",
              old_dp_terminal AS "oldDpTerminal", new_dp_terminal AS "newDpTerminal",
              status,
              edited_by_id AS "editedById", edited_by_name AS "editedByName", edited_at AS "editedAt",
              confirmed_by_name AS "confirmedByName", confirmed_at AS "confirmedAt",
              rolled_back_by_name AS "rolledBackByName", rolled_back_at AS "rolledBackAt"
       FROM phone_line_edits ${where}
       ORDER BY edited_at DESC`,
      params,
    );

    res.json(rows);
  });

  // === Public API: Box Summary (Bearer Token Auth) ===
  // OPTIONS preflight for cross-origin requests
  app.options("/api/box-summary", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.status(204).end();
  });

  // GET /api/box-summary?page=1&limit=100&q=<search>
  app.get("/api/box-summary", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token || token !== process.env.SF_API_TOKEN) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || "100", 10)));
    const q = ((req.query.q as string) || "").trim();
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const conds: string[] = ["status = 'not_feasible'"];

    if (q) {
      params.push(`%${q}%`);
      conds.push(`(
        customer_name ILIKE $${params.length} OR
        central_name ILIKE $${params.length} OR
        cabin_number ILIKE $${params.length} OR
        box_number ILIKE $${params.length}
      )`);
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM orders ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0].total, 10);

    params.push(limit);
    params.push(offset);
    const dataRes = await pool.query(
      `SELECT
         id,
         customer_name   AS "customerName",
         customer_phone  AS "customerPhone",
         central_name    AS "centralName",
         cabin_number    AS "cabinNumber",
         box_number      AS "boxNumber",
         nearest_box_distance AS "nearestBoxDistance",
         rejection_reason AS "rejectionReason",
         tech_name       AS "techName",
         tech_response_at AS "techResponseAt",
         sales_name      AS "salesName",
         created_at      AS "createdAt"
       FROM orders ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      ok: true,
      data: dataRes.rows,
      total,
      page,
      limit,
    });
  });

  return httpServer;
}

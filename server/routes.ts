import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertOrderSchema, updateOrderSchema, ROLES, WS_EVENTS } from "@shared/schema";
import { api } from "@shared/routes";
import { z } from "zod";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import MemoryStore from "memorystore";

const scryptAsync = promisify(scrypt);
const SessionStore = MemoryStore(session);

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

  // === Auth Setup ===
  // Helper to hash passwords (simple for this demo)
  // In production, use a proper salt and key length per user
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
  // Run seed
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
      
      if (role !== ROLES.SALES && role !== ROLES.TECH) {
        return res.status(400).json({ message: "Role must be sales or tech" });
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
      const orders = await storage.getOrdersBySalesId(user.id);
      return res.json(orders);
    }
    // Tech and Admin see all
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

  return httpServer;
}

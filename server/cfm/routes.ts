// ============================================================================
// server/cfm/routes.ts — راوتس Cable-Fault-Manager المدموجة (منقولة من CFM).
// - كل المسارات تحت /api/cfm/*
// - بتعيد استخدام جلسة Service-Flow (express-session) وبتخزّن مستخدم CFM فى req.session.cfmUser
//   (دخول مستقل مؤقتاً عبر /api/cfm/auth/* — التوحيد الكامل مع دخول Service-Flow فى مرحلة لاحقة).
// ============================================================================
import type { Express } from "express";
import express from "express";
import bcrypt from "bcryptjs";  // نسخة JS خالصة — تتحقق من هاش bcrypt ($2b$) بتاع مستخدمى CFM بدون native build
import { storage } from "./storage";
import { importCfmFromLive } from "./import-from-live";
import {
  insertCfmUserSchema as insertUserSchema,
  insertCentralSchema,
  insertCableSchema,
  insertFaultTypeSchema,
  insertWorkTypeSchema,
  insertTaskTypeSchema,
  insertContractorSchema,
  insertExcavationWorkerSchema,
  insertTicketSchema,
  insertWorkEntrySchema,
  insertUsedTaskEntrySchema,
  insertMeasurementEntrySchema,
  insertInventoryTransactionSchema,
  type CfmUser as User,
} from "@shared/cfm-schema";

declare module "express-session" {
  interface SessionData {
    cfmUser?: User;
  }
}

function sanitizeUser(user: User) {
  const { password, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.session.cfmUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.session.cfmUser || req.session.cfmUser.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }
  next();
}

export function registerCfmRoutes(app: Express) {
  // استيراد لمرة واحدة: يسحب كل بيانات الكوابل من التطبيق المنشور ويحمّلها فى قاعدة Service-Flow.
  // محمى بتوكن. يُنفَّذ على السيرفر المنشور فيكتب فى قاعدة الإنتاج. idempotent.
  const CFM_IMPORT_TOKEN = process.env.CFM_IMPORT_TOKEN || "cfm-import-2026";
  app.post("/api/cfm/_import-from-live", async (req, res) => {
    if ((req.query.token || req.headers["x-import-token"]) !== CFM_IMPORT_TOKEN) {
      return res.status(401).json({ error: "invalid token" });
    }
    try {
      const imported = await importCfmFromLive();
      res.json({ ok: true, imported });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });


  // ===== AUTHENTICATION ROUTES ===== //
  
  // POST /api/auth/login
  app.post("/api/cfm/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      req.session.cfmUser = user;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Failed to create session" });
        }
        res.json(sanitizeUser(user));
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/auth/logout
  app.post("/api/cfm/auth/logout", (req, res) => {
    // الجلسة مشتركة مع Service-Flow — نمسح مستخدم CFM فقط بدل تدمير الجلسة كلها
    delete (req.session as any).cfmUser;
    req.session.save(() => res.json({ success: true }));
  });

  // GET /api/auth/me
  app.get("/api/cfm/auth/me", (req, res) => {
    if (!req.session.cfmUser) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.json(sanitizeUser(req.session.cfmUser));
  });

  // POST /api/auth/change-password
  app.post("/api/cfm/auth/change-password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current password and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      }

      const user = await storage.getUser(req.session.cfmUser!.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const updatedUser = await storage.updateUserPassword(user.id, hashedPassword);

      if (!updatedUser) {
        return res.status(500).json({ error: "Failed to update password" });
      }

      req.session.cfmUser = updatedUser;
      res.json(sanitizeUser(updatedUser));
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ===== USER MANAGEMENT ROUTES ===== //

  // GET /api/users/technicians - Available to all authenticated users for dropdown selection
  app.get("/api/cfm/users/technicians", requireAuth, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Return only splice technicians for dropdown selection
      const technicians = users
        .filter(u => u.role === 'splice_tech')
        .map(sanitizeUser);
      res.json(technicians);
    } catch (error) {
      console.error("Get technicians error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/users
  app.get("/api/cfm/users", requireAuth, requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map(sanitizeUser));
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/users
  app.post("/api/cfm/users", requireAuth, requireAdmin, async (req, res) => {
    try {
      const validation = insertUserSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid user data", details: validation.error });
      }

      const hashedPassword = await bcrypt.hash(validation.data.password, 10);
      const newUser = await storage.createUser({
        ...validation.data,
        password: hashedPassword,
      });

      res.status(201).json(sanitizeUser(newUser));
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // PATCH /api/users/:id
  app.patch("/api/cfm/users/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { password, ...updateData } = req.body;

      const updatedUser = await storage.updateUser(id, updateData);
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(sanitizeUser(updatedUser));
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /api/users/:id
  app.delete("/api/cfm/users/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;

      if (id === req.session.cfmUser!.id) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      await storage.deleteUser(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/users/:id/reset-password
  app.post("/api/cfm/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const updatedUser = await storage.updateUser(id, {
        password: hashedPassword,
        isInitialPassword: true,
      });

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(sanitizeUser(updatedUser));
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ===== MASTER DATA ROUTES ===== //

  // Centrals
  app.get("/api/cfm/master-data/centrals", requireAuth, async (req, res) => {
    try {
      const centrals = await storage.getAllCentrals();
      res.json(centrals);
    } catch (error) {
      console.error("Get centrals error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/cfm/master-data/centrals", requireAuth, async (req, res) => {
    try {
      const validation = insertCentralSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid central data", details: validation.error });
      }

      const central = await storage.createCentral(validation.data);
      res.status(201).json(central);
    } catch (error) {
      console.error("Create central error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/cfm/master-data/centrals/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const central = await storage.updateCentral(id, req.body);
      if (!central) {
        return res.status(404).json({ error: "Central not found" });
      }
      res.json(central);
    } catch (error) {
      console.error("Update central error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/cfm/master-data/centrals/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteCentral(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete central error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Cables
  app.get("/api/cfm/master-data/cables", requireAuth, async (req, res) => {
    try {
      const cables = await storage.getAllCables();
      res.json(cables);
    } catch (error) {
      console.error("Get cables error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/cfm/master-data/cables", requireAuth, async (req, res) => {
    try {
      const validation = insertCableSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid cable data", details: validation.error });
      }

      const cable = await storage.createCable(validation.data);
      res.status(201).json(cable);
    } catch (error) {
      console.error("Create cable error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/cfm/master-data/cables/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const cable = await storage.updateCable(id, req.body);
      if (!cable) {
        return res.status(404).json({ error: "Cable not found" });
      }
      res.json(cable);
    } catch (error) {
      console.error("Update cable error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/cfm/master-data/cables/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteCable(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete cable error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Fault Types
  app.get("/api/cfm/master-data/fault-types", requireAuth, async (req, res) => {
    try {
      const faultTypes = await storage.getAllFaultTypes();
      res.json(faultTypes);
    } catch (error) {
      console.error("Get fault types error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/cfm/master-data/fault-types", requireAuth, async (req, res) => {
    try {
      const validation = insertFaultTypeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid fault type data", details: validation.error });
      }

      const faultType = await storage.createFaultType(validation.data);
      res.status(201).json(faultType);
    } catch (error) {
      console.error("Create fault type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/cfm/master-data/fault-types/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const faultType = await storage.updateFaultType(id, req.body);
      if (!faultType) {
        return res.status(404).json({ error: "Fault type not found" });
      }
      res.json(faultType);
    } catch (error) {
      console.error("Update fault type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/cfm/master-data/fault-types/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteFaultType(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete fault type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Work Types
  app.get("/api/cfm/master-data/work-types", requireAuth, async (req, res) => {
    try {
      const workTypes = await storage.getAllWorkTypes();
      res.json(workTypes);
    } catch (error) {
      console.error("Get work types error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/cfm/master-data/work-types", requireAuth, async (req, res) => {
    try {
      const validation = insertWorkTypeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid work type data", details: validation.error });
      }

      const workType = await storage.createWorkType(validation.data);
      res.status(201).json(workType);
    } catch (error) {
      console.error("Create work type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/cfm/master-data/work-types/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const workType = await storage.updateWorkType(id, req.body);
      if (!workType) {
        return res.status(404).json({ error: "Work type not found" });
      }
      res.json(workType);
    } catch (error) {
      console.error("Update work type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/cfm/master-data/work-types/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteWorkType(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete work type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Task Types
  app.get("/api/cfm/master-data/task-types", requireAuth, async (req, res) => {
    try {
      const taskTypes = await storage.getAllTaskTypes();
      res.json(taskTypes);
    } catch (error) {
      console.error("Get task types error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/cfm/master-data/task-types", requireAuth, async (req, res) => {
    try {
      const validation = insertTaskTypeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid task type data", details: validation.error });
      }

      const taskType = await storage.createTaskType(validation.data);
      res.status(201).json(taskType);
    } catch (error) {
      console.error("Create task type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/cfm/master-data/task-types/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const taskType = await storage.updateTaskType(id, req.body);
      if (!taskType) {
        return res.status(404).json({ error: "Task type not found" });
      }
      res.json(taskType);
    } catch (error) {
      console.error("Update task type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/cfm/master-data/task-types/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteTaskType(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete task type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Contractors
  app.get("/api/cfm/master-data/contractors", requireAuth, async (req, res) => {
    try {
      const contractors = await storage.getAllContractors();
      res.json(contractors);
    } catch (error) {
      console.error("Get contractors error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/cfm/master-data/contractors", requireAuth, async (req, res) => {
    try {
      const validation = insertContractorSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid contractor data", details: validation.error });
      }

      const contractor = await storage.createContractor(validation.data);
      res.status(201).json(contractor);
    } catch (error) {
      console.error("Create contractor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/cfm/master-data/contractors/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const contractor = await storage.updateContractor(id, req.body);
      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }
      res.json(contractor);
    } catch (error) {
      console.error("Update contractor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/cfm/master-data/contractors/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteContractor(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete contractor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Excavation Workers
  app.get("/api/cfm/master-data/excavation-workers", requireAuth, async (req, res) => {
    try {
      const workers = await storage.getAllExcavationWorkers();
      res.json(workers);
    } catch (error) {
      console.error("Get excavation workers error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/cfm/master-data/excavation-workers", requireAuth, async (req, res) => {
    try {
      const validation = insertExcavationWorkerSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid excavation worker data", details: validation.error });
      }

      const worker = await storage.createExcavationWorker(validation.data);
      res.status(201).json(worker);
    } catch (error: any) {
      console.error("Create excavation worker error:", error);
      if (error.code === '23505') {
        return res.status(400).json({ error: "الرقم القومي مسجل مسبقاً" });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/cfm/master-data/excavation-workers/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const worker = await storage.updateExcavationWorker(id, req.body);
      if (!worker) {
        return res.status(404).json({ error: "Excavation worker not found" });
      }
      res.json(worker);
    } catch (error: any) {
      console.error("Update excavation worker error:", error);
      if (error.code === '23505') {
        return res.status(400).json({ error: "الرقم القومي مسجل مسبقاً" });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/cfm/master-data/excavation-workers/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      await storage.deleteExcavationWorker(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete excavation worker error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Bulk import
  app.post("/api/cfm/master-data/:type/bulk", requireAuth, async (req, res) => {
    try {
      const { type } = req.params;
      const { items } = req.body;

      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "Items must be an array" });
      }

      const results = [];
      const errors = [];

      for (let i = 0; i < items.length; i++) {
        try {
          let result;
          switch (type) {
            case "centrals":
              const centralValidation = insertCentralSchema.safeParse(items[i]);
              if (centralValidation.success) {
                result = await storage.createCentral(centralValidation.data);
              } else {
                errors.push({ index: i, error: centralValidation.error });
              }
              break;
            case "cables":
              const cableValidation = insertCableSchema.safeParse(items[i]);
              if (cableValidation.success) {
                result = await storage.createCable(cableValidation.data);
              } else {
                errors.push({ index: i, error: cableValidation.error });
              }
              break;
            case "fault-types":
              const faultTypeValidation = insertFaultTypeSchema.safeParse(items[i]);
              if (faultTypeValidation.success) {
                result = await storage.createFaultType(faultTypeValidation.data);
              } else {
                errors.push({ index: i, error: faultTypeValidation.error });
              }
              break;
            case "work-types":
              const workTypeValidation = insertWorkTypeSchema.safeParse(items[i]);
              if (workTypeValidation.success) {
                result = await storage.createWorkType(workTypeValidation.data);
              } else {
                errors.push({ index: i, error: workTypeValidation.error });
              }
              break;
            case "task-types":
              const taskTypeValidation = insertTaskTypeSchema.safeParse(items[i]);
              if (taskTypeValidation.success) {
                result = await storage.createTaskType(taskTypeValidation.data);
              } else {
                errors.push({ index: i, error: taskTypeValidation.error });
              }
              break;
            case "contractors":
              const contractorValidation = insertContractorSchema.safeParse(items[i]);
              if (contractorValidation.success) {
                result = await storage.createContractor(contractorValidation.data);
              } else {
                errors.push({ index: i, error: contractorValidation.error });
              }
              break;
            case "excavation-workers":
              const excavationWorkerValidation = insertExcavationWorkerSchema.safeParse(items[i]);
              if (excavationWorkerValidation.success) {
                result = await storage.createExcavationWorker(excavationWorkerValidation.data);
              } else {
                errors.push({ index: i, error: excavationWorkerValidation.error });
              }
              break;
            default:
              return res.status(400).json({ error: "Invalid type" });
          }
          if (result) {
            results.push(result);
          }
        } catch (error) {
          errors.push({ index: i, error: error instanceof Error ? error.message : "Unknown error" });
        }
      }

      res.json({ success: true, imported: results.length, errors });
    } catch (error) {
      console.error("Bulk import error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ===== TICKET ROUTES ===== //

  // GET /api/tickets
  app.get("/api/cfm/tickets", requireAuth, async (req, res) => {
    try {
      const tickets = await storage.getAllTickets();
      res.json(tickets);
    } catch (error) {
      console.error("Get tickets error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/tickets/:id
  app.get("/api/cfm/tickets/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const ticket = await storage.getTicketById(id);
      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      res.json(ticket);
    } catch (error) {
      console.error("Get ticket error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/tickets
  app.post("/api/cfm/tickets", requireAuth, async (req, res) => {
    try {
      const validation = insertTicketSchema.safeParse({
        ...req.body,
        createdBy: req.session.cfmUser!.id,
      });

      if (!validation.success) {
        return res.status(400).json({ error: "Invalid ticket data", details: validation.error });
      }

      // Auto-generate ticket number - find max number to avoid duplicates
      const allTickets = await storage.getAllTickets();
      const currentYear = new Date().getFullYear();
      const ticketsThisYear = allTickets.filter(t => 
        t.ticketNumber.startsWith(`TKT-${currentYear}-`)
      );
      
      // Find max ticket number for this year
      let maxNumber = 0;
      for (const t of ticketsThisYear) {
        const numStr = t.ticketNumber.replace(`TKT-${currentYear}-`, '');
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
      const nextNumber = maxNumber + 1;
      const ticketNumber = `TKT-${currentYear}-${String(nextNumber).padStart(3, '0')}`;

      const ticket = await storage.createTicket({
        ...validation.data,
        ticketNumber,
      } as any);

      res.status(201).json(ticket);
    } catch (error) {
      console.error("Create ticket error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: "Internal server error", details: errorMessage });
    }
  });

  // PATCH /api/tickets/:id/status
  app.patch("/api/cfm/tickets/:id/status", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const ticket = await storage.updateTicket(id, { status });
      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      res.json(ticket);
    } catch (error) {
      console.error("Update ticket status error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /api/tickets/:id - Delete ticket (admin/external_affairs only, if no entries)
  app.delete("/api/cfm/tickets/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const userRole = req.session.cfmUser!.role;

      // Only admin and external_affairs can delete tickets
      if (userRole !== 'admin' && userRole !== 'external_affairs') {
        return res.status(403).json({ error: "Only admin and external affairs can delete tickets" });
      }

      // Get ticket with all related entries
      const ticket = await storage.getTicketById(id);
      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      // Check if ticket has any works, tasks, or measurements
      const ticketWithRelations = ticket as any;
      const hasWorks = ticketWithRelations.works && ticketWithRelations.works.length > 0;
      const hasTasks = ticketWithRelations.usedTasks && ticketWithRelations.usedTasks.length > 0;
      const hasMeasurements = ticketWithRelations.measurements && ticketWithRelations.measurements.length > 0;

      if (hasWorks || hasTasks || hasMeasurements) {
        return res.status(400).json({ 
          error: "Cannot delete ticket with existing works, tasks, or measurements",
          details: {
            hasWorks,
            hasTasks,
            hasMeasurements
          }
        });
      }

      const deleted = await storage.deleteTicket(id);
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete ticket" });
      }

      res.json({ success: true, message: "Ticket deleted successfully" });
    } catch (error) {
      console.error("Delete ticket error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/tickets/:id/works
  app.post("/api/cfm/tickets/:id/works", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const ticket = await storage.getTicketById(id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      if (ticket.status === 'closed' && req.session.cfmUser!.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only admin can modify closed tickets" });
      }
      const bodyData = { ...req.body };
      // Convert recordedAt string to Date if provided
      if (bodyData.recordedAt && typeof bodyData.recordedAt === 'string') {
        bodyData.recordedAt = new Date(bodyData.recordedAt);
      }
      const validation = insertWorkEntrySchema.safeParse({
        ...bodyData,
        ticketId: id,
        createdBy: req.session.cfmUser!.id,
      });

      if (!validation.success) {
        return res.status(400).json({ error: "Invalid work entry data", details: validation.error });
      }

      const workEntry = await storage.createWorkEntry(validation.data);
      res.status(201).json(workEntry);
    } catch (error) {
      console.error("Create work entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/tickets/:id/tasks
  app.post("/api/cfm/tickets/:id/tasks", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const ticket = await storage.getTicketById(id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      if (ticket.status === 'closed' && req.session.cfmUser!.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only admin can modify closed tickets" });
      }
      const bodyData = { ...req.body };
      // Convert recordedAt string to Date if provided
      if (bodyData.recordedAt && typeof bodyData.recordedAt === 'string') {
        bodyData.recordedAt = new Date(bodyData.recordedAt);
      }
      const validation = insertUsedTaskEntrySchema.safeParse({
        ...bodyData,
        ticketId: id,
        createdBy: req.session.cfmUser!.id,
      });

      if (!validation.success) {
        return res.status(400).json({ error: "Invalid task entry data", details: validation.error });
      }

      // Create the used task entry
      const usedTaskEntry = await storage.createUsedTaskEntry(validation.data);

      // Create inventory transactions for each task item
      const items = validation.data.items as Array<{id: string, taskTypeId: string, quantity: number}>;
      for (const item of items) {
        await storage.createInventoryTransaction({
          type: "outgoing",
          taskTypeId: item.taskTypeId,
          quantity: item.quantity,
          date: new Date(),
          ticketId: id,
          notes: `Used in ticket via task entry`,
        });
      }

      res.status(201).json(usedTaskEntry);
    } catch (error) {
      console.error("Create task entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/tickets/:id/measurements
  app.post("/api/cfm/tickets/:id/measurements", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const ticket = await storage.getTicketById(id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      if (ticket.status === 'closed' && req.session.cfmUser!.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only admin can modify closed tickets" });
      }
      const bodyData = { ...req.body };
      // Convert recordedAt string to Date if provided
      if (bodyData.recordedAt && typeof bodyData.recordedAt === 'string') {
        bodyData.recordedAt = new Date(bodyData.recordedAt);
      }
      const validation = insertMeasurementEntrySchema.safeParse({
        ...bodyData,
        ticketId: id,
        createdBy: req.session.cfmUser!.id,
      });

      if (!validation.success) {
        return res.status(400).json({ error: "Invalid measurement entry data", details: validation.error });
      }

      const measurementEntry = await storage.createMeasurementEntry(validation.data);
      res.status(201).json(measurementEntry);
    } catch (error) {
      console.error("Create measurement entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /api/tickets/:ticketId/works/:id
  app.delete("/api/cfm/tickets/:ticketId/works/:id", requireAuth, async (req, res) => {
    try {
      const ticketId = req.params.ticketId as string;
      const id = req.params.id as string;
      const userRole = req.session.cfmUser!.role;
      
      // Only admin, cable_engineer, and supervisor can delete work entries
      if (userRole !== 'admin' && userRole !== 'cable_engineer' && userRole !== 'supervisor') {
        return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
      }
      
      // Validate entry exists and belongs to the ticket
      const entry = await storage.getWorkEntryById(id);
      if (!entry) {
        return res.status(404).json({ error: "Work entry not found" });
      }
      if (entry.ticketId !== ticketId) {
        return res.status(403).json({ error: "Forbidden: Entry does not belong to this ticket" });
      }

      // For closed tickets, only admin can delete
      const parentTicket = await storage.getTicketById(ticketId);
      if (parentTicket?.status === 'closed' && userRole !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only admin can modify closed tickets" });
      }
      
      await storage.deleteWorkEntry(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete work entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /api/tickets/:ticketId/tasks/:id
  app.delete("/api/cfm/tickets/:ticketId/tasks/:id", requireAuth, async (req, res) => {
    try {
      const ticketId = req.params.ticketId as string;
      const id = req.params.id as string;
      const userRole = req.session.cfmUser!.role;
      
      // Only admin, cable_engineer, and supervisor can delete task entries
      if (userRole !== 'admin' && userRole !== 'cable_engineer' && userRole !== 'supervisor') {
        return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
      }
      
      // Validate entry exists and belongs to the ticket
      const entry = await storage.getUsedTaskEntryById(id);
      if (!entry) {
        return res.status(404).json({ error: "Task entry not found" });
      }
      if (entry.ticketId !== ticketId) {
        return res.status(403).json({ error: "Forbidden: Entry does not belong to this ticket" });
      }

      // For closed tickets, only admin can delete
      const parentTicket = await storage.getTicketById(ticketId);
      if (parentTicket?.status === 'closed' && userRole !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only admin can modify closed tickets" });
      }
      
      await storage.deleteUsedTaskEntry(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete task entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /api/tickets/:ticketId/measurements/:id
  app.delete("/api/cfm/tickets/:ticketId/measurements/:id", requireAuth, async (req, res) => {
    try {
      const ticketId = req.params.ticketId as string;
      const id = req.params.id as string;
      const userRole = req.session.cfmUser!.role;
      
      // Only admin, cable_engineer, and supervisor can delete measurement entries
      if (userRole !== 'admin' && userRole !== 'cable_engineer' && userRole !== 'supervisor') {
        return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
      }
      
      // Validate entry exists and belongs to the ticket
      const entry = await storage.getMeasurementEntryById(id);
      if (!entry) {
        return res.status(404).json({ error: "Measurement entry not found" });
      }
      if (entry.ticketId !== ticketId) {
        return res.status(403).json({ error: "Forbidden: Entry does not belong to this ticket" });
      }

      // For closed tickets, only admin can delete
      const parentTicket = await storage.getTicketById(ticketId);
      if (parentTicket?.status === 'closed' && userRole !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only admin can modify closed tickets" });
      }
      
      await storage.deleteMeasurementEntry(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete measurement entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/tickets/:id/final-repair
  app.post("/api/cfm/tickets/:id/final-repair", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { finalRepairDescription } = req.body;

      const ticket = await storage.updateTicket(id, {
        finalRepairId: crypto.randomUUID(),
        finalRepairDescription: finalRepairDescription || "Repair completed",
        finalRepairRepairedAt: new Date(),
        finalRepairRepairedBy: req.session.cfmUser!.id,
        status: "pending_confirmation",
      });

      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      res.json(ticket);
    } catch (error) {
      console.error("Record final repair error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/tickets/:id/revert-repair - Revert final repair and return to open status
  app.post("/api/cfm/tickets/:id/revert-repair", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const userRole = req.session.cfmUser!.role;
      
      // Only admin, supervisor, ext_tech, external_affairs can revert
      if (!['admin', 'supervisor', 'ext_tech', 'external_affairs'].includes(userRole)) {
        return res.status(403).json({ error: "Not authorized to revert repair" });
      }

      const ticket = await storage.updateTicket(id, {
        finalRepairId: null,
        finalRepairDescription: null,
        finalRepairRepairedAt: null,
        finalRepairRepairedBy: null,
        status: "open",
      });

      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      res.json(ticket);
    } catch (error) {
      console.error("Revert repair error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/tickets/:id/confirm
  app.post("/api/cfm/tickets/:id/confirm", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;

      const ticket = await storage.updateTicket(id, {
        status: "closed",
        closedAt: new Date(),
        closedBy: req.session.cfmUser!.id,
      });

      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      res.json(ticket);
    } catch (error) {
      console.error("Confirm ticket error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ===== INVENTORY ROUTES ===== //

  // GET /api/inventory/transactions
  app.get("/api/cfm/inventory/transactions", requireAuth, async (req, res) => {
    try {
      const transactions = await storage.getAllInventoryTransactions();
      res.json(transactions);
    } catch (error) {
      console.error("Get inventory transactions error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/inventory/incoming
  app.post("/api/cfm/inventory/incoming", requireAuth, async (req, res) => {
    try {
      const validation = insertInventoryTransactionSchema.safeParse({
        ...req.body,
        type: "incoming",
        date: req.body.date ? new Date(req.body.date) : new Date(),
      });

      if (!validation.success) {
        return res.status(400).json({ error: "Invalid transaction data", details: validation.error });
      }

      const transaction = await storage.createInventoryTransaction(validation.data);
      res.status(201).json(transaction);
    } catch (error) {
      console.error("Create inventory transaction error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

}

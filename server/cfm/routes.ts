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
import { pool } from "../db";
import { findOpenTicketCoveringCableBox } from "../box-fault-ticket";
import { boxKey, expandBoxes } from "@shared/cab-norm";
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

type TicketBoxScoreLine = {
  fullPhone: string;
  score: number | null;
};

let ticketBoxScoreCache: {
  at: number;
  boxes: Map<string, TicketBoxScoreLine[]>;
} | null = null;

async function getTicketBoxScoreLines(): Promise<Map<string, TicketBoxScoreLine[]>> {
  const now = Date.now();
  if (ticketBoxScoreCache && now - ticketBoxScoreCache.at < 60_000) {
    return ticketBoxScoreCache.boxes;
  }

  const { rows } = await pool.query(`
    SELECT
      pl.central,
      pl.cabin_number,
      pl.box_number,
      pl.full_phone,
      latest.score
    FROM line_accounts la
    JOIN phone_lines pl ON pl.full_phone = la.full_phone
    LEFT JOIN LATERAL (
      SELECT c.score
      FROM case_138 c
      WHERE c.full_phone = la.full_phone
      ORDER BY c.id DESC
      LIMIT 1
    ) latest ON true
  `);

  const boxes = new Map<string, TicketBoxScoreLine[]>();
  for (const row of rows) {
    const key = boxKey(row.central, row.cabin_number, row.box_number);
    if (!key.endsWith("|")) {
      const lines = boxes.get(key) ?? [];
      lines.push({
        fullPhone: String(row.full_phone ?? "").trim(),
        score: row.score == null ? null : Number(row.score),
      });
      boxes.set(key, lines);
    }
  }

  ticketBoxScoreCache = { at: now, boxes };
  return boxes;
}

export function calculateTicketBoxScore(
  ticket: any,
  scoreLines: Map<string, TicketBoxScoreLine[]>,
) {
  const central = ticket?.central?.name ?? ticket?.centralDepartment;
  const cabinet = ticket?.cable?.number ?? ticket?.cabinet;
  const seenPhones = new Set<string>();
  let sum = 0;
  let measured = 0;

  for (const box of expandBoxes(ticket?.box)) {
    const key = boxKey(central, cabinet, box);
    for (const line of scoreLines.get(key) ?? []) {
      const phoneKey = line.fullPhone || `${key}|${measured}`;
      if (seenPhones.has(phoneKey)) continue;
      seenPhones.add(phoneKey);
      if (line.score != null && Number.isFinite(line.score) && line.score <= 100) {
        sum += line.score;
        measured++;
      }
    }
  }

  return {
    averageScore: measured > 0 ? Math.round((sum / measured) * 10) / 10 : null,
    measuredLines: measured,
  };
}

function enrichTicketWithBoxScore(ticket: any, scoreLines: Map<string, TicketBoxScoreLine[]>) {
  const score = calculateTicketBoxScore(ticket, scoreLines);
  return {
    ...ticket,
    boxAvgScore: score.averageScore,
    boxMeasuredLines: score.measuredLines,
  };
}

// الجلسة كانت بتخزّن صورة كاملة من المستخدم — تنزيل رتبة/إيقاف/حذف حساب ماكانش
// بيسرى على الجلسات المفتوحة (لحد 7 أيام). هنا بنقرا الحساب طازج من قاعدة
// البيانات فى كل طلب: المحذوف/الموقوف بيتطرد فوراً، وتغيير الدور بيسرى فوراً.
async function refreshCfmSession(req: express.Request): Promise<User | null> {
  const sess = req.session.cfmUser;
  if (!sess) return null;
  try {
    const fresh = await storage.getUser(sess.id);
    if (!fresh || (fresh as any).suspended) { delete req.session.cfmUser; return null; }
    req.session.cfmUser = fresh;
    return fresh;
  } catch { return sess; /* فشل مؤقت فى القراءة مايطردش مستخدم شغّال */ }
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  refreshCfmSession(req)
    .then((u) => (u ? next() : res.status(401).json({ error: "Unauthorized" })))
    .catch(next);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  refreshCfmSession(req)
    .then((u) => {
      if (!u) return res.status(401).json({ error: "Unauthorized" });
      if (u.role !== "admin") return res.status(403).json({ error: "Forbidden: Admin access required" });
      next();
    })
    .catch(next);
}

export function registerCfmRoutes(app: Express) {
  // (مسارات الاستيراد لمرة واحدة _import-from-live و_import-from-prod-db اتشالت —
  //  كانت أداة نقل بيانات الكوابل وقت الدمج، والنقل خلص والبيانات عايشة هنا.)

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
      if ((user as any).suspended) {
        return res.status(403).json({ error: "الحساب موقوف" });
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
  app.post("/api/cfm/auth/logout", (req: any, res) => {
    // لو المستخدم داخل عن طريق Service-Flow (SSO) → خروج كامل من الطلبات كمان ونوجّهه لدخول الطلبات.
    // لو مستخدم كوابل مباشر (بدون حساب طلبات) → نمسح جلسة الكوابل فقط ويرجع لدخول الكوابل.
    const ssoFromSf = typeof req.isAuthenticated === "function" && req.isAuthenticated();
    delete (req.session as any).cfmUser;
    if (ssoFromSf) {
      req.logout((err: any) => {
        if (err) return res.json({ success: true }); // fallback هادئ
        req.session.destroy(() => { res.clearCookie("connect.sid"); res.json({ success: true, redirect: "/login" }); });
      });
    } else {
      req.session.save(() => res.json({ success: true }));
    }
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

  // GET /api/cfm/master-data/fcc-centrals — أسماء السنترالات الصحيحة من FCC (phone_lines).
  // تُستخدم فى شاشة «توحيد أسماء السنترالات» لمطابقة أسماء الكوابل بأسماء FCC المرجعية.
  app.get("/api/cfm/master-data/fcc-centrals", requireAuth, async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT DISTINCT central FROM phone_lines WHERE central IS NOT NULL AND btrim(central) <> '' ORDER BY central`,
      );
      res.json((r.rows as any[]).map((x) => x.central));
    } catch (error) {
      console.error("Get FCC centrals error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // فنى الكابينة — (السنترال + رقم الكابينة) → اسم الفنى المسؤول.
  // مصدر البيانات هو نفس جدول برنامج الصيانة (cabinet_technicians) عشان الاسم
  // اللى بيظهر فى تقارير الكوابل يبقى هو نفسه اللى فى الصيانة من غير إدخال تانى.
  app.get("/api/cfm/master-data/cabinet-techs", requireAuth, async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT ct.central_name AS "centralName", ct.cabin_number AS "cabinNumber",
                tn.tech_name AS "techName"
           FROM cabinet_technicians ct
           JOIN technician_names tn ON tn.worker_code = ct.worker_code
          WHERE COALESCE(btrim(tn.tech_name), '') <> ''`);
      res.json(r.rows);
    } catch (error) {
      console.error("Get cabinet techs error:", error);
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
  // بيانات منشئ التكت بترجع مع كل تكت (relations) — لازم نشيل منها الهاش وكل
  // الحساس قبل الإرسال: كانت بترجع bcrypt hash لكل حساب فتح تكت لأى مستخدم مسجّل.
  const sanitizeTicket = (t: any) => {
    if (t?.createdByUser) {
      const { id, username, name, role, avatar } = t.createdByUser;
      t.createdByUser = { id, username, name, role, avatar };
    }
    return t;
  };

  app.get("/api/cfm/tickets", requireAuth, async (req, res) => {
    try {
      const tickets = await storage.getAllTickets();
      let scoreLines = new Map<string, TicketBoxScoreLine[]>();
      try {
        scoreLines = await getTicketBoxScoreLines();
      } catch (error) {
        console.error("Get ticket box scores error:", error);
      }
      res.json(tickets.map((ticket) => sanitizeTicket(enrichTicketWithBoxScore(ticket, scoreLines))));
    } catch (error) {
      console.error("Get tickets error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/cfm/box-cases — عدد المتعذرات «بوكس معطل» على كل بكس (سنترال+كابينة+بكس).
  // بيغذّى عمود «متعذرات» فى قائمة التكتات: مجموع متعذرات OM + الطلبات المتعذرة على
  // نفس البكس. المصدر هو بيانات Service-Flow نفسها مش ملاحظات التكت — فالعدد بيبان
  // حتى لو التكت اتفتحت قبل ما نبدأ نكتب المتعذرات فى الملاحظات.
  app.get("/api/cfm/box-cases", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT central_name AS central, cabin_number AS cabinet, box_number AS box,
                COUNT(*) FILTER (WHERE src = 'OM')::int      AS om,
                COUNT(*) FILTER (WHERE src = 'طلبات')::int   AS orders
           FROM (
             -- ⚠️ لازم شرط الحالة كمان مش سبب التعذر بس: الطلب اللى اتحوّل لـ«يمكن
             -- التنفيذ» ممكن يكون لسه شايل سبب التعذر القديم من رفعة/رد أقدم، فكان
             -- بيفضل محسوب متعذر على البكس للأبد. الشرط ده بيشيله فوراً من غير أى
             -- تعديل على البيانات القديمة.
             SELECT 'طلبات' AS src, central_name, cabin_number, box_number
               FROM orders
              WHERE rejection_reason = $1 AND COALESCE(btrim(box_number), '') <> ''
                AND status NOT IN ('feasible', 'external_feasible')
             UNION ALL
             SELECT 'OM', central_name, cabin_number, box_number
               FROM om_responses
              WHERE rejection_reason = $1 AND COALESCE(btrim(box_number), '') <> ''
                AND COALESCE(status, '') NOT IN ('feasible', 'external_feasible')
                AND COALESCE(is_feasible, false) = false
                AND COALESCE(is_feasible_external, false) = false
                -- المتعذر اللى اتأكّد إنه **نفس** طلب فى قسم الطلبات مابيتعدّش تانى:
                -- الاتنين نفس العميل ونفس الحالة، فيتحسبوا متعذر واحد على البكس مش 2.
                -- (بنستبعد جنب OM ونسيب جنب الطلبات — الطلب هو السجل الأصلى.)
                AND NOT EXISTS (SELECT 1 FROM om_order_matches mm
                                 WHERE mm.om_serial = om_responses.serial_number)
           ) x
          GROUP BY 1, 2, 3`, ["بوكس معطل"]);
      res.json(rows);
    } catch (error) {
      console.error("Get box cases error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/cfm/box-cases/details — التفاصيل التى تغذّى عدّاد المتعذرات.
  // نفس شروط عدّاد /box-cases بالحرف، مع بيانات العميل إن كانت موجودة.
  app.get("/api/cfm/box-cases/details", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT *
           FROM (
             SELECT 'طلبات' AS source,
                    o.id::text AS reference,
                    o.customer_name AS name,
                    o.customer_address AS address,
                    o.customer_phone AS mobile,
                    o.central_name AS central,
                    o.cabin_number AS cabinet,
                    o.box_number AS box,
                    o.rejection_reason AS reason
               FROM orders o
              WHERE o.rejection_reason = $1
                AND COALESCE(btrim(o.box_number), '') <> ''
                AND o.status NOT IN ('feasible', 'external_feasible')

             UNION ALL

             SELECT 'OM' AS source,
                    r.serial_number::text AS reference,
                    fo.customer_name AS name,
                    fo.install_address AS address,
                    COALESCE(omm.mobile, wfm.mobile, fo.customer_mobile) AS mobile,
                    r.central_name AS central,
                    r.cabin_number AS cabinet,
                    r.box_number AS box,
                    r.rejection_reason AS reason
               FROM om_responses r
               LEFT JOIN ftth_orders_current fo
                 ON fo.serial_number = r.serial_number
               LEFT JOIN om_manual_mobiles omm
                 ON omm.serial_number = r.serial_number
               LEFT JOIN (
                 SELECT reference_no, MIN(mobile) AS mobile
                   FROM maintenance_orders
                  WHERE work_order_type ILIKE 'fvmanualsurvey'
                    AND COALESCE(btrim(mobile), '') <> ''
                  GROUP BY reference_no
               ) wfm
                 ON wfm.reference_no = fo.service_order_id
              WHERE r.rejection_reason = $1
                AND COALESCE(btrim(r.box_number), '') <> ''
                AND COALESCE(r.status, '') NOT IN ('feasible', 'external_feasible')
                AND COALESCE(r.is_feasible, false) = false
                AND COALESCE(r.is_feasible_external, false) = false
                AND NOT EXISTS (
                  SELECT 1
                    FROM om_order_matches mm
                   WHERE mm.om_serial = r.serial_number
                )
           ) details
          ORDER BY central, cabinet, box, source, reference`,
        ["بوكس معطل"],
      );
      res.json(rows);
    } catch (error) {
      console.error("Get box case details error:", error);
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
      res.json(sanitizeTicket(ticket));
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

      // منع تكرار التكت على نفس البكس — نفس السنترال ونفس الكابينة ونفس البكس
      // (مع فكّ النطاقات: تكت على «1:5» بتغطى بكس 4 ضمنياً).
      // بيمنع **فقط** لو التكت القديمة لسه «مفتوحة»؛ لو فى انتظار التأكيد أو
      // مغلقة يبقى الفتح عادى.
      const dup = await findOpenTicketCoveringCableBox(validation.data.cableId, validation.data.box);
      if (dup) {
        const when = dup.createdAt ? new Date(dup.createdAt).toLocaleDateString("ar-EG") : "";
        const details = [
          `سنترال ${dup.central}`,
          `كابينة ${dup.cabinet}`,
          `بكس ${dup.box}`,
          dup.faultType ? `نوع العطل ${dup.faultType}` : "",
          when ? `تاريخ الفتح ${when}` : "",
        ].filter(Boolean).join(" — ");
        return res.status(409).json({
          error: `تعذّر فتح التكت — البكس ${dup.matchedBox} موجود بالفعل فى تكت مفتوحة رقم ${dup.ticketNumber} `
               + `وبياناتها الفنية: ${details}. لازم التكت دى تتقفل أو تروح لانتظار التأكيد الأول.`,
        });
      }

      // رقم التكت: MAX رقمى مباشر من الداتابيز (كان بيجيب **كل** التكتات بعلاقاتها
      // فى الذاكرة عشان يحسب رقم!) + إعادة محاولة لو اتنين ضغطوا «إنشاء» فى نفس
      // اللحظة (قيد التفرّد كان بيرجّع 500 والفورم يضيع).
      const currentYear = new Date().getFullYear();
      let ticket: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { rows: mx } = await pool.query(
          `SELECT COALESCE(MAX(CASE WHEN ticket_number ~ ('^TKT-' || $1 || '-[0-9]+$')
                     THEN split_part(ticket_number, '-', 3)::int END), 0) + 1 AS next
             FROM tickets WHERE ticket_number LIKE 'TKT-' || $1 || '-%'`, [String(currentYear)]);
        const ticketNumber = `TKT-${currentYear}-${String(mx[0].next).padStart(3, '0')}`;
        try {
          ticket = await storage.createTicket({ ...validation.data, ticketNumber } as any);
          break;
        } catch (e: any) {
          if (e?.code === "23505" && attempt < 4) continue;  // اتسبق على الرقم → جرّب تانى
          throw e;
        }
      }

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
      // كانت بتقبل أى نص من أى مستخدم: قيمة غريبة بتخرج التكت من كل الفلاتر
      // (والحالة الوحيدة اللى بيتحسب عليها منع التكرار هى 'open') — فكانت طريقة
      // لتجاوز منع فتح تكت مكررة على نفس البكس. وأدوار العرض ماينفعش تقفل تكتات.
      const ALLOWED_STATUS = ["open", "pending_confirmation", "closed", "cancelled"];
      if (!ALLOWED_STATUS.includes(status)) {
        return res.status(400).json({ error: "قيمة حالة غير صحيحة" });
      }
      const roleSt = req.session.cfmUser!.role;
      if (roleSt === "splice_tech") {
        return res.status(403).json({ error: "غير مسموح لهذا الدور بتغيير حالة التكت" });
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

      // items لازم تكون مصفوفة قبل ما نحفظ أى حاجة — عمود json بيقبل أى شكل،
      // وكان السطر بيتحفظ وبعدها اللوب يقع فيفضل بند من غير حركات مخزن.
      if (!Array.isArray(validation.data.items)) {
        return res.status(400).json({ error: "items لازم تكون مصفوفة بنود" });
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
      
      // إرجاع الخامات للمخزن: الحذف كان بيشيل السطر ويسيب حركات الصرف زى ما هى،
      // فتصحيح كمية غلط (حذف وإعادة إضافة) كان بيخصم الخامة مرتين للأبد.
      const entryItems = Array.isArray(entry.items)
        ? (entry.items as Array<{ taskTypeId: string; quantity: number }>)
        : [];
      for (const item of entryItems) {
        if (!item?.taskTypeId || !item?.quantity) continue;
        await storage.createInventoryTransaction({
          type: "incoming",
          taskTypeId: item.taskTypeId,
          quantity: item.quantity,
          date: new Date(),
          ticketId,
          notes: "إرجاع خامات — حذف بند مهمات من التكت",
        });
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
      // الفنى المساعد (splice_tech) دور عرض — مايسجّلش تنظيم. والتكت المغلقة
      // ماينفعش ترجع pending_confirmation وهى محتفظة بـ closed_at (تبان مغلقة ومعلّقة معاً).
      if (req.session.cfmUser!.role === "splice_tech") {
        return res.status(403).json({ error: "غير مسموح لهذا الدور بتسجيل التنظيم" });
      }
      const cur = await storage.getTicketById(id);
      if (!cur) return res.status(404).json({ error: "Ticket not found" });
      if (cur.status === "closed") {
        return res.status(400).json({ error: "التكت مغلقة — أعد فتحها الأول (revert)" });
      }

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
        // من غير دول: تكت «مفتوحة» بتاريخ إغلاق قديم — تقارير الإغلاق بتحسبها مغلقة
        closedAt: null,
        closedBy: null,
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
      // التأكيد = إغلاق نهائى — كان مفتوح لأى دور وعلى أى حالة، فكان ممكن يقفل تكت
      // لسه open من غير تنظيم أصلاً، أو يعيد كتابة closed_by على تكت مغلقة.
      const roleC = req.session.cfmUser!.role;
      if (!["admin", "external_affairs", "supervisor"].includes(roleC)) {
        return res.status(403).json({ error: "غير مسموح لهذا الدور بتأكيد الإغلاق" });
      }
      const curC = await storage.getTicketById(id);
      if (!curC) return res.status(404).json({ error: "Ticket not found" });
      if (curC.status !== "pending_confirmation") {
        return res.status(400).json({ error: "التكت مش فى انتظار التأكيد" });
      }

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

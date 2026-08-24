import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureSchema } from "./db";
import { createRequire } from "module";

// شبكة أمان: هاندلر async من غير try/catch لما يرمى خطأ، Node بيعتبره unhandled
// rejection وبيقفل البروسيس كله — يعنى غلطة واحدة فى استعلام كانت بتوقع السيرفر
// لكل المستخدمين. بنسجّل ونكمّل بدل ما نقع.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", (reason as any)?.stack || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.stack || err);
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    // Buffer مش unknown — أى استخدام كان بيحتاج type assertion يدوى
    rawBody?: Buffer;
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // نقتطع الرد فى اللوج: الردود الكبيرة (كل التكتات مثلاً) كانت بتتسلسل كاملة
        // فى كل طلب — حمل بلا داعى، وكمان ممكن تسرّب بيانات حساسة فى اللوجات.
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 400)}`;
      }

      log(logLine);
    }
  });

  next();
});

// /api/health — فحص جاهزية حقيقى (بيتسجّل قبل الـ SPA catch-all عشان مايرجّعش HTML).
// أنظمة المراقبة والنشر بتسأل عليه؛ قبل كده كان بيرجّع صفحة التطبيق فمكانش بيقول
// أى حاجة عن حالة الـ API ولا الداتابيز.
app.get("/api/health", async (_req, res) => {
  const started = Date.now();
  try {
    const { pool } = await import("./db");
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up", uptimeSec: Math.round(process.uptime()), tookMs: Date.now() - started });
  } catch (e: any) {
    res.status(503).json({ ok: false, db: "down", error: e?.message || "db error" });
  }
});

(async () => {
  await ensureSchema();
  // إدخال سعة الكباين تلقائياً لو الجدول فاضى (يشتغل مع النشر بدون كونسول)
  const { seedCabinetCapacityIfEmpty } = await import("./seed-cabinet-capacity");
  await seedCabinetCapacityIfEmpty();
  // إدخال بكسيات DP تلقائياً لو الجدول فاضى (من صور Network Inventory — للاختبار/التشغيل الأولى)
  const { seedDpInventoryIfEmpty } = await import("./seed-dp-inventory");
  await seedDpInventoryIfEmpty();
  await registerRoutes(httpServer, app);

  // ركّب تطبيق الصيانة (Express+EJS) تحت /maintenance — بيتحمّل كـ CommonJS **غير مبنْدَل** عشان
  // مكتباته الأصلية (sharp/bcrypt…) و__dirname/قوالب EJS يتحلّوا وقت التشغيل. لازم قبل الـ catch-all
  // بتاع الـ SPA. لو فشل التحميل (مثلاً مكتبة ناقصة) نكمّل من غيره بدل ما نوقّف السيرفر كله.
  // جداول الصيانة معزولة فى سكيما maintenance، فتشغيلها على قاعدة Service-Flow نفسها آمن.
  // نركّبه لو MAINTENANCE_ENABLED=true (يستخدم قاعدة Service-Flow بسكيما maintenance) أو لو فيه
  // MAINTENANCE_DATABASE_URL منفصل. لو مفيش الاتنين → مايتركّبش (تجنّب تحميل database.js بالغلط).
  if (process.env.MAINTENANCE_ENABLED === "true" || process.env.MAINTENANCE_DATABASE_URL) {
    try {
      // base مزدوج: __filename فى بناء الإنتاج (CJS) و import.meta.url فى التطوير (ESM/tsx).
      // بنحمّله بمسار نسبى فيتحلّ جنب ملف الدخول (server/ فى dev، dist/ فى prod).
      const requireCjs = createRequire(typeof __filename !== "undefined" ? __filename : import.meta.url);
      const maintenanceApp = requireCjs("./maintenance/app/app.js");
      app.use("/maintenance", maintenanceApp);
      log("mounted maintenance app at /maintenance");
    } catch (e: any) {
      console.error("[maintenance] mount failed:", e?.message || e);
    }
  } else {
    log("maintenance app not mounted (MAINTENANCE_ENABLED غير مفعّل)");
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    // ⚠️ ماترميش الخطأ تانى: بعد ما الرد اتبعت، إعادة الرمى كانت بتقطع الاتصال
    // على العميل (بدل الرسالة) وممكن توقع البروسيس كله.
    console.error("[api-error]", err?.stack || err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

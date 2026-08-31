import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // index.html بيتخدم دايماً no-cache (لازم يترجع للسيرفر كل مرة) — لأن أسماء ملفات
  // JS/CSS بتاعة Vite فيها hash بيتغيّر مع كل نشر، وبيانها موجودة جوّه index.html نفسه.
  // لو المتصفح كاش index.html القديم (مفيش Cache-Control ظاهر = كاش heuristic احتمالى)،
  // هيفضل يحاول يحمّل ملفات JS قديمة اتمسحت بعد آخر نشر → تقارير الموقع تفضل شغالة بكود
  // قديم لحد ما المستخدم يعمل Ctrl+Shift+R يدوياً. الأصول التانية (JS/CSS المهشّرة) تفضل
  // بكاش الافتراضى بتاع express.static عادى لأن اسمها بيتغيّر مع كل تغيير فى المحتوى.
  app.use(express.static(distPath, { index: false }));

  // fall through to index.html if the file doesn't exist
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

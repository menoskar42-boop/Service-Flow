# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## MANDATORY CODING CONSTRAINTS — Must be followed in every task

1. **Never rewrite entire existing files** — always edit in place.
2. **Always use str_replace (Edit tool) for edits to existing files** — never Write-overwrite a file that already exists.
3. **Add new features one at a time** — implement, commit, push; then move to the next feature.
4. **For files over 200 lines: insert/replace code sections only** — never a full file replacement.
5. **If a task is complex, break it into steps and confirm after each step** before continuing.
6. **Always push to `origin/main`** after every commit.
7. **Every report in the reports section (`قسم التقارير`) must have an Excel export button and a PDF export button** — follow the existing pattern in `CurrentFaultsReport.tsx` / `RegularizedFaultsReport.tsx` (`handleExportExcel` via XLSX + `handleExportPDF` via a printable RTL HTML window).
8. **Every new column added to any table in `shared/schema.ts` MUST be accompanied — in the same commit — by a matching `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type>` at the start of `ensureSchema()` in `server/db.ts`** (and `CREATE TABLE IF NOT EXISTS` for new tables), so it gets applied to the Replit dev DB on server restart and prod/dev stay in sync (see "Replit Deploy" section below).
9. **Whenever ANY Tampermonkey/userscript is changed, ALWAYS do BOTH of the following in the same turn:**
   - (a) **Keep the canonical copy saved in a project file** and edit it in place (e.g. `dzs-expresse-v10.user.js`, `customer360-account-grabber.user.js`, `tampermonkey-v2.9.js`). This file is the single source of truth — every change goes through it, then commit + push to `origin/main`. This lets future sessions read the current code and continue from it.
   - (b) **Output the ENTIRE updated script in the chat reply** (the full file, not just the modified section) — the user copies it directly from chat into Tampermonkey.
   Applies to every Tampermonkey code change, no exceptions.

## Domain Context
- Expert full-stack engineer (40+ years experience).
- Expert telecom engineer specializing in fixed-line (PSTN/ADSL/MSAN) fault diagnosis and network data (50+ years experience).
- Application domain: fixed-line telephone network management (كابينات، بكسيات، DP terminals، خطوط تليفون ثابت).

## Commands

```bash
npm run dev        # Start development server (tsx server/index.ts, port 5000)
npm run build      # Build client (Vite) + server (esbuild) to dist/
npm run start      # Run production build (dist/index.cjs)
npm run check      # TypeScript type checking
npm run db:push    # Sync Drizzle schema to PostgreSQL
```

No test runner or linter is configured.

## Architecture

**Monorepo**: `client/` (React), `server/` (Express), `shared/` (types/schemas shared by both).

### Shared Layer (`shared/`)
- `schema.ts` — Drizzle ORM table definitions + Zod validation schemas. This is the single source of truth for data shapes, used by both frontend forms and backend API validation.
- `routes.ts` — Typed API route definitions (URL constants + request/response types).

### Backend (`server/`)
- `index.ts` → `routes.ts` — Express app with REST API under `/api/*` and WebSocket server at `/ws`.
- `storage.ts` — `DatabaseStorage` class (implements `IStorage` interface) is the sole data access layer; all DB calls go through it.
- `db.ts` — Drizzle ORM client + PostgreSQL connection pool (`DATABASE_URL` env var required).
- Authentication: Passport.js local strategy + express-session (MemoryStore — not suitable for multi-process deployment). Session secret is hardcoded.
- Passwords: scrypt hashing with per-user salt.

### Frontend (`client/src/`)
- **Routing**: Wouter (not React Router).
- **Server state**: TanStack React Query. Custom hooks in `hooks/` wrap all API calls (`use-auth.ts`, `use-orders.ts`, `use-users.ts`).
- **Real-time**: `use-websocket.ts` subscribes to `ORDER_CREATE` / `ORDER_UPDATE` WebSocket events and invalidates React Query cache.
- **UI**: shadcn/ui components (Radix UI primitives) in `components/ui/`. Custom business components are in `components/`.
- **Data export**: XLSX (SheetJS) in the orders table component.

### Role-Based Access
Three roles (`SALES`, `TECH`, `ADMIN`) enforced at the API layer in `server/routes.ts`. The dashboard (`pages/dashboard.tsx`) renders different UI per role. Default seed users: `sales/sales`, `tech/tech`, `admin/admin`.

### Data Model (key fields in `orders` table)
Orders store denormalized `salesName` and `techName` directly. Status flows: Sales creates order → Tech sets feasibility (isFeasible + optional rejection reason/cabinet details) → Admin sets contractStatus (`"تم التعاقد"` / `"لم يتم التعاقد"`).

## Environment Variables

| Variable | Required | Default |
|---|---|---|
| `DATABASE_URL` | Yes | — |
| `PORT` | No | 5000 |
| `NODE_ENV` | No | — |

## Path Aliases
- `@/*` → `client/src/`
- `@shared/*` → `shared/`

## UI Language
The application UI is in Arabic with RTL layout (`dir="rtl"` on the dashboard). Enum values (rejection reasons, central names, contract status) are Arabic strings defined in `shared/schema.ts`.

## Replit Deploy — DROP COLUMN/TABLE warnings (الحل المجرَّب)

**سبب المشكلة**: زر Publishing في Replit يقارن **dev DB مع prod DB مباشرة**. لو prod فيها أعمدة/جداول غير موجودة في dev DB، يولّد Replit تحذيرات `DROP COLUMN` / `DROP TABLE` لمسحها من prod.

**الحل (3 خطوات — يجب أن تكون الثلاثة متزامنة دائماً عند إضافة أي عمود/جدول جديد):**
1. **`server/db.ts` → `ensureSchema()`**: أضف `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type>` (أو `CREATE TABLE IF NOT EXISTS`) — يعمل تلقائياً عند تشغيل السيرفر.
2. **`shared/schema.ts`**: أضف نفس الأعمدة في تعريف الجدول (pgTable) — حتى لا يعتبرها أي diff أعمدة زائدة.
3. **dev DB في Replit**: شغّل نفس الـ ALTERs يدوياً عبر `psql $DATABASE_URL -c "..."` في Replit Shell (أو أعد تشغيل dev server ليُنفّذ `ensureSchema()` على dev DB) — **هذه الخطوة هي التي تزيل التحذيرات** لأنها تجعل dev DB مطابقة لـ prod DB.

**قواعد دائمة**:
- لا تستخدم أبداً `drizzle-kit push` / `db:push` — كل إدارة الـ schema حصرياً عبر `ensureSchema()` بصيغ idempotent (لا DROP أبداً).
- `drizzle.config.ts` فيه `tablesFilter: ["!*"]` عمداً — لا تحذفه.
- لو Replit Agent عدّل `schema.ts` في الـ workspace: `git fetch origin && git reset --hard origin/main` في Replit Shell ثم Republish.

**ملاحظات مجرَّبة (نجحت فعلياً 2026-06)**:
- تعديل `server/db.ts` في Replit workspace **لا يكفي وحده**: الـ HMR يعيد تحميل الـ frontend فقط، و`ensureSchema()` لا يُنفَّذ على dev DB إلا بإعادة تشغيل الـ backend. الأسرع والأضمن: تنفيذ الـ ALTERs مباشرة عبر `psql $DATABASE_URL -c "..."` في Replit Shell (نجاح كل سطر يظهر كـ `ALTER TABLE` في الناتج).
- تحذيرات DROP داخل عملية Publishing **جارية** هي snapshot قديم محسوب قبل مزامنة dev DB — لا تتحدث تلقائياً. بعد المزامنة: Cancel ثم Republish جديد.
- قبل الضغط على **Approve and publish**: افتح قسم "Generated migrations" المطوي (حتى لو ظهر "validated successfully") وتأكد بالعين أن القائمة خالية من أي `DROP COLUMN` / `DROP TABLE`. لو فيها DROP → Cancel وRepublish جديد.

**دليل التصرف الكامل حسب نوع التحذير (مجرَّب بالكامل 2026-06-11 — اتبعه حرفياً من أول مرة):**

| التحذير في شاشة Publishing | السبب | العلاج |
|---|---|---|
| `DROP COLUMN x` | العمود موجود في prod وناقص في dev DB | `psql $DATABASE_URL -c "ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type>"` ثم Cancel + Republish |
| `DROP TABLE x CASCADE` | الجدول موجود في prod وناقص في dev DB | `psql` بـ `CREATE TABLE` **منسوخ حرفياً من `ensureSchema()` في `server/db.ts`** ثم Cancel + Republish |
| شاشة "Detected potential conflicts / rename column?" | جدول dev اتعمل بأسماء أعمدة غلط (غالباً من تخمين Replit Agent) | **لا تضغط Submit أبداً** (الاختيارات تمسح بيانات prod). Cancel → `DROP TABLE` للجدول الغلط في dev (آمن — dev فاضي) → إعادة إنشائه بالـ DDL الصحيح من `ensureSchema()` → `\d <table>` للتأكد → Republish |

**قواعد ذهبية من الحادثة:**
1. **المصدر الوحيد الموثوق للـ DDL هو `ensureSchema()` في `server/db.ts`** — انسخ منه حرفياً (أسماء الأعمدة، الـ constraints، الـ indexes). لا تخمّن أبداً ولا تثق في DDL يقترحه Replit Agent (خمّن `item_data`/`uploaded_at` بدل `data`/`created_at` ونسي `central_name` — كاد يمسح أرشيف prod مرتين).
2. **لا توافق أبداً على اقتراح "عدّل schema.ts ليطابق dev DB"** — الاتجاه الصحيح دائماً: عدّل dev DB ليطابق الكود/prod.
3. لو Replit Agent عدّل ملفات الـ workspace: `git fetch origin && git reset --hard origin/main` يرجّع كل شيء (تحقّق أولاً أن origin/main لم يستقبل commits غريبة بـ `git log`).
4. بعد أي إصلاح على dev DB: تحقّق بـ `psql $DATABASE_URL -c "\d <table>"` أن الهيكل مطابق لـ `ensureSchema()` **قبل** الـ Republish.
5. التسلسل الكامل دائماً: إصلاح dev DB بـ psql → `\d` للتحقق → Cancel للنشر الجاري → Republish جديد → فتح Generated migrations والتأكد أنها **فارغة تماماً** → Approve and publish.

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

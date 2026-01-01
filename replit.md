# replit.md

## Overview

This is an order management system with role-based access control supporting sales representatives, technicians, and administrators. The application allows sales staff to create customer orders, technicians to assess feasibility, and admins to manage users. The interface is in Arabic, indicating it's built for an Arabic-speaking market.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Build Tool**: Vite with custom plugins for Replit integration

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Runtime**: Node.js with tsx for TypeScript execution
- **API Pattern**: RESTful endpoints under `/api/*` prefix
- **Real-time**: WebSocket server on `/ws` path for live updates
- **Authentication**: Passport.js with local strategy, session-based auth using express-session
- **Password Security**: Node.js crypto module with scrypt hashing

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` (shared between frontend and backend)
- **Migrations**: Drizzle Kit with `db:push` command for schema sync
- **Session Store**: MemoryStore (in-memory, suitable for development)

### Project Structure
```
├── client/          # React frontend
│   ├── src/
│   │   ├── components/ui/  # shadcn/ui components
│   │   ├── pages/          # Route components
│   │   ├── hooks/          # Custom React hooks
│   │   └── lib/            # Utilities and query client
├── server/          # Express backend
│   ├── index.ts     # Server entry point
│   ├── routes.ts    # API routes and WebSocket setup
│   ├── storage.ts   # Database access layer
│   └── db.ts        # Database connection
├── shared/          # Shared types and schemas
│   ├── schema.ts    # Drizzle table definitions
│   └── routes.ts    # API contract definitions with Zod
└── migrations/      # Database migrations
```

### Key Design Decisions

1. **Monorepo Structure**: Single repository with client, server, and shared code for type safety across the stack.

2. **Shared Schema Validation**: Zod schemas in `shared/` directory ensure consistent validation between frontend and backend.

3. **Role-Based Access**: Three user roles (sales, tech, admin) with different permissions and views.

4. **Real-time Updates**: WebSocket integration broadcasts order changes to connected clients.

5. **Denormalized Data**: Order records store `salesName` and `techName` directly for easier display and export.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe database queries and schema management

### Authentication
- **Passport.js**: Authentication middleware with local username/password strategy
- **express-session**: Server-side session management

### UI Libraries
- **Radix UI**: Headless accessible component primitives
- **shadcn/ui**: Pre-styled component library
- **Lucide React**: Icon library

### Data Export
- **XLSX (SheetJS)**: Excel file generation for order exports

### Build & Development
- **Vite**: Frontend bundler with HMR
- **esbuild**: Production server bundling
- **tsx**: TypeScript execution for development
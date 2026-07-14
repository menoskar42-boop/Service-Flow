// Drizzle instance لجداول CFM — بيعيد استخدام نفس pool بتاع Service-Flow
import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "../db";
import * as schema from "@shared/cfm-schema";

export const db = drizzle(pool, { schema });

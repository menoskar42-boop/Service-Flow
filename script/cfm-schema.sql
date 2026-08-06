-- ============================================================================
-- cfm-schema.sql — إنشاء جداول Cable-Fault-Manager فى dev DB (نفس اللى فى ensureSchema)
-- الغرض: تسكيت تحذيرات DROP TABLE فى Replit Publishing — بنخلّى dev DB يطابق prod.
-- التشغيل (فى شيل Replit بتاع Service-Flow):
--     psql "$DATABASE_URL" -f script/cfm-schema.sql
-- كله CREATE TABLE IF NOT EXISTS (idempotent، بدون DROP).
-- ============================================================================
CREATE TABLE IF NOT EXISTS cfm_users (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username text NOT NULL UNIQUE,
  password text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  avatar text,
  is_initial_password boolean DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS centrals (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cables (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  central_id varchar NOT NULL REFERENCES centrals(id) ON DELETE CASCADE,
  number text NOT NULL,
  cable_number text,
  cabinet_number text,
  type text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (central_id, number)
);
CREATE TABLE IF NOT EXISTS fault_types (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  category text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS work_types (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  associated_materials jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS task_types (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contractors (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS excavation_workers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  national_id text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tickets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ticket_number text NOT NULL UNIQUE,
  central_department text NOT NULL,
  central_id varchar NOT NULL REFERENCES centrals(id),
  cable_id varchar NOT NULL REFERENCES cables(id),
  cabinet text NOT NULL,
  box text NOT NULL,
  fault_type_id varchar NOT NULL REFERENCES fault_types(id),
  notes text,
  latitude double precision,
  longitude double precision,
  status text NOT NULL DEFAULT 'open',
  final_repair_id varchar,
  final_repair_description text,
  final_repair_repaired_at timestamp,
  final_repair_repaired_by varchar,
  closed_at timestamp,
  closed_by text,
  created_by varchar NOT NULL REFERENCES cfm_users(id),
  opened_by_label text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_number_idx ON tickets (ticket_number);
CREATE INDEX IF NOT EXISTS status_idx ON tickets (status);
CREATE TABLE IF NOT EXISTS measurement_entries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ticket_id varchar NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  reading text NOT NULL,
  distance double precision,
  direction text,
  notes text,
  performed_by text,
  created_by varchar NOT NULL REFERENCES cfm_users(id),
  recorded_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS work_entries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ticket_id varchar NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  measurement_id varchar REFERENCES measurement_entries(id) ON DELETE CASCADE,
  items json NOT NULL,
  notes text,
  performed_by text NOT NULL,
  works_by text,
  contractor_id varchar REFERENCES contractors(id),
  created_by varchar NOT NULL REFERENCES cfm_users(id),
  recorded_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS used_task_entries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ticket_id varchar NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  measurement_id varchar REFERENCES measurement_entries(id) ON DELETE CASCADE,
  items json NOT NULL,
  notes text,
  performed_by text NOT NULL,
  created_by varchar NOT NULL REFERENCES cfm_users(id),
  recorded_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type text NOT NULL,
  task_type_id varchar NOT NULL REFERENCES task_types(id),
  quantity integer NOT NULL,
  date timestamp NOT NULL,
  ticket_id varchar REFERENCES tickets(id) ON DELETE SET NULL,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);

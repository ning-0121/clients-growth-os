-- ============================================================
-- Growth OS — Seasonal Buying Calendar Schema
-- Safe to re-run: uses IF NOT EXISTS
-- ============================================================

-- ── 1. customer_profiles ────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_profiles (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name       text NOT NULL UNIQUE,
  market              text NOT NULL CHECK (market IN ('us', 'eu', 'jp', 'other')),
  customer_type       text NOT NULL DEFAULT 'retailer'
                      CHECK (customer_type IN ('retailer', 'brand', 'distributor', 'other')),
  product_preferences text,
  notes               text,
  lead_id             uuid REFERENCES growth_leads(id),
  created_by          uuid REFERENCES profiles(user_id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_market ON customer_profiles(market);

ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cp_select_auth" ON customer_profiles;
CREATE POLICY "cp_select_auth" ON customer_profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "cp_insert_auth" ON customer_profiles;
CREATE POLICY "cp_insert_auth" ON customer_profiles
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "cp_update_auth" ON customer_profiles;
CREATE POLICY "cp_update_auth" ON customer_profiles
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── 2. customer_seasonal_configs ────────────────────────────
CREATE TABLE IF NOT EXISTS customer_seasonal_configs (
  id                     uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id            uuid NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  season                 text NOT NULL CHECK (season IN ('SS1', 'SS2', 'FW1', 'FW2')),
  is_active              boolean NOT NULL DEFAULT true,
  shelf_month_start      integer,
  shelf_month_end        integer,
  custom_prep_offset     integer,
  custom_meeting_offset  integer,
  custom_order_offset    integer,
  product_categories     text,
  typical_order_value    numeric(12,2),
  notes                  text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  UNIQUE(customer_id, season)
);

ALTER TABLE customer_seasonal_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "csc_select_auth" ON customer_seasonal_configs;
CREATE POLICY "csc_select_auth" ON customer_seasonal_configs
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "csc_insert_auth" ON customer_seasonal_configs;
CREATE POLICY "csc_insert_auth" ON customer_seasonal_configs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "csc_update_auth" ON customer_seasonal_configs;
CREATE POLICY "csc_update_auth" ON customer_seasonal_configs
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── 3. seasonal_tasks ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasonal_tasks (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id     uuid NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  deal_id         uuid REFERENCES growth_deals(id),
  season          text NOT NULL CHECK (season IN ('SS1', 'SS2', 'FW1', 'FW2')),
  target_year     integer NOT NULL,
  task_type       text NOT NULL CHECK (task_type IN (
    'product_prep', 'book_meeting', 'meeting', 'submit_order', 'production_start', 'ship'
  )),
  due_date        date NOT NULL,
  completed_at    timestamptz,
  assigned_to     uuid REFERENCES profiles(user_id),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(customer_id, season, target_year, task_type)
);

CREATE INDEX IF NOT EXISTS idx_seasonal_tasks_due ON seasonal_tasks(due_date)
  WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_seasonal_tasks_customer ON seasonal_tasks(customer_id, target_year, season);

ALTER TABLE seasonal_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "st_select_auth" ON seasonal_tasks;
CREATE POLICY "st_select_auth" ON seasonal_tasks
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "st_insert_auth" ON seasonal_tasks;
CREATE POLICY "st_insert_auth" ON seasonal_tasks
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "st_update_auth" ON seasonal_tasks;
CREATE POLICY "st_update_auth" ON seasonal_tasks
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================================
-- Done. Run after migration.sql and migration-ai.sql.
-- ============================================================

-- ============================================================
-- Growth OS — AI + Calendar 合并迁移脚本
-- 一次性运行即可。所有语句幂等，可重复执行。
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- PART 1: AI Intelligence Layer
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS growth_ai_usage (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  request_type  text NOT NULL,
  lead_id       uuid REFERENCES growth_leads(id),
  model         text NOT NULL,
  input_tokens  integer NOT NULL,
  output_tokens integer NOT NULL,
  cost_usd      numeric(8,6),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON growth_ai_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_type ON growth_ai_usage(request_type, created_at DESC);

ALTER TABLE growth_ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage_select_auth" ON growth_ai_usage;
CREATE POLICY "ai_usage_select_auth" ON growth_ai_usage
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "ai_usage_insert_auth" ON growth_ai_usage;
CREATE POLICY "ai_usage_insert_auth" ON growth_ai_usage
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Leads 新字段
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS ai_analysis jsonb;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'none';
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS verification_evidence jsonb DEFAULT '[]';
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS ai_composite_score integer;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS ai_recommendation text;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS ai_reasoning text;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS customs_summary jsonb;

CREATE INDEX IF NOT EXISTS idx_leads_verification ON growth_leads(verification_status)
  WHERE verification_status NOT IN ('none', 'completed');

-- 海关数据表
CREATE TABLE IF NOT EXISTS growth_customs_records (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  importer_name    text NOT NULL,
  exporter_name    text,
  hs_code          text,
  product_desc     text,
  quantity         numeric,
  weight_kg        numeric,
  value_usd        numeric,
  origin_country   text,
  dest_country     text,
  import_date      date,
  bill_of_lading   text,
  raw_data         jsonb DEFAULT '{}',
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customs_importer ON growth_customs_records(importer_name);
CREATE INDEX IF NOT EXISTS idx_customs_hs_code ON growth_customs_records(hs_code);
CREATE INDEX IF NOT EXISTS idx_customs_date ON growth_customs_records(import_date DESC);

ALTER TABLE growth_customs_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customs_select_auth" ON growth_customs_records;
CREATE POLICY "customs_select_auth" ON growth_customs_records
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "customs_insert_auth" ON growth_customs_records;
CREATE POLICY "customs_insert_auth" ON growth_customs_records
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 海关匹配关系表
CREATE TABLE IF NOT EXISTS growth_customs_matches (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           uuid NOT NULL REFERENCES growth_leads(id) ON DELETE CASCADE,
  customs_record_id uuid NOT NULL REFERENCES growth_customs_records(id) ON DELETE CASCADE,
  match_type        text NOT NULL CHECK (match_type IN ('domain','exact_name','fuzzy_name','ai_confirmed')),
  confidence        text NOT NULL CHECK (confidence IN ('exact','high','medium','low')),
  created_at        timestamptz DEFAULT now(),
  UNIQUE(lead_id, customs_record_id)
);

ALTER TABLE growth_customs_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customs_matches_select_auth" ON growth_customs_matches;
CREATE POLICY "customs_matches_select_auth" ON growth_customs_matches
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "customs_matches_insert_auth" ON growth_customs_matches;
CREATE POLICY "customs_matches_insert_auth" ON growth_customs_matches
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════
-- PART 2: Seasonal Buying Calendar
-- ═══════════════════════════════════════════════════════════

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
-- Done. 所有语句幂等，可安全重复运行。
-- ============================================================

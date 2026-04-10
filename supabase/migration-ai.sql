-- ============================================================
-- Growth OS — AI Intelligence Layer Schema
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ============================================================

-- ── AI Usage Tracking ───────────────────────────────────────
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

-- ── AI Analysis on Leads ────────────────────────────────────
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS ai_analysis jsonb;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'none';
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS verification_evidence jsonb DEFAULT '[]';
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS ai_composite_score integer;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS ai_recommendation text;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS ai_reasoning text;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS customs_summary jsonb;

CREATE INDEX IF NOT EXISTS idx_leads_verification ON growth_leads(verification_status)
  WHERE verification_status NOT IN ('none', 'completed');

-- ── Customs Trade Records ───────────────────────────────────
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

-- ── Customs ↔ Lead Matches ──────────────────────────────────
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

-- ============================================================
-- Done. Run after migration.sql. All statements are idempotent.
-- ============================================================

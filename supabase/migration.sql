-- ============================================================
-- Growth OS — Complete Database Schema (Idempotent)
-- Target: Supabase project zkcpywwiyxjhmcoexzmp
-- Safe to re-run: uses IF NOT EXISTS + DROP POLICY IF EXISTS
--
-- Run the ENTIRE file in one execution (Cmd/Ctrl+A → Run).
-- If you only run CREATE POLICY without the matching DROP POLICY IF EXISTS
-- above it, you get: policy "profiles_select_all" ... already exists
-- Quick fix:  DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
-- ============================================================

-- ── 1. profiles ─────────────────────────────────────────────
-- May already exist from Order OS — CREATE IF NOT EXISTS
CREATE TABLE IF NOT EXISTS profiles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  role       text NOT NULL DEFAULT '销售'
             CHECK (role IN ('销售','财务','采购','生产','质检','管理员')),
  sales_tier text CHECK (sales_tier IN ('top','mid') OR sales_tier IS NULL),
  created_at timestamptz DEFAULT now()
);

-- Add sales_tier column if profiles existed without it
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sales_tier text
  CHECK (sales_tier IN ('top','mid') OR sales_tier IS NULL);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
CREATE POLICY "profiles_select_all" ON profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- ── 2. growth_leads ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growth_leads (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name        text NOT NULL,
  contact_name        text,
  source              text CHECK (source IN ('ig','linkedin','website','customs','referral','test_batch') OR source IS NULL),
  website             text,
  product_match       text,
  contact_email       text,
  contact_linkedin    text,
  instagram_handle    text,
  quality_score       integer NOT NULL DEFAULT 0,
  opportunity_score   integer NOT NULL DEFAULT 0,
  reachability_score  integer NOT NULL DEFAULT 0,
  final_score         integer NOT NULL DEFAULT 0,
  grade               text CHECK (grade IN ('A','B+','B','C') OR grade IS NULL),
  status              text NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new','qualified','disqualified','converted')),
  assigned_to         uuid REFERENCES profiles(user_id),
  assigned_at         timestamptz,
  first_touch_at      timestamptz,
  last_action_at      timestamptz,
  next_action_due     timestamptz,
  action_count        integer NOT NULL DEFAULT 0,
  disqualified_reason text,
  created_by          uuid REFERENCES profiles(user_id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status_assigned ON growth_leads(status, assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON growth_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_next_action ON growth_leads(next_action_due) WHERE next_action_due IS NOT NULL;

ALTER TABLE growth_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select_auth" ON growth_leads;
CREATE POLICY "leads_select_auth" ON growth_leads
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "leads_insert_auth" ON growth_leads;
CREATE POLICY "leads_insert_auth" ON growth_leads
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "leads_update_auth" ON growth_leads;
CREATE POLICY "leads_update_auth" ON growth_leads
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── 3. growth_lead_actions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS growth_lead_actions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id       uuid NOT NULL REFERENCES growth_leads(id) ON DELETE CASCADE,
  action_type   text NOT NULL
                CHECK (action_type IN ('email','social_outreach','call','reject','return','reply','promote','deal_stage_advance','deal_lost','deal_won')),
  note          text,
  evidence_json jsonb NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES profiles(user_id),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_actions_lead_id ON growth_lead_actions(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_created_by ON growth_lead_actions(created_by, created_at DESC);

ALTER TABLE growth_lead_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "actions_select_auth" ON growth_lead_actions;
CREATE POLICY "actions_select_auth" ON growth_lead_actions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "actions_insert_auth" ON growth_lead_actions;
CREATE POLICY "actions_insert_auth" ON growth_lead_actions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 4. growth_deals ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growth_deals (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id               uuid REFERENCES growth_leads(id),
  customer_name         text NOT NULL,
  deal_stage            text NOT NULL DEFAULT '报价'
                        CHECK (deal_stage IN ('报价','样品','试单','大货')),
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','won','lost')),
  owner_id              uuid REFERENCES profiles(user_id),
  estimated_order_value numeric(12,2),
  product_category      text,
  style_no              text,
  notes                 text,
  won_at                timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_status ON growth_deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_lead_id ON growth_deals(lead_id);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON growth_deals(owner_id);

ALTER TABLE growth_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deals_select_auth" ON growth_deals;
CREATE POLICY "deals_select_auth" ON growth_deals
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "deals_insert_auth" ON growth_deals;
CREATE POLICY "deals_insert_auth" ON growth_deals
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "deals_update_auth" ON growth_deals;
CREATE POLICY "deals_update_auth" ON growth_deals
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── 5. growth_intake_runs ───────────────────────────────────
CREATE TABLE IF NOT EXISTS growth_intake_runs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  trigger_type  text NOT NULL
                CHECK (trigger_type IN ('auto_scrape','test_batch','api','manual','website_batch','csv_upload')),
  created_by    uuid REFERENCES profiles(user_id),
  total         integer NOT NULL DEFAULT 0,
  qualified     integer NOT NULL DEFAULT 0,
  disqualified  integer NOT NULL DEFAULT 0,
  duplicates    integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_runs_created ON growth_intake_runs(created_at DESC);

ALTER TABLE growth_intake_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intake_runs_select_auth" ON growth_intake_runs;
CREATE POLICY "intake_runs_select_auth" ON growth_intake_runs
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "intake_runs_insert_auth" ON growth_intake_runs;
CREATE POLICY "intake_runs_insert_auth" ON growth_intake_runs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 6. integration_events ───────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_events (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type      text NOT NULL,
  source_module   text NOT NULL,
  target_module   text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  idempotency_key text UNIQUE NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processed','failed','dead_letter')),
  created_at      timestamptz DEFAULT now(),
  processed_at    timestamptz,
  error_message   text
);

CREATE INDEX IF NOT EXISTS idx_events_pending ON integration_events(target_module, status)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_events_type ON integration_events(event_type, created_at DESC);

ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select_auth" ON integration_events;
CREATE POLICY "events_select_auth" ON integration_events
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "events_insert_auth" ON integration_events;
CREATE POLICY "events_insert_auth" ON integration_events
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "events_update_auth" ON integration_events;
CREATE POLICY "events_update_auth" ON integration_events
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── 7. order_drafts ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_drafts (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id            uuid REFERENCES integration_events(id),
  source_deal_id      uuid NOT NULL REFERENCES growth_deals(id),
  source_lead_id      uuid REFERENCES growth_leads(id),
  customer_name       text NOT NULL,
  owner_id            uuid REFERENCES profiles(user_id),
  estimated_order_value numeric(12,2),
  product_category    text,
  style_no            text,
  notes               text,
  snapshot_payload    jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','rejected')),
  confirmed_by        uuid REFERENCES profiles(user_id),
  confirmed_at        timestamptz,
  rejected_reason     text,
  created_order_id    uuid,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE order_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drafts_select_auth" ON order_drafts;
CREATE POLICY "drafts_select_auth" ON order_drafts
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "drafts_insert_auth" ON order_drafts;
CREATE POLICY "drafts_insert_auth" ON order_drafts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "drafts_update_auth" ON order_drafts;
CREATE POLICY "drafts_update_auth" ON order_drafts
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================================
-- Done. All statements are idempotent — safe to re-run.
-- ============================================================

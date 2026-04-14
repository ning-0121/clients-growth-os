-- ============================================================
-- Growth OS — Deal Probability Engine Schema
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ============================================================

-- ── growth_leads 新增概率字段 ──
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS deal_probability integer DEFAULT 0;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS probability_stage text DEFAULT 'cold';
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS last_engagement_at timestamptz;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS engagement_score integer DEFAULT 0;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS risk_score integer DEFAULT 0;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS next_recommended_action text;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS next_action_reason text;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS escalation_level integer DEFAULT 0;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS reactivation_needed boolean DEFAULT false;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS probability_updated_at timestamptz;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS probability_history jsonb DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_leads_probability ON growth_leads(deal_probability DESC)
  WHERE status IN ('new', 'qualified', 'converted');
CREATE INDEX IF NOT EXISTS idx_leads_escalation ON growth_leads(escalation_level)
  WHERE escalation_level > 0;
CREATE INDEX IF NOT EXISTS idx_leads_reactivation ON growth_leads(reactivation_needed)
  WHERE reactivation_needed = true;

-- ── deal_probability_events (概率变化事件流) ──
CREATE TABLE IF NOT EXISTS deal_probability_events (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id         uuid NOT NULL REFERENCES growth_leads(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  score_delta     integer NOT NULL,
  old_probability integer NOT NULL,
  new_probability integer NOT NULL,
  old_stage       text,
  new_stage       text,
  reason          text,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prob_events_lead ON deal_probability_events(lead_id, created_at DESC);

ALTER TABLE deal_probability_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pe_select_auth" ON deal_probability_events;
CREATE POLICY "pe_select_auth" ON deal_probability_events FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "pe_insert_any" ON deal_probability_events;
CREATE POLICY "pe_insert_any" ON deal_probability_events FOR INSERT WITH CHECK (true);

-- ── deal_outcomes (赢单/丢单学习数据) ──
CREATE TABLE IF NOT EXISTS deal_outcomes (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id               uuid NOT NULL REFERENCES growth_deals(id),
  lead_id               uuid REFERENCES growth_leads(id),
  outcome               text NOT NULL CHECK (outcome IN ('won', 'lost')),
  customer_country      text,
  customer_type         text,
  product_category      text,
  source_channel        text,
  first_touch_method    text,
  days_to_first_reply   integer,
  days_to_close         integer,
  days_quote_to_sample  integer,
  days_sample_to_trial  integer,
  final_order_value     numeric(12,2),
  owner_id              uuid REFERENCES profiles(user_id),
  win_reason            text,
  loss_reason           text,
  metadata              jsonb DEFAULT '{}',
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_outcomes_outcome ON deal_outcomes(outcome, created_at DESC);

ALTER TABLE deal_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "do_select_auth" ON deal_outcomes;
CREATE POLICY "do_select_auth" ON deal_outcomes FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "do_insert_auth" ON deal_outcomes;
CREATE POLICY "do_insert_auth" ON deal_outcomes FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- Done. Run in Supabase SQL Editor.
-- ============================================================

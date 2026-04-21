-- ============================================================
-- Growth OS — Schema drift fixes (2026-04-21)
-- ============================================================
-- Two issues being resolved:
--   1. growth_leads: contact_phone / contact_address / contact_people
--      are referenced by verification-pipeline.ts and re-enrich route
--      but were never added via migration. Production data may have
--      been set via Supabase UI but sync is not guaranteed.
--   2. outreach_campaigns was defined in both migration-agents.sql and
--      migration-outreach.sql with incompatible columns. The outreach
--      version (with sequence_id FK) is the one the code actually uses.
--      Ensuring the current table has all required columns via ALTER.
-- ============================================================

-- 1. Contact fields on growth_leads
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS contact_address text;
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS contact_people jsonb;

CREATE INDEX IF NOT EXISTS idx_leads_contact_phone
  ON growth_leads(contact_phone)
  WHERE contact_phone IS NOT NULL;

-- 2. outreach_campaigns reconciliation — ensure columns the code uses exist
--    (IF NOT EXISTS is idempotent regardless of which CREATE TABLE ran first)
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS sequence_id uuid;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS enrolled_at timestamptz DEFAULT now();
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS strategy jsonb DEFAULT '{}';

-- Widen status CHECK constraint to include all statuses the code writes
ALTER TABLE outreach_campaigns DROP CONSTRAINT IF EXISTS outreach_campaigns_status_check;
ALTER TABLE outreach_campaigns
  ADD CONSTRAINT outreach_campaigns_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed', 'cancelled'));

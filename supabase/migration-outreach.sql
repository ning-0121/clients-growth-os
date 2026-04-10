-- ============================================================
-- Growth OS — Outreach Engine Schema
-- Safe to re-run: uses IF NOT EXISTS
-- ============================================================

-- ── 1. outreach_sequences (邮件序列模板) ─────────────────────
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  steps       jsonb NOT NULL DEFAULT '[]',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seq_select_auth" ON outreach_sequences;
CREATE POLICY "seq_select_auth" ON outreach_sequences
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "seq_insert_auth" ON outreach_sequences;
CREATE POLICY "seq_insert_auth" ON outreach_sequences
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "seq_update_auth" ON outreach_sequences;
CREATE POLICY "seq_update_auth" ON outreach_sequences
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- 插入默认序列
INSERT INTO outreach_sequences (name, steps) VALUES
  ('activewear_cold_intro', '[
    {"step_number": 1, "delay_days": 0, "email_type": "intro"},
    {"step_number": 2, "delay_days": 3, "email_type": "follow_up"},
    {"step_number": 3, "delay_days": 7, "email_type": "value_add"},
    {"step_number": 4, "delay_days": 14, "email_type": "breakup"}
  ]')
ON CONFLICT DO NOTHING;

-- ── 2. outreach_campaigns (线索的序列实例) ───────────────────
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id       uuid NOT NULL REFERENCES growth_leads(id) ON DELETE CASCADE,
  sequence_id   uuid NOT NULL REFERENCES outreach_sequences(id),
  current_step  integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed')),
  enrolled_at   timestamptz DEFAULT now(),
  next_send_at  timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status_send ON outreach_campaigns(status, next_send_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_campaigns_lead ON outreach_campaigns(lead_id);

ALTER TABLE outreach_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "camp_select_auth" ON outreach_campaigns;
CREATE POLICY "camp_select_auth" ON outreach_campaigns
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "camp_insert_auth" ON outreach_campaigns;
CREATE POLICY "camp_insert_auth" ON outreach_campaigns
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "camp_update_auth" ON outreach_campaigns;
CREATE POLICY "camp_update_auth" ON outreach_campaigns
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── 3. outreach_emails (每封发出的邮件) ──────────────────────
CREATE TABLE IF NOT EXISTS outreach_emails (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id         uuid NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  lead_id             uuid NOT NULL REFERENCES growth_leads(id) ON DELETE CASCADE,
  step_number         integer NOT NULL,
  resend_message_id   text,
  subject             text NOT NULL,
  body_html           text NOT NULL,
  to_email            text NOT NULL,
  from_email          text NOT NULL DEFAULT 'sales@qimoclothing.com',
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained')),
  opened_at           timestamptz,
  replied_at          timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emails_campaign ON outreach_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_emails_resend_id ON outreach_emails(resend_message_id)
  WHERE resend_message_id IS NOT NULL;

ALTER TABLE outreach_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_select_auth" ON outreach_emails;
CREATE POLICY "email_select_auth" ON outreach_emails
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "email_insert_auth" ON outreach_emails;
CREATE POLICY "email_insert_auth" ON outreach_emails
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "email_update_auth" ON outreach_emails;
CREATE POLICY "email_update_auth" ON outreach_emails
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── 4. growth_leads 新增字段 ─────────────────────────────────
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS outreach_status text DEFAULT 'none';

-- ============================================================
-- Done. 所有语句幂等。
-- ============================================================

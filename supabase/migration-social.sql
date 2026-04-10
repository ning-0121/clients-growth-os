-- ============================================================
-- Growth OS — Social Engagement Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS social_engagements (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           uuid REFERENCES growth_leads(id),
  platform          text NOT NULL CHECK (platform IN ('instagram', 'linkedin')),
  engagement_type   text NOT NULL CHECK (engagement_type IN ('comment', 'like', 'connection_request', 'follow', 'dm')),
  target_url        text,
  content           text,
  status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'responded')),
  phantombuster_run_id text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_lead ON social_engagements(lead_id);
CREATE INDEX IF NOT EXISTS idx_social_status ON social_engagements(status, created_at DESC);

ALTER TABLE social_engagements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "se_select_auth" ON social_engagements;
CREATE POLICY "se_select_auth" ON social_engagements
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "se_insert_auth" ON social_engagements;
CREATE POLICY "se_insert_auth" ON social_engagements
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "se_update_auth" ON social_engagements;
CREATE POLICY "se_update_auth" ON social_engagements
  FOR UPDATE USING (true);

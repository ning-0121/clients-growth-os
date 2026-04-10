-- ============================================================
-- Growth OS — Automation Runs Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_runs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source          text NOT NULL CHECK (source IN ('phantombuster_ig', 'phantombuster_linkedin', 'customs_auto', 'website_scrape')),
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  leads_found     integer DEFAULT 0,
  leads_ingested  integer DEFAULT 0,
  error_message   text,
  metadata        jsonb DEFAULT '{}',
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_started ON automation_runs(started_at DESC);

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ar_select_auth" ON automation_runs;
CREATE POLICY "ar_select_auth" ON automation_runs
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "ar_insert_auth" ON automation_runs;
CREATE POLICY "ar_insert_auth" ON automation_runs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "ar_update_auth" ON automation_runs;
CREATE POLICY "ar_update_auth" ON automation_runs
  FOR UPDATE USING (auth.uid() IS NOT NULL);

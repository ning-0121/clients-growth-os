-- ============================================================
-- Growth OS — Lead Discovery & Queue Schema
-- Safe to re-run: uses IF NOT EXISTS
-- ============================================================

-- ── 1. lead_source_queue ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_source_queue (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source          text NOT NULL CHECK (source IN ('google', 'apollo', 'instagram', 'customs', 'manual', 'hunter', 'directory')),
  target_url      text,
  target_data     jsonb DEFAULT '{}',
  priority        integer DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  retry_count     integer DEFAULT 0,
  max_retries     integer DEFAULT 3,
  result          jsonb,
  error_message   text,
  created_at      timestamptz DEFAULT now(),
  processed_at    timestamptz,
  next_retry_at   timestamptz
);

-- Unique per source+url to prevent duplicate queue entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_queue_unique ON lead_source_queue(source, target_url)
  WHERE target_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_source_queue_status ON lead_source_queue(status, priority, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE lead_source_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sq_select_auth" ON lead_source_queue;
CREATE POLICY "sq_select_auth" ON lead_source_queue FOR SELECT USING (true);
DROP POLICY IF EXISTS "sq_insert_any" ON lead_source_queue;
CREATE POLICY "sq_insert_any" ON lead_source_queue FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "sq_update_any" ON lead_source_queue;
CREATE POLICY "sq_update_any" ON lead_source_queue FOR UPDATE USING (true);

-- ── 2. discovery_runs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS discovery_runs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source          text NOT NULL,
  query_used      text,
  urls_found      integer DEFAULT 0,
  urls_new        integer DEFAULT 0,
  urls_duplicate  integer DEFAULT 0,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_runs_created ON discovery_runs(created_at DESC);

ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dr_select_auth" ON discovery_runs;
CREATE POLICY "dr_select_auth" ON discovery_runs FOR SELECT USING (true);
DROP POLICY IF EXISTS "dr_insert_any" ON discovery_runs;
CREATE POLICY "dr_insert_any" ON discovery_runs FOR INSERT WITH CHECK (true);

-- ── 3. Update LeadSource check on growth_leads ──────────────
-- Add new source types (google, apollo, directory)
ALTER TABLE growth_leads DROP CONSTRAINT IF EXISTS growth_leads_source_check;
ALTER TABLE growth_leads ADD CONSTRAINT growth_leads_source_check
  CHECK (source IN ('ig','linkedin','website','customs','referral','test_batch','google','apollo','directory') OR source IS NULL);

-- ============================================================
-- Done. Run in Supabase SQL Editor.
-- ============================================================

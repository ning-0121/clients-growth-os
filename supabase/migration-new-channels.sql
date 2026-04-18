-- ─────────────────────────────────────────────────────────────────────────────
-- Expand source constraints to accept new channels:
--   faire, amazon, exhibitor, instagram_dork
-- ─────────────────────────────────────────────────────────────────────────────

-- Update lead_source_queue constraint
alter table lead_source_queue drop constraint if exists lead_source_queue_source_check;
alter table lead_source_queue add constraint lead_source_queue_source_check
  check (source in (
    'google', 'apollo', 'instagram', 'customs', 'manual', 'hunter', 'directory',
    'faire', 'amazon', 'exhibitor', 'instagram_dork'
  ));

-- Update growth_leads constraint to accept the same values
alter table growth_leads drop constraint if exists growth_leads_source_check;
alter table growth_leads add constraint growth_leads_source_check
  check (source in (
    'ig', 'linkedin', 'website', 'customs', 'referral', 'test_batch',
    'google', 'apollo', 'directory', 'manual',
    'faire', 'amazon', 'exhibitor', 'instagram_dork'
  ) or source is null);

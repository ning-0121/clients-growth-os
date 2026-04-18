-- ─────────────────────────────────────────────────────────────────────────────
-- Outreach V2 — Email visibility, quality gate, angle tracking
-- Run this in Supabase SQL editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add body_text to outreach_emails (so we can show email content in dashboard)
alter table outreach_emails
  add column if not exists body_text text,
  add column if not exists angle_used text;   -- tracks which personalization hook was used

-- 2. Add blocked_generic_email as valid outreach_status on growth_leads
-- (The column is text, so no enum change needed — just documenting the new value)
comment on column growth_leads.outreach_status is
  'Values: null | enrolled | sequence_active | replied | opted_out | blocked_generic_email';

-- 3. Add index for outreach dashboard queries
create index if not exists idx_outreach_campaigns_status_next
  on outreach_campaigns(status, next_send_at);

create index if not exists idx_outreach_emails_campaign_step
  on outreach_emails(campaign_id, step_number);

create index if not exists idx_growth_leads_outreach_status
  on growth_leads(outreach_status)
  where outreach_status is not null;

-- 4. View: leads blocked by generic email (for visibility)
create or replace view blocked_outreach_leads as
select
  id,
  company_name,
  contact_email,
  contact_name,
  grade,
  website,
  created_at
from growth_leads
where outreach_status = 'blocked_generic_email'
order by created_at desc;

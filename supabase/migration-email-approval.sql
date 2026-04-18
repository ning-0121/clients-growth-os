-- ─────────────────────────────────────────────────────────────────────────────
-- Email Approval Workflow — A/B grade leads require admin approval before send
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. New table: pending email approvals (queue)
create table if not exists pending_email_approvals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references growth_leads(id) on delete cascade,
  lead_category text,                        -- 'A' | 'B' | 'C' | 'D' — snapshot at submission
  to_email text not null,
  subject text not null,
  body_text text not null,
  body_html text,
  step_number int default 1,
  email_type text default 'intro',

  -- Submission metadata
  submitted_by uuid references auth.users(id),
  submitted_by_name text,
  submitted_at timestamptz default now(),

  -- Approval state: pending | approved | rejected | sent | failed
  status text default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,

  -- Send result
  sent_at timestamptz,
  resend_message_id text,
  send_error text,

  -- For joining
  campaign_id uuid references outreach_campaigns(id) on delete set null,

  constraint chk_approval_status check (status in ('pending', 'approved', 'rejected', 'sent', 'failed'))
);

-- 2. Indexes
create index if not exists idx_pending_approvals_status on pending_email_approvals(status);
create index if not exists idx_pending_approvals_lead on pending_email_approvals(lead_id);
create index if not exists idx_pending_approvals_submitted on pending_email_approvals(submitted_at desc);

-- 3. RLS: anyone authenticated can read their own + admins see all
alter table pending_email_approvals enable row level security;

drop policy if exists "Users see their submissions" on pending_email_approvals;
create policy "Users see their submissions" on pending_email_approvals
  for select using (
    submitted_by = auth.uid()
    or exists (select 1 from profiles where user_id = auth.uid() and role = '管理员')
  );

drop policy if exists "Users insert their submissions" on pending_email_approvals;
create policy "Users insert their submissions" on pending_email_approvals
  for insert with check (submitted_by = auth.uid());

drop policy if exists "Admins update approvals" on pending_email_approvals;
create policy "Admins update approvals" on pending_email_approvals
  for update using (
    exists (select 1 from profiles where user_id = auth.uid() and role = '管理员')
  );

-- 4. Add category snapshot column on growth_leads (for quick lookup)
alter table growth_leads
  add column if not exists category text;   -- A | B | C | D snapshot from last categorization

create index if not exists idx_growth_leads_category on growth_leads(category);

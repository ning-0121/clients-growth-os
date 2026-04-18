-- ─────────────────────────────────────────────────────────────────────────────
-- AI Supervisor — hourly health check, detect stalls, track KPIs
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. AI Job Logs — every significant AI task writes here
create table if not exists ai_job_logs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,          -- 'discover' | 'verify' | 'enrich' | 'analyze' | 'outreach' | 'strategy' | 'orchestrate'
  job_name text,                    -- specific run name (e.g., "google_discovery", "contact_hunter", "cold_email_gen")
  status text not null default 'running', -- 'running' | 'success' | 'error' | 'timeout' | 'partial'

  -- Inputs/outputs
  input_count int default 0,        -- e.g., leads processed
  output_count int default 0,       -- e.g., URLs found, emails sent, etc.
  success_count int default 0,
  error_count int default 0,

  -- Timing
  started_at timestamptz default now(),
  finished_at timestamptz,
  duration_ms int,

  -- Details
  metadata jsonb default '{}'::jsonb,  -- extra info (queries used, URLs found, error messages)
  error_message text,

  -- Cost tracking
  api_calls int default 0,
  tokens_used int default 0,
  cost_usd numeric(10,4) default 0,

  constraint chk_ai_job_status check (status in ('running', 'success', 'error', 'timeout', 'partial'))
);

create index if not exists idx_ai_job_logs_type_started on ai_job_logs(job_type, started_at desc);
create index if not exists idx_ai_job_logs_status on ai_job_logs(status) where status != 'success';
create index if not exists idx_ai_job_logs_started on ai_job_logs(started_at desc);

-- 2. Supervisor Alerts — issues detected by hourly supervisor
create table if not exists supervisor_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,        -- 'stalled_cron' | 'low_throughput' | 'high_error_rate' | 'api_quota_warning'
  severity text default 'warning', -- 'info' | 'warning' | 'critical'
  title text not null,
  description text,
  related_job text,                -- which job triggered
  metadata jsonb default '{}'::jsonb,
  detected_at timestamptz default now(),
  resolved_at timestamptz,
  auto_actions_taken text[],       -- e.g., ['restarted discover cron', 'cleared stuck queue']

  constraint chk_alert_severity check (severity in ('info', 'warning', 'critical'))
);

create index if not exists idx_supervisor_alerts_unresolved on supervisor_alerts(detected_at desc) where resolved_at is null;

-- 3. Hourly metrics snapshot (for dashboard charts)
create table if not exists supervisor_metrics (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz default now(),
  hour_bucket timestamptz not null,  -- rounded to the hour

  -- Discovery
  new_leads_count int default 0,
  new_urls_queued int default 0,
  domains_scanned int default 0,

  -- Verification
  verified_count int default 0,
  disqualified_count int default 0,

  -- Enrichment
  emails_found int default 0,
  phones_found int default 0,
  linkedin_found int default 0,

  -- Outreach
  emails_sent int default 0,
  emails_delivered int default 0,
  emails_opened int default 0,
  approvals_pending int default 0,

  -- AI jobs
  ai_jobs_total int default 0,
  ai_jobs_success int default 0,
  ai_jobs_error int default 0,
  avg_duration_ms int default 0,
  total_tokens_used int default 0,

  -- Errors
  stalled_jobs int default 0,

  metadata jsonb default '{}'::jsonb
);

create unique index if not exists idx_supervisor_metrics_hour on supervisor_metrics(hour_bucket);
create index if not exists idx_supervisor_metrics_snapshot on supervisor_metrics(snapshot_at desc);

-- 4. RLS: admins only
alter table ai_job_logs enable row level security;
alter table supervisor_alerts enable row level security;
alter table supervisor_metrics enable row level security;

drop policy if exists "Admins view job logs" on ai_job_logs;
create policy "Admins view job logs" on ai_job_logs
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and role = '管理员')
  );

drop policy if exists "Admins view alerts" on supervisor_alerts;
create policy "Admins view alerts" on supervisor_alerts
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role = '管理员')
  );

drop policy if exists "Admins view metrics" on supervisor_metrics;
create policy "Admins view metrics" on supervisor_metrics
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and role = '管理员')
  );

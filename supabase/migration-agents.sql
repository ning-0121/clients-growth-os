-- ══════════════════════════════════════
-- AI Agent System — Database Migration
-- Supports both outbound (主动搜索) and inbound (宣传引流) pipelines
-- ══════════════════════════════════════

-- ── Agent Tasks (任务日志) ──
CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('outbound', 'inbound')),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'waiting', 'completed', 'failed')),
  input JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  error TEXT,
  lead_id UUID REFERENCES growth_leads(id) ON DELETE SET NULL,
  parent_task_id UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_role ON agent_tasks(agent_role);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_pipeline ON agent_tasks(pipeline);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_lead ON agent_tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON agent_tasks(created_at DESC);

-- ── Outreach Campaigns (开发活动) ──
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES growth_leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  current_step INT DEFAULT 0,
  total_steps INT DEFAULT 4,
  strategy JSONB DEFAULT '{}',
  last_sent_at TIMESTAMPTZ,
  next_send_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_lead ON outreach_campaigns(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON outreach_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_next_send ON outreach_campaigns(next_send_at);

-- ── Outreach Emails (开发邮件) ──
CREATE TABLE IF NOT EXISTS outreach_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES growth_leads(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  email_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  to_email TEXT NOT NULL,
  resend_id TEXT,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed')),
  sent_at TIMESTAMPTZ DEFAULT now(),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_emails_campaign ON outreach_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_emails_lead ON outreach_emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON outreach_emails(status);

-- ── Social Content (社媒内容) ──
CREATE TABLE IF NOT EXISTS social_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'linkedin', 'facebook', 'tiktok')),
  content_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  caption TEXT NOT NULL,
  hashtags TEXT[] DEFAULT '{}',
  image_prompt TEXT,
  image_url TEXT,
  call_to_action TEXT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  engagement_count INT DEFAULT 0,
  leads_generated INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_platform ON social_content(platform);
CREATE INDEX IF NOT EXISTS idx_social_status ON social_content(status);
CREATE INDEX IF NOT EXISTS idx_social_scheduled ON social_content(scheduled_at);

-- ── RLS Policies ──
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_content ENABLE ROW LEVEL SECURITY;

-- Service role can access everything (for cron/automation)
CREATE POLICY "Service role full access on agent_tasks"
  ON agent_tasks FOR ALL USING (true);

CREATE POLICY "Service role full access on outreach_campaigns"
  ON outreach_campaigns FOR ALL USING (true);

CREATE POLICY "Service role full access on outreach_emails"
  ON outreach_emails FOR ALL USING (true);

CREATE POLICY "Service role full access on social_content"
  ON social_content FOR ALL USING (true);

-- Authenticated users can read
CREATE POLICY "Authenticated users can read agent_tasks"
  ON agent_tasks FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read outreach_campaigns"
  ON outreach_campaigns FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read outreach_emails"
  ON outreach_emails FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read social_content"
  ON social_content FOR SELECT
  USING (auth.role() = 'authenticated');

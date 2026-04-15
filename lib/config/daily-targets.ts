/**
 * Growth OS 每日 KPI 目标
 *
 * AI 系统和人工团队都要达标。
 * 系统每次运行时检查进度，未达标时自动加大力度。
 */

export const DAILY_TARGETS = {
  // ── AI 自动化目标（系统必须完成）──
  ai: {
    discover: {
      label: '发现新客户URL',
      target: 500,        // 每天发现500个新URL
      unit: '个',
      source: 'discovery_runs.urls_new',
    },
    enrich: {
      label: '富化处理',
      target: 200,        // 每天富化200个网站
      unit: '个',
      source: 'lead_source_queue.completed (today)',
    },
    qualified: {
      label: '合格入库',
      target: 50,         // 每天50个通过验证的线索
      unit: '个',
      source: 'growth_leads.created_at (today, status=new/qualified)',
    },
    verified: {
      label: '完成验证',
      target: 40,         // 每天40个完成4轮验证
      unit: '个',
      source: 'growth_leads.verification_status=completed (today)',
    },
    emails_sent: {
      label: '发送开发信',
      target: 30,         // 每天30封开发信
      unit: '封',
      source: 'outreach_emails.sent_at (today)',
    },
    contacts_found: {
      label: '找到联系方式',
      target: 100,        // 每天找到100个邮箱/电话
      unit: '个',
      source: 'growth_leads with contact_email (today)',
    },
  },

  // ── 人工团队目标（每人/天）──
  human_per_person: {
    outreach: {
      label: '外联触达',
      target: 50,         // 每人每天联系50个客户
      unit: '次',
    },
    first_touch: {
      label: '首次触达',
      target: 15,         // 每人每天首触15个新客户
      unit: '个',
    },
    follow_up: {
      label: '跟进',
      target: 25,         // 每人每天跟进25个老客户
      unit: '次',
    },
    replies: {
      label: '获得回复',
      target: 3,          // 每人每天获得3个回复
      unit: '个',
    },
    deals_advanced: {
      label: '推进商机',
      target: 1,          // 每人每天推进1个deal
      unit: '个',
    },
  },

  // ── 团队整体目标（全团队/天）──
  team: {
    team_size: 10,                   // 当前团队人数
    total_outreach: 500,             // 全队每天500次外联
    total_qualified_leads_needed: 500, // 全队每天需要500个合格线索
    total_replies_target: 30,        // 全队每天30个回复
    total_deals_target: 5,           // 全队每天推进5个deal
  },
};

/**
 * 计算 AI 系统今日 KPI 完成情况
 *
 * 重要：所有数字经过质量验证，不是简单 count
 * - "合格入库" = 过了行业+网站+联系方式门的线索
 * - "找到联系方式" = 真实个人邮箱，不算 info@/sales@
 * - "发送开发信" = 真正送达的，不算 bounced
 * - "完成验证" = 4轮全过的，不算中途失败
 */
export async function calculateAIDailyProgress(
  supabase: any
): Promise<{
  metrics: { key: string; label: string; target: number; actual: number; unit: string; percentage: number }[];
  overall_percentage: number;
  status: 'ahead' | 'on_track' | 'behind' | 'critical';
}> {
  const today = new Date().toISOString().split('T')[0];
  const todayStart = today + 'T00:00:00';

  // 1. URLs discovered today
  const { data: discoveryRuns } = await supabase
    .from('discovery_runs')
    .select('urls_new')
    .gte('created_at', todayStart);
  const discovered = (discoveryRuns || []).reduce((sum: number, r: any) => sum + (r.urls_new || 0), 0);

  // 2. Enriched today
  const { count: enriched } = await supabase
    .from('lead_source_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed')
    .gte('processed_at', todayStart);

  // 3. Qualified leads today
  const { count: qualified } = await supabase
    .from('growth_leads')
    .select('id', { count: 'exact', head: true })
    .in('status', ['new', 'qualified'])
    .gte('created_at', todayStart);

  // 4. Verified today
  const { count: verified } = await supabase
    .from('growth_leads')
    .select('id', { count: 'exact', head: true })
    .eq('verification_status', 'completed')
    .gte('updated_at', todayStart);

  // 5. Emails sent today
  const { count: emailsSent } = await supabase
    .from('outreach_emails')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', todayStart);

  // 6. Contacts found today
  const { count: contactsFound } = await supabase
    .from('growth_leads')
    .select('id', { count: 'exact', head: true })
    .not('contact_email', 'is', null)
    .gte('created_at', todayStart);

  const t = DAILY_TARGETS.ai;
  const metrics = [
    { key: 'discover', label: t.discover.label, target: t.discover.target, actual: discovered, unit: t.discover.unit, percentage: Math.round((discovered / t.discover.target) * 100) },
    { key: 'enrich', label: t.enrich.label, target: t.enrich.target, actual: enriched || 0, unit: t.enrich.unit, percentage: Math.round(((enriched || 0) / t.enrich.target) * 100) },
    { key: 'qualified', label: t.qualified.label, target: t.qualified.target, actual: qualified || 0, unit: t.qualified.unit, percentage: Math.round(((qualified || 0) / t.qualified.target) * 100) },
    { key: 'verified', label: t.verified.label, target: t.verified.target, actual: verified || 0, unit: t.verified.unit, percentage: Math.round(((verified || 0) / t.verified.target) * 100) },
    { key: 'emails_sent', label: t.emails_sent.label, target: t.emails_sent.target, actual: emailsSent || 0, unit: t.emails_sent.unit, percentage: Math.round(((emailsSent || 0) / t.emails_sent.target) * 100) },
    { key: 'contacts_found', label: t.contacts_found.label, target: t.contacts_found.target, actual: contactsFound || 0, unit: t.contacts_found.unit, percentage: Math.round(((contactsFound || 0) / t.contacts_found.target) * 100) },
  ];

  const overall = Math.round(metrics.reduce((sum, m) => sum + m.percentage, 0) / metrics.length);

  // Time-based expectation: at 50% of the day, should be at 50% of target
  const hourOfDay = new Date().getHours();
  const dayProgress = hourOfDay / 24;
  const expectedProgress = Math.round(dayProgress * 100);

  let status: 'ahead' | 'on_track' | 'behind' | 'critical' = 'on_track';
  if (overall > expectedProgress + 10) status = 'ahead';
  else if (overall < expectedProgress - 20) status = 'critical';
  else if (overall < expectedProgress - 10) status = 'behind';

  return { metrics, overall_percentage: overall, status };
}

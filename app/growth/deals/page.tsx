import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';
import DealsCategoryAndList from './DealsCategoryAndList';

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const user = await requireAuth();
  const profile = await getCurrentProfile();
  const role = profile?.role || '';

  if (role !== '销售' && role !== '管理员') {
    redirect('/login');
  }

  const supabase = await createClient();
  const isAdmin = role === '管理员';
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

  // All active leads (not just deals — this is the "成交中心")
  const query = supabase
    .from('growth_leads')
    .select('id, company_name, contact_name, contact_email, contact_linkedin, instagram_handle, website, source, grade, final_score, status, deal_probability, probability_stage, engagement_score, next_recommended_action, next_action_reason, escalation_level, reactivation_needed, assigned_to, outreach_status, ai_analysis, customs_summary, product_match, first_touch_at, last_action_at, next_action_due, action_count, created_at')
    .in('status', ['new', 'qualified', 'converted'])
    .order('deal_probability', { ascending: false });

  if (!isAdmin) {
    query.eq('assigned_to', user.id);
  }

  const { data: leads } = await query.limit(300);

  // Outreach campaign status
  const { data: campaigns } = await supabase
    .from('outreach_campaigns')
    .select('lead_id, status, current_step, next_send_at')
    .in('status', ['active', 'completed', 'replied', 'paused']);

  // Outreach emails for open tracking
  const { data: emails } = await supabase
    .from('outreach_emails')
    .select('lead_id, status, opened_at, sent_at')
    .not('sent_at', 'is', null);

  // Staff names
  const { data: profiles } = await supabase.from('profiles').select('user_id, name, sales_tier');
  const staffMap: Record<string, string> = {};
  const salesStaff: any[] = [];
  (profiles || []).forEach((p: any) => {
    staffMap[p.user_id] = p.name;
    if (p.sales_tier) salesStaff.push(p);
  });

  // Build campaign map
  const campaignMap: Record<string, any> = {};
  (campaigns || []).forEach((c: any) => { campaignMap[c.lead_id] = c; });

  // Build email stats map
  const emailStatsMap: Record<string, { sent: number; opened: number; lastSent: string | null }> = {};
  (emails || []).forEach((e: any) => {
    if (!emailStatsMap[e.lead_id]) {
      emailStatsMap[e.lead_id] = { sent: 0, opened: 0, lastSent: null };
    }
    emailStatsMap[e.lead_id].sent++;
    if (e.opened_at) emailStatsMap[e.lead_id].opened++;
    if (!emailStatsMap[e.lead_id].lastSent || (e.sent_at && e.sent_at > (emailStatsMap[e.lead_id].lastSent || ''))) {
      emailStatsMap[e.lead_id].lastSent = e.sent_at;
    }
  });

  const allLeads = (leads || []).map((l: any) => ({
    ...l,
    assigned_name: l.assigned_to ? staffMap[l.assigned_to] : null,
    campaign: campaignMap[l.id] || null,
    email_stats: emailStatsMap[l.id] || null,
  }));

  // Categorize
  // 分级标准: 能联系上决策人的才是好线索
  const categorize = (l: any): 'A' | 'B' | 'C' | 'D' => {
    const ai = l.ai_analysis || {};
    const email = l.contact_email || '';
    const emailLocal = email.split('@')[0]?.toLowerCase() || '';
    const isPersonalEmail = email && !['info', 'sales', 'hello', 'contact', 'support', 'help', 'customerservice', 'noreply', 'admin'].includes(emailLocal);
    const isGenericEmail = email && !isPersonalEmail;
    const hasLinkedInPerson = l.contact_linkedin && l.contact_linkedin.includes('/in/');
    const isApparel = ai.is_apparel_company !== false;
    const hasProduct = !!l.product_match || (ai.product_categories && ai.product_categories.length > 0);

    if (l.deal_probability >= 61 || l.action_count > 2) return 'A';
    if ((isPersonalEmail || hasLinkedInPerson || l.contact_phone) && isApparel && hasProduct) return 'A';
    if (isGenericEmail && isApparel && hasProduct) return 'B';
    if (l.instagram_handle && l.website && hasProduct && (email || l.contact_linkedin)) return 'B';
    if (l.website && isApparel) return 'C';
    if (l.instagram_handle && isApparel) return 'C';
    return 'D';
  };

  const categorizedLeads = allLeads.map((l: any) => ({
    ...l,
    category: categorize(l),
  }));

  // Split by tab
  const todayLeads = categorizedLeads.filter((l: any) => l.status !== 'disqualified');
  const awaitingReply = categorizedLeads.filter((l: any) =>
    l.outreach_status === 'sequence_active' || l.outreach_status === 'enrolled' ||
    (l.campaign && l.campaign.status === 'active')
  );
  const repliedLeads = categorizedLeads.filter((l: any) =>
    l.outreach_status === 'replied' || l.status === 'qualified'
  );
  const silentLeads = categorizedLeads.filter((l: any) => {
    if (!l.last_action_at) return false;
    return new Date(l.last_action_at) < new Date(thirtyDaysAgo);
  });

  // Counts per category
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  todayLeads.forEach((l: any) => { counts[l.category as keyof typeof counts]++; });

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">成交中心</h1>
          <p className="text-sm text-gray-500 mt-1">客户开发与成交跟进 — 每个客户都有 AI 分析和开发策略</p>
        </div>

        <DealsCategoryAndList
          counts={counts}
          todayLeads={todayLeads}
          awaitingReply={awaitingReply}
          repliedLeads={repliedLeads}
          silentLeads={silentLeads}
          isAdmin={isAdmin}
          salesStaff={salesStaff}
        />
      </main>
    </div>
  );
}

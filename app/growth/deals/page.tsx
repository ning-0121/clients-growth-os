import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';
import DealsTabs from './DealsTabs';

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
  // A级: 概率>60% 或 grade A 且有互动
  // B级: 概率40-60% 或 grade B+ 且有互动
  // C级: 概率20-40% 或 有首触
  // D级: 概率<20% 或 无互动
  const categorize = (l: any): 'A' | 'B' | 'C' | 'D' => {
    const prob = l.deal_probability || 0;
    if (prob >= 61 || (l.grade === 'A' && l.action_count > 0)) return 'A';
    if (prob >= 41 || (l.grade === 'B+' && l.action_count > 0)) return 'B';
    if (prob >= 21 || l.first_touch_at) return 'C';
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

        {/* Category summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-lg p-3 border border-green-200 text-center">
            <div className="text-xl font-bold text-green-600">{counts.A}</div>
            <div className="text-xs text-gray-500">A级 · 高价值</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-blue-200 text-center">
            <div className="text-xl font-bold text-blue-600">{counts.B}</div>
            <div className="text-xs text-gray-500">B级 · 有潜力</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-amber-200 text-center">
            <div className="text-xl font-bold text-amber-600">{counts.C}</div>
            <div className="text-xs text-gray-500">C级 · 待开发</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
            <div className="text-xl font-bold text-gray-500">{counts.D}</div>
            <div className="text-xs text-gray-500">D级 · 待培育</div>
          </div>
        </div>

        <DealsTabs
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

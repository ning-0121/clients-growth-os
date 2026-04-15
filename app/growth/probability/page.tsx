import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import GrowthNavbar from '@/components/GrowthNavbar';
import ProbabilityDashboard from './ProbabilityDashboard';

export const dynamic = 'force-dynamic';

export default async function ProbabilityPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  // Fetch all active leads with probability data
  const { data: leads } = await supabase
    .from('growth_leads')
    .select('id, company_name, contact_name, contact_email, website, source, grade, final_score, deal_probability, probability_stage, last_engagement_at, engagement_score, risk_score, next_recommended_action, next_action_reason, escalation_level, reactivation_needed, probability_updated_at, assigned_to, status, outreach_status, ai_analysis')
    .in('status', ['new', 'qualified', 'converted'])
    .order('deal_probability', { ascending: false });

  // Fetch deals for linked info
  const { data: deals } = await supabase
    .from('growth_deals')
    .select('id, lead_id, deal_stage, status, estimated_order_value, customer_name')
    .eq('status', 'active');

  // Staff names
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, name');

  const staffMap: Record<string, string> = {};
  (profiles || []).forEach((p: any) => { staffMap[p.user_id] = p.name; });

  // Build deal map by lead_id
  const dealMap: Record<string, any> = {};
  (deals || []).forEach((d: any) => { if (d.lead_id) dealMap[d.lead_id] = d; });

  const allLeads = (leads || []).map((l: any) => ({
    ...l,
    deal: dealMap[l.id] || null,
    assigned_name: l.assigned_to ? staffMap[l.assigned_to] : null,
  }));

  // Metrics
  const hotLeads = allLeads.filter((l: any) => l.deal_probability >= 61);
  const riskLeads = allLeads.filter((l: any) => l.reactivation_needed);
  const escalationLeads = allLeads.filter((l: any) => l.escalation_level >= 1);
  const coldLeads = allLeads.filter((l: any) => l.deal_probability <= 20 && l.deal_probability > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">成交概率</h1>
          <p className="text-sm text-gray-500 mt-1">成交概率引擎 — AI 自动判断客户成交概率，推荐下一步动作</p>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MetricCard label="高潜客户" sublabel="概率 > 60" value={hotLeads.length} color="text-green-600" border="border-green-200" />
          <MetricCard label="风险客户" sublabel="需要激活" value={riskLeads.length} color="text-red-600" border="border-red-200" />
          <MetricCard label="需要升级" sublabel="需高层介入" value={escalationLeads.length} color="text-purple-600" border="border-purple-200" />
          <MetricCard label="冷客户池" sublabel="概率 < 20" value={coldLeads.length} color="text-gray-500" border="border-gray-200" />
        </div>

        <ProbabilityDashboard leads={allLeads} />
      </main>
    </div>
  );
}

function MetricCard({ label, sublabel, value, color, border }: {
  label: string; sublabel: string; value: number; color: string; border: string;
}) {
  return (
    <div className={`bg-white rounded-lg p-4 border ${border}`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-700 mt-1 font-medium">{label}</div>
      <div className="text-xs text-gray-400">{sublabel}</div>
    </div>
  );
}

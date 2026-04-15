import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';
import LeadsTabSwitcher from './LeadsTabSwitcher';

export const dynamic = 'force-dynamic';

export default async function LeadsPoolPage() {
  const user = await requireAuth();
  const profile = await getCurrentProfile();
  const role = profile?.role || '';

  if (role !== '销售' && role !== '管理员') {
    redirect('/login');
  }

  const supabase = await createClient();
  const isAdmin = role === '管理员';

  // All leads (for admin: all, for sales: only assigned)
  const query = supabase
    .from('growth_leads')
    .select('id, company_name, contact_name, contact_email, website, source, grade, final_score, status, deal_probability, probability_stage, next_recommended_action, next_action_reason, escalation_level, reactivation_needed, assigned_to, outreach_status, ai_analysis, created_at, last_action_at')
    .in('status', ['new', 'qualified', 'converted', 'disqualified'])
    .order('deal_probability', { ascending: false });

  if (!isAdmin) {
    query.eq('assigned_to', user.id);
  }

  const { data: leads } = await query.limit(200);

  // Staff names
  const { data: profiles } = await supabase.from('profiles').select('user_id, name');
  const staffMap: Record<string, string> = {};
  (profiles || []).forEach((p: any) => { staffMap[p.user_id] = p.name; });

  // Customer profiles for calendar
  const { data: customers } = await supabase.from('customer_profiles').select('*');
  const { data: seasonalConfigs } = await supabase.from('customer_seasonal_configs').select('*').eq('is_active', true);
  const { data: seasonalTasks } = await supabase.from('seasonal_tasks').select('*').is('completed_at', null).order('due_date');

  // Customs stats
  const { count: customsCount } = await supabase.from('growth_customs_records').select('id', { count: 'exact', head: true });
  const { count: matchedCount } = await supabase.from('growth_customs_matches').select('id', { count: 'exact', head: true });

  const allLeads = (leads || []).map((l: any) => ({
    ...l,
    assigned_name: l.assigned_to ? staffMap[l.assigned_to] : null,
  }));

  // Counts for tabs
  const activeLeads = allLeads.filter((l: any) => l.status !== 'disqualified');
  const hotLeads = activeLeads.filter((l: any) => (l.deal_probability || 0) >= 61);
  const riskLeads = activeLeads.filter((l: any) => l.reactivation_needed);
  const coldLeads = activeLeads.filter((l: any) => (l.deal_probability || 0) > 0 && (l.deal_probability || 0) <= 20);
  const escalationLeads = activeLeads.filter((l: any) => l.escalation_level >= 1);

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">客户池</h1>
          <p className="text-sm text-gray-500 mt-1">
            所有客户的全景视图 — 共 {activeLeads.length} 个活跃客户
          </p>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
            <div className="text-xl font-bold text-gray-900">{activeLeads.length}</div>
            <div className="text-xs text-gray-500">全部客户</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-green-200 text-center">
            <div className="text-xl font-bold text-green-600">{hotLeads.length}</div>
            <div className="text-xs text-gray-500">高潜客户</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-red-200 text-center">
            <div className="text-xl font-bold text-red-600">{riskLeads.length}</div>
            <div className="text-xs text-gray-500">风险客户</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
            <div className="text-xl font-bold text-gray-500">{coldLeads.length}</div>
            <div className="text-xs text-gray-500">冷客户池</div>
          </div>
          {isAdmin && (
            <div className="bg-white rounded-lg p-3 border border-purple-200 text-center">
              <div className="text-xl font-bold text-purple-600">{escalationLeads.length}</div>
              <div className="text-xs text-gray-500">需升级</div>
            </div>
          )}
        </div>

        <LeadsTabSwitcher
          leads={allLeads}
          isAdmin={isAdmin}
          customers={customers || []}
          configs={seasonalConfigs || []}
          tasks={seasonalTasks || []}
          customsCount={customsCount || 0}
          matchedCount={matchedCount || 0}
        />
      </main>
    </div>
  );
}

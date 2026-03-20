import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';
import { GrowthLead, GrowthLeadAction } from '@/lib/types';

// Outreach action types (for follow-up counting)
const OUTREACH_TYPES = ['email', 'social_outreach', 'call'];

export default async function StatsPage() {
  await requireAuth();
  const profile = await getCurrentProfile();

  if (profile?.role !== '管理员') {
    redirect('/growth/my-today');
  }

  const supabase = await createClient();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const nowIso = now.toISOString();

  // All active leads
  const { data: allLeads } = await supabase
    .from('growth_leads')
    .select('id, assigned_to, status, first_touch_at, next_action_due, action_count, assigned_at, grade');

  const leads = (allLeads || []) as GrowthLead[];

  // All actions today
  const { data: todayActionsData } = await supabase
    .from('growth_lead_actions')
    .select('id, lead_id, action_type, created_by, created_at')
    .gte('created_at', todayStart);

  const todayActions = (todayActionsData || []) as GrowthLeadAction[];

  // All sales staff
  const { data: staffData } = await supabase
    .from('profiles')
    .select('user_id, name, sales_tier')
    .eq('role', '销售');

  const staff = (staffData || []) as { user_id: string; name: string; sales_tier: string | null }[];

  // ── Global stats ──

  const assignedToday = leads.filter(
    (l) => l.assigned_at && l.assigned_at >= todayStart
  ).length;

  const firstTouchesToday = leads.filter(
    (l) => l.first_touch_at && l.first_touch_at >= todayStart
  ).length;

  // Follow-ups today: outreach actions (email/social/call) on leads that already had first_touch
  // We need to check if the lead had first_touch BEFORE the action
  const leadsWithFirstTouch = new Set(
    leads.filter((l) => l.first_touch_at).map((l) => l.id)
  );
  const followUpsToday = todayActions.filter(
    (a) => OUTREACH_TYPES.includes(a.action_type) && leadsWithFirstTouch.has(a.lead_id)
  ).length;

  const overdueNow = leads.filter(
    (l) =>
      (l.status === 'new' || l.status === 'qualified') &&
      l.next_action_due &&
      l.next_action_due <= nowIso
  ).length;

  const rejectedToday = todayActions.filter((a) => a.action_type === 'reject').length;
  const returnedToday = todayActions.filter((a) => a.action_type === 'return').length;

  // ── Per-staff breakdown ──

  const staffStats = staff.map((s) => {
    const myLeads = leads.filter((l) => l.assigned_to === s.user_id);
    const activeLeads = myLeads.filter((l) => l.status === 'new' || l.status === 'qualified');
    const myActionsToday = todayActions.filter((a) => a.created_by === s.user_id);
    const myOutreachToday = myActionsToday.filter((a) => OUTREACH_TYPES.includes(a.action_type));
    const myOverdue = activeLeads.filter(
      (l) => l.next_action_due && l.next_action_due <= nowIso
    );
    const totalActions = activeLeads.reduce((sum, l) => sum + (l.action_count || 0), 0);
    const avgActions = activeLeads.length > 0 ? (totalActions / activeLeads.length).toFixed(1) : '0';

    return {
      user_id: s.user_id,
      name: s.name,
      tier: s.sales_tier,
      activeCount: activeLeads.length,
      actionsToday: myOutreachToday.length,
      overdueCount: myOverdue.length,
      avgActions,
    };
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Growth 执行统计</h1>
          <p className="text-sm text-gray-500 mt-1">今日概览</p>
        </div>

        {/* Global stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 sm:gap-4 mb-8">
          <StatCard label="今日分配" value={assignedToday} color="blue" />
          <StatCard label="首触完成" value={firstTouchesToday} color="green" />
          <StatCard label="跟进完成" value={followUpsToday} color="teal" />
          <StatCard label="逾期线索" value={overdueNow} color="red" />
          <StatCard label="今日拒绝" value={rejectedToday} color="gray" />
          <StatCard label="今日退回" value={returnedToday} color="amber" />
        </div>

        {/* Per-staff table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">员工</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">层级</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">活跃线索</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">今日触达</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">逾期</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">平均操作数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {staffStats.map((s) => (
                <tr key={s.user_id}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-center">
                    {s.tier && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.tier === 'top' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {s.tier}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-700">{s.activeCount}</td>
                  <td className="px-4 py-3 text-center text-sm text-gray-700">{s.actionsToday}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm ${s.overdueCount > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                      {s.overdueCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-700">{s.avgActions}</td>
                </tr>
              ))}
              {staffStats.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                    无销售员工数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'border-blue-200 text-blue-700',
    green: 'border-green-200 text-green-700',
    teal: 'border-teal-200 text-teal-700',
    red: 'border-red-200 text-red-600',
    gray: 'border-gray-200 text-gray-500',
    amber: 'border-amber-200 text-amber-700',
  };
  const c = colorMap[color] || colorMap.gray;
  return (
    <div className={`bg-white rounded-lg border p-4 text-center ${c}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

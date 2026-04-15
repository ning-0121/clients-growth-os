import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const user = await requireAuth();
  const profile = await getCurrentProfile();

  if (profile?.role !== '管理员') {
    redirect('/growth/workspace');
  }

  const supabase = await createClient();
  const today = new Date().toISOString().split('T')[0];

  // Global stats
  const { data: allLeads } = await supabase
    .from('growth_leads')
    .select('status, assigned_to, deal_probability, probability_stage, outreach_status, created_at')
    .in('status', ['new', 'qualified', 'converted']);

  const leads = allLeads || [];
  const totalActive = leads.length;
  const hotCount = leads.filter((l: any) => (l.deal_probability || 0) >= 61).length;
  const enrolledOutreach = leads.filter((l: any) => l.outreach_status === 'sequence_active' || l.outreach_status === 'enrolled').length;
  const todayCreated = leads.filter((l: any) => l.created_at?.startsWith(today)).length;

  // Queue stats
  const { count: queuePending } = await supabase.from('lead_source_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  const { count: queueCompleted } = await supabase.from('lead_source_queue').select('id', { count: 'exact', head: true }).eq('status', 'completed');

  // Discovery stats
  const { data: recentRuns } = await supabase.from('discovery_runs').select('source, urls_found, urls_new, created_at').order('created_at', { ascending: false }).limit(5);

  // Outreach stats
  const { count: emailsSent } = await supabase.from('outreach_emails').select('id', { count: 'exact', head: true }).eq('status', 'sent');
  const { count: emailsOpened } = await supabase.from('outreach_emails').select('id', { count: 'exact', head: true }).eq('status', 'opened');

  // Staff overview
  const { data: staffProfiles } = await supabase.from('profiles').select('user_id, name, role, sales_tier').eq('role', '销售');

  const staffStats = await Promise.all(
    (staffProfiles || []).map(async (staff: any) => {
      const { count: activeLeads } = await supabase.from('growth_leads').select('id', { count: 'exact', head: true }).eq('assigned_to', staff.user_id).in('status', ['new', 'qualified']);
      const { count: overdueLeads } = await supabase.from('growth_leads').select('id', { count: 'exact', head: true }).eq('assigned_to', staff.user_id).in('status', ['new', 'qualified']).lt('next_action_due', new Date().toISOString());
      return { ...staff, activeLeads: activeLeads || 0, overdueLeads: overdueLeads || 0 };
    })
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">数据中心</h1>
          <p className="text-sm text-gray-500 mt-1">全局运营数据 + 团队绩效 + 自动化监控</p>
        </div>

        {/* Global overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
          <Card label="活跃客户" value={totalActive} color="text-gray-900" />
          <Card label="高潜客户" value={hotCount} color="text-green-600" />
          <Card label="开发信进行中" value={enrolledOutreach} color="text-blue-600" />
          <Card label="今日新增" value={todayCreated} color="text-indigo-600" />
          <Card label="邮件已发" value={emailsSent || 0} color="text-gray-600" />
          <Card label="邮件已打开" value={emailsOpened || 0} color="text-amber-600" />
        </div>

        {/* Two columns: team + automation */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Team */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">团队概览</h2>
            {staffStats.length === 0 ? (
              <p className="text-sm text-gray-400">无销售员工数据</p>
            ) : (
              <div className="space-y-3">
                {staffStats.map((s: any) => (
                  <div key={s.user_id} className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{s.name}</span>
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${s.sales_tier === 'top' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {s.sales_tier === 'top' ? '高级' : '普通'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>活跃 <strong className="text-gray-900">{s.activeLeads}</strong></span>
                      <span className={s.overdueLeads > 0 ? 'text-red-600 font-medium' : ''}>
                        逾期 <strong>{s.overdueLeads}</strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Automation monitor */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">自动化监控</h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">搜索队列待处理</span>
                <span className="font-medium text-gray-900">{queuePending || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">已完成富集</span>
                <span className="font-medium text-gray-900">{queueCompleted || 0}</span>
              </div>
              <div className="border-t border-gray-100 pt-3 mt-3">
                <h3 className="text-xs font-medium text-gray-700 mb-2">最近搜索</h3>
                {(recentRuns || []).map((run: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{run.source} — 找到 {run.urls_found}，新增 {run.urls_new}</span>
                    <span>{new Date(run.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

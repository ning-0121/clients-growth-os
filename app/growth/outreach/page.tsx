import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import GrowthNavbar from '@/components/GrowthNavbar';
import OutreachDashboard from './OutreachDashboard';

export default async function OutreachPage() {
  await requireAuth();
  const supabase = await createClient();

  // Active campaigns with lead info
  const { data: campaigns } = await supabase
    .from('outreach_campaigns')
    .select(`
      id, lead_id, current_step, status, next_send_at, enrolled_at, completed_at,
      growth_leads!inner(company_name, contact_name, contact_email, grade, ai_recommendation),
      outreach_sequences!inner(name, steps)
    `)
    .order('enrolled_at', { ascending: false })
    .limit(100);

  // Email stats
  const { data: emailStats } = await supabase
    .from('outreach_emails')
    .select('status')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const stats = {
    total_sent: 0,
    delivered: 0,
    opened: 0,
    bounced: 0,
  };

  (emailStats || []).forEach((e: any) => {
    stats.total_sent++;
    if (e.status === 'delivered' || e.status === 'opened') stats.delivered++;
    if (e.status === 'opened') stats.opened++;
    if (e.status === 'bounced') stats.bounced++;
  });

  // Count by campaign status
  const allCampaigns = campaigns || [];
  const activeCampaigns = allCampaigns.filter((c: any) => c.status === 'active');
  const repliedCampaigns = allCampaigns.filter((c: any) => c.status === 'replied');
  const completedCampaigns = allCampaigns.filter((c: any) => c.status === 'completed');

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Outreach Engine</h1>
          <p className="text-sm text-gray-500 mt-1">AI 自动开发信 — 个性化邮件序列，追踪打开和回复</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          <MetricCard label="活跃序列" value={activeCampaigns.length} color="text-indigo-600" border="border-indigo-200" />
          <MetricCard label="已回复" value={repliedCampaigns.length} color="text-green-600" border="border-green-200" />
          <MetricCard label="已完成" value={completedCampaigns.length} color="text-gray-600" border="border-gray-200" />
          <MetricCard label="30天发送" value={stats.total_sent} color="text-blue-600" border="border-blue-200" />
          <MetricCard label="打开率" value={stats.delivered > 0 ? `${Math.round(stats.opened / stats.delivered * 100)}%` : '-'} color="text-amber-600" border="border-amber-200" />
          <MetricCard label="退信" value={stats.bounced} color="text-red-600" border="border-red-200" />
        </div>

        <OutreachDashboard campaigns={allCampaigns} />
      </main>
    </div>
  );
}

function MetricCard({ label, value, color, border }: {
  label: string; value: number | string; color: string; border: string;
}) {
  return (
    <div className={`bg-white rounded-lg p-3 border ${border}`}>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

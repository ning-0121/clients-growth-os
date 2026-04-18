import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';
import SupervisorDashboard from './SupervisorDashboard';

export const dynamic = 'force-dynamic';

export default async function SupervisorPage() {
  await requireAuth();
  const profile = await getCurrentProfile();
  if (profile?.role !== '管理员') {
    redirect('/growth/workspace');
  }

  const supabase = await createClient();

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Load last 24h of hourly metrics
  const { data: metrics } = await supabase
    .from('supervisor_metrics')
    .select('*')
    .gte('hour_bucket', twentyFourHoursAgo.toISOString())
    .order('hour_bucket', { ascending: true });

  // Unresolved alerts
  const { data: alerts } = await supabase
    .from('supervisor_alerts')
    .select('*')
    .is('resolved_at', null)
    .order('detected_at', { ascending: false })
    .limit(50);

  // Recent AI jobs (last hour)
  const { data: recentJobs } = await supabase
    .from('ai_job_logs')
    .select('*')
    .gte('started_at', oneHourAgo.toISOString())
    .order('started_at', { ascending: false })
    .limit(50);

  // Total stats (last 24h)
  const metricsList = metrics || [];
  const totals = metricsList.reduce((acc: any, m: any) => ({
    new_leads: (acc.new_leads || 0) + (m.new_leads_count || 0),
    new_urls: (acc.new_urls || 0) + (m.new_urls_queued || 0),
    emails_sent: (acc.emails_sent || 0) + (m.emails_sent || 0),
    emails_opened: (acc.emails_opened || 0) + (m.emails_opened || 0),
    ai_jobs_total: (acc.ai_jobs_total || 0) + (m.ai_jobs_total || 0),
    ai_jobs_error: (acc.ai_jobs_error || 0) + (m.ai_jobs_error || 0),
    tokens_used: (acc.tokens_used || 0) + (m.total_tokens_used || 0),
  }), {});

  const currentPending = metricsList[metricsList.length - 1]?.approvals_pending || 0;
  const currentStalled = metricsList[metricsList.length - 1]?.stalled_jobs || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">AI 监工</h1>
          <p className="text-sm text-gray-500 mt-1">
            24 小时 AI 工作状态监控 · 每小时自动检查卡壳/低产出/高错误率
          </p>
        </div>

        <SupervisorDashboard
          metrics={metricsList}
          alerts={alerts || []}
          recentJobs={recentJobs || []}
          totals={totals}
          currentPending={currentPending}
          currentStalled={currentStalled}
        />
      </main>
    </div>
  );
}

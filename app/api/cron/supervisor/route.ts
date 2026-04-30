import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { notifySlack } from '@/lib/supervisor/slack-notify';

// Parallel health queries + AI anomaly detection
export const maxDuration = 120;

/**
 * /api/cron/supervisor — Hourly AI health check & auto-remediation.
 *
 * Responsibilities:
 * 1. Compute hourly KPI snapshot (new leads, emails sent, AI jobs, etc.)
 * 2. Detect stalled cron jobs (no recent runs or all errors)
 * 3. Detect low-throughput periods (0 leads in last 3 hours)
 * 4. Auto-resolve: pause bad campaigns, mark stuck jobs as timeout
 * 5. Create alerts for admin review
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const hourBucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const alerts: any[] = [];

  try {
    // ── 1. Hourly metrics snapshot ──

    const [
      newLeadsRes,
      newQueueRes,
      verifiedRes,
      disqualifiedRes,
      emailsFoundRes,
      sentEmailsRes,
      pendingApprovalsRes,
      aiJobsRes,
    ] = await Promise.all([
      supabase.from('growth_leads').select('id', { count: 'exact', head: true }).gte('created_at', oneHourAgo.toISOString()),
      supabase.from('lead_source_queue').select('id', { count: 'exact', head: true }).gte('created_at', oneHourAgo.toISOString()),
      supabase.from('growth_leads').select('id', { count: 'exact', head: true }).eq('status', 'qualified').gte('updated_at', oneHourAgo.toISOString()),
      supabase.from('growth_leads').select('id', { count: 'exact', head: true }).eq('status', 'disqualified').gte('updated_at', oneHourAgo.toISOString()),
      supabase.from('growth_leads').select('id', { count: 'exact', head: true }).not('contact_email', 'is', null).gte('updated_at', oneHourAgo.toISOString()),
      supabase.from('outreach_emails').select('status').gte('created_at', oneHourAgo.toISOString()),
      supabase.from('pending_email_approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('ai_job_logs').select('status, duration_ms, tokens_used').gte('started_at', oneHourAgo.toISOString()),
    ]);

    const emails = sentEmailsRes.data || [];
    const emailsSent = emails.filter((e: any) => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened').length;
    const emailsDelivered = emails.filter((e: any) => e.status === 'delivered' || e.status === 'opened').length;
    const emailsOpened = emails.filter((e: any) => e.status === 'opened').length;

    const aiJobs = aiJobsRes.data || [];
    const aiJobsSuccess = aiJobs.filter((j: any) => j.status === 'success').length;
    const aiJobsError = aiJobs.filter((j: any) => j.status === 'error' || j.status === 'timeout').length;
    const avgDuration = aiJobs.length > 0
      ? Math.round(aiJobs.reduce((sum: number, j: any) => sum + (j.duration_ms || 0), 0) / aiJobs.length)
      : 0;
    const totalTokens = aiJobs.reduce((sum: number, j: any) => sum + (j.tokens_used || 0), 0);

    // Detect stalled jobs (running for > 10 minutes)
    const { data: stalled } = await supabase
      .from('ai_job_logs')
      .select('id, job_name, started_at')
      .eq('status', 'running')
      .lt('started_at', new Date(now.getTime() - 10 * 60 * 1000).toISOString());

    const stalledCount = (stalled || []).length;

    // Upsert snapshot
    await supabase.from('supervisor_metrics').upsert({
      hour_bucket: hourBucket.toISOString(),
      snapshot_at: now.toISOString(),
      new_leads_count: newLeadsRes.count || 0,
      new_urls_queued: newQueueRes.count || 0,
      verified_count: verifiedRes.count || 0,
      disqualified_count: disqualifiedRes.count || 0,
      emails_found: emailsFoundRes.count || 0,
      emails_sent: emailsSent,
      emails_delivered: emailsDelivered,
      emails_opened: emailsOpened,
      approvals_pending: pendingApprovalsRes.count || 0,
      ai_jobs_total: aiJobs.length,
      ai_jobs_success: aiJobsSuccess,
      ai_jobs_error: aiJobsError,
      avg_duration_ms: avgDuration,
      total_tokens_used: totalTokens,
      stalled_jobs: stalledCount,
    }, { onConflict: 'hour_bucket' });

    // ── 2. Auto-remediation: mark stalled jobs as timeout ──

    if (stalledCount > 0) {
      await supabase.from('ai_job_logs')
        .update({ status: 'timeout', finished_at: now.toISOString() })
        .eq('status', 'running')
        .lt('started_at', new Date(now.getTime() - 10 * 60 * 1000).toISOString());

      alerts.push({
        alert_type: 'stalled_cron',
        severity: 'warning',
        title: `${stalledCount} 个 AI 任务卡住超过10分钟`,
        description: `已自动标记为 timeout。任务: ${(stalled || []).map((s: any) => s.job_name).join(', ')}`,
        auto_actions_taken: [`marked ${stalledCount} jobs as timeout`],
      });
    }

    // ── 3. Detect low throughput: no new leads in 3 hours ──

    const { count: threeHourLeads } = await supabase
      .from('growth_leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', threeHoursAgo.toISOString());

    if ((threeHourLeads || 0) === 0) {
      alerts.push({
        alert_type: 'low_throughput',
        severity: 'critical',
        title: '过去3小时 0 条新客户',
        description: 'discovery cron 可能未运行。请检查 Vercel cron 日志 + SerpAPI 配额。',
        related_job: 'discover',
      });
    }

    // ── 4. Detect high error rate ──

    if (aiJobs.length >= 5 && aiJobsError / aiJobs.length > 0.3) {
      alerts.push({
        alert_type: 'high_error_rate',
        severity: 'critical',
        title: `AI 任务错误率 ${Math.round((aiJobsError / aiJobs.length) * 100)}%`,
        description: `过去1小时 ${aiJobsError}/${aiJobs.length} 失败。可能是 API 配额用完或 prompt 问题。`,
      });
    }

    // ── 5. Pending approvals queue too long ──

    if ((pendingApprovalsRes.count || 0) > 10) {
      alerts.push({
        alert_type: 'approvals_backlog',
        severity: 'warning',
        title: `${pendingApprovalsRes.count} 封邮件待审批`,
        description: '管理员需要尽快处理审批队列',
      });
    }

    // Insert alerts — but dedupe: don't create same alert_type in last 12h if unresolved
    if (alerts.length > 0) {
      const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
      const typesToSuppress = new Set<string>();

      for (const alert of alerts) {
        const { data: recent } = await supabase
          .from('supervisor_alerts')
          .select('id')
          .eq('alert_type', alert.alert_type)
          .is('resolved_at', null)
          .gte('detected_at', twelveHoursAgo)
          .limit(1);
        if (recent && recent.length > 0) {
          typesToSuppress.add(alert.alert_type);
        }
      }

      const fresh = alerts.filter((a) => !typesToSuppress.has(a.alert_type));
      if (fresh.length > 0) {
        await supabase.from('supervisor_alerts').insert(fresh);

        // Push critical alerts to Slack immediately (warning = DB only, no spam)
        for (const alert of fresh) {
          if (alert.severity === 'critical') {
            await notifySlack(alert);
          }
        }
      }
    }

    // Auto-resolve alerts when condition clears
    // E.g. if we now have leads, resolve old "low_throughput" alerts
    if ((threeHourLeads || 0) > 0) {
      await supabase.from('supervisor_alerts')
        .update({ resolved_at: now.toISOString() })
        .eq('alert_type', 'low_throughput')
        .is('resolved_at', null);
    }
    if ((pendingApprovalsRes.count || 0) <= 10) {
      await supabase.from('supervisor_alerts')
        .update({ resolved_at: now.toISOString() })
        .eq('alert_type', 'approvals_backlog')
        .is('resolved_at', null);
    }

    return NextResponse.json({
      success: true,
      hour_bucket: hourBucket.toISOString(),
      metrics: {
        new_leads_1h: newLeadsRes.count || 0,
        new_urls_1h: newQueueRes.count || 0,
        emails_sent_1h: emailsSent,
        ai_jobs_1h: aiJobs.length,
        ai_errors_1h: aiJobsError,
        stalled_jobs: stalledCount,
        pending_approvals: pendingApprovalsRes.count || 0,
      },
      alerts_created: alerts.length,
    });
  } catch (err: any) {
    console.error('[Supervisor] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

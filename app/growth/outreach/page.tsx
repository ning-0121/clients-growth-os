import { createClient } from '@/lib/supabase/server';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import GrowthNavbar from '@/components/GrowthNavbar';
import OutreachView from './OutreachView';

export const dynamic = 'force-dynamic';

export default async function OutreachPage() {
  await requireAuth();
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === '管理员';

  const supabase = await createClient();

  // Load campaigns with email history
  const { data: campaigns } = await supabase
    .from('outreach_campaigns')
    .select(`
      id, lead_id, current_step, status, next_send_at, enrolled_at, completed_at,
      growth_leads!inner(company_name, contact_name, contact_email, grade, website),
      outreach_sequences!inner(name, steps),
      outreach_emails(id, step_number, subject, body_text, to_email, status, sent_at, opened_at)
    `)
    .order('enrolled_at', { ascending: false })
    .limit(200);

  // Load pending email approvals
  const { data: approvals } = await supabase
    .from('pending_email_approvals')
    .select(`
      id, lead_id, lead_category, to_email, subject, body_text, step_number, email_type,
      submitted_by_name, submitted_at, status, review_notes, send_error,
      growth_leads!inner(company_name, contact_name)
    `)
    .order('submitted_at', { ascending: false })
    .limit(100);

  // Stats
  const { data: emailStats } = await supabase
    .from('outreach_emails')
    .select('status, to_email')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const stats = { total_sent: 0, delivered: 0, opened: 0, bounced: 0 };
  (emailStats || []).forEach((e: any) => {
    stats.total_sent++;
    if (e.status === 'delivered' || e.status === 'opened') stats.delivered++;
    if (e.status === 'opened') stats.opened++;
    if (e.status === 'bounced') stats.bounced++;
  });

  const { count: blockedCount } = await supabase
    .from('growth_leads')
    .select('id', { count: 'exact', head: true })
    .eq('outreach_status', 'blocked_generic_email');

  const allCampaigns = (campaigns || []) as any[];
  const allApprovals = (approvals || []) as any[];
  const pendingApprovals = allApprovals.filter((a: any) => a.status === 'pending');

  const openRate = stats.delivered > 0 ? Math.round((stats.opened / stats.delivered) * 100) : 0;
  const bounceRate = stats.total_sent > 0 ? Math.round((stats.bounced / stats.total_sent) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">邮件开发中心</h1>
          <p className="text-sm text-gray-500 mt-1">
            AI 开发信序列 — A/B 级客户强制审批，C/D 级自动发送
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          <MetricCard label="待审批" value={pendingApprovals.length} color="text-amber-600" border="border-amber-200"
            note={pendingApprovals.length > 0 ? '需要处理' : undefined} />
          <MetricCard label="活跃序列" value={allCampaigns.filter((c: any) => c.status === 'active').length} color="text-indigo-600" border="border-indigo-200" />
          <MetricCard label="30天发送" value={stats.total_sent} color="text-blue-600" border="border-blue-200" />
          <MetricCard label="打开率" value={stats.total_sent > 0 ? `${openRate}%` : '—'} color="text-green-600" border="border-green-200" />
          <MetricCard label="退信" value={stats.bounced} color="text-red-600" border="border-red-200"
            note={bounceRate > 5 ? `${bounceRate}% ⚠️` : undefined} />
          <MetricCard label="泛型邮箱拦截" value={blockedCount || 0} color="text-orange-600" border="border-orange-200" />
        </div>

        {/* Logic chain explanation */}
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-xs font-semibold text-blue-800 mb-2">📋 邮件开发逻辑链</h3>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs text-blue-700">
            <div className="text-center">
              <div className="font-semibold">① 发现</div>
              <div className="text-blue-600">Google/Bing/Maps 搜索目标</div>
            </div>
            <div className="text-center">
              <div className="font-semibold">② 验证</div>
              <div className="text-blue-600">邮箱质量 + 评分≥60 入池</div>
            </div>
            <div className="text-center">
              <div className="font-semibold">③ 研究</div>
              <div className="text-blue-600">AI 分析网站/产品</div>
            </div>
            <div className="text-center">
              <div className="font-semibold">④ 个性化</div>
              <div className="text-blue-600">A/B 提交审批</div>
            </div>
            <div className="text-center">
              <div className="font-semibold">⑤ 发送</div>
              <div className="text-blue-600">审批通过自动发</div>
            </div>
          </div>
        </div>

        <OutreachView campaigns={allCampaigns} approvals={allApprovals} isAdmin={isAdmin} />
      </main>
    </div>
  );
}

function MetricCard({ label, value, color, border, note }: {
  label: string; value: number | string; color: string; border: string; note?: string;
}) {
  return (
    <div className={`bg-white rounded-lg p-3 border ${border}`}>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {note && <div className="text-xs text-orange-500 mt-0.5">{note}</div>}
    </div>
  );
}

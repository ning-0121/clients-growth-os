import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import GrowthNavbar from '@/components/GrowthNavbar';
import { GrowthLead } from '@/lib/types';
import LeadActionPanel from '../my-today/LeadActionPanel';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const user = await requireAuth();
  const profile = await getCurrentProfile();
  const role = profile?.role || '';

  if (role !== '销售' && role !== '管理员') {
    redirect('/login');
  }

  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // All active leads assigned to current user
  const { data: myLeads } = await supabase
    .from('growth_leads')
    .select('*')
    .eq('assigned_to', user.id)
    .in('status', ['new', 'qualified'])
    .order('deal_probability', { ascending: false });

  const leads = (myLeads || []) as (GrowthLead & Record<string, any>)[];

  // Pending outreach emails count
  const { count: pendingEmails } = await supabase
    .from('outreach_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .lte('next_send_at', nowIso);

  // System auto-discovery stats (today)
  const today = now.toISOString().split('T')[0];
  const { data: todayRuns } = await supabase
    .from('discovery_runs')
    .select('urls_found, urls_new')
    .gte('created_at', today + 'T00:00:00');

  const todayDiscovered = (todayRuns || []).reduce((sum: number, r: any) => sum + (r.urls_new || 0), 0);

  const { count: todayNewLeads } = await supabase
    .from('growth_leads')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today + 'T00:00:00');

  const { count: queuePending } = await supabase
    .from('lead_source_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  // Total system leads
  const { count: totalLeads } = await supabase
    .from('growth_leads')
    .select('id', { count: 'exact', head: true })
    .in('status', ['new', 'qualified', 'converted']);

  // Bucketing
  const buckets = {
    overdue: [] as typeof leads,
    todayDue: [] as typeof leads,
    firstTouch: [] as typeof leads,
    ongoing: [] as typeof leads,
  };

  for (const lead of leads) {
    const isDue = lead.next_action_due && lead.next_action_due <= nowIso;

    if (lead.first_touch_at && isDue) {
      buckets.overdue.push(lead);
    } else if (!lead.first_touch_at && isDue) {
      buckets.firstTouch.push(lead);
    } else if (lead.action_count === 0) {
      buckets.firstTouch.push(lead);
    } else {
      buckets.ongoing.push(lead);
    }
  }

  buckets.overdue.sort((a, b) => (a.next_action_due || '').localeCompare(b.next_action_due || ''));
  buckets.firstTouch.sort((a, b) => (b.deal_probability || 0) - (a.deal_probability || 0));

  const overdueCount = buckets.overdue.length;
  const firstTouchCount = buckets.firstTouch.length;
  const ongoingCount = buckets.ongoing.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">
            {getGreeting()}，{profile?.name || '同事'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            今天有 {overdueCount + firstTouchCount} 个客户需要你跟进
          </p>
        </div>

        {/* System auto-discovery summary */}
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-indigo-900">AI 自动开发引擎</h2>
            <span className="flex items-center gap-1 text-xs text-green-600">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /> 24h 运行中
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold text-indigo-700">{todayDiscovered}</div>
              <div className="text-xs text-gray-500">今日发现</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-700">{todayNewLeads || 0}</div>
              <div className="text-xs text-gray-500">今日入库</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-amber-700">{queuePending || 0}</div>
              <div className="text-xs text-gray-500">队列待处理</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-700">{totalLeads || 0}</div>
              <div className="text-xs text-gray-500">客户总数</div>
            </div>
          </div>
        </div>

        {/* My tasks */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MetricCard label="待跟进" sublabel="逾期需处理" value={overdueCount} color={overdueCount > 0 ? 'text-red-600' : 'text-gray-600'} border={overdueCount > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200'} />
          <MetricCard label="待首触" sublabel="新客户" value={firstTouchCount} color="text-amber-600" border="border-amber-200" />
          <MetricCard label="待发开发信" sublabel="自动队列" value={pendingEmails || 0} color="text-blue-600" border="border-blue-200" />
          <MetricCard label="进行中" sublabel="正常跟进" value={ongoingCount} color="text-gray-600" border="border-gray-200" />
        </div>

        {/* Overdue section */}
        {buckets.overdue.length > 0 && (
          <TaskSection
            title="逾期待跟进"
            subtitle="这些客户已过了跟进时间，请优先处理"
            leads={buckets.overdue}
            color="border-red-200 bg-red-50/50"
            now={now}
          />
        )}

        {/* First touch section */}
        {buckets.firstTouch.length > 0 && (
          <TaskSection
            title="待首触"
            subtitle="新分配的客户，需要首次联系"
            leads={buckets.firstTouch}
            color="border-amber-200 bg-amber-50/50"
            now={now}
          />
        )}

        {/* Ongoing section */}
        {buckets.ongoing.length > 0 && (
          <TaskSection
            title="进行中"
            subtitle="已有互动，按计划跟进"
            leads={buckets.ongoing}
            color="border-gray-200 bg-white"
            now={now}
          />
        )}

        {leads.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-400 text-sm">暂无分配给你的客户</p>
            <p className="text-gray-400 text-xs mt-1">系统正在 24 小时自动发现新客户...</p>
          </div>
        )}

        {/* Quick links */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickLink href="/growth/leads" label="客户瀑布流" desc="查看所有客户" icon="👥" />
          <QuickLink href="/growth/deals" label="成交中心" desc="跟进商机" icon="💰" />
          <QuickLink href="/growth/service" label="客服中心" desc="查看对话" icon="💬" />
          <QuickLink href="/growth/analytics" label="数据中心" desc="查看数据" icon="📊" />
        </div>
      </div>
    </div>
  );
}

function QuickLink({ href, label, desc, icon }: { href: string; label: string; desc: string; icon: string }) {
  return (
    <Link href={href} className="bg-white rounded-lg border border-gray-200 p-3 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors text-center">
      <div className="text-lg mb-1">{icon}</div>
      <div className="text-xs font-medium text-gray-900">{label}</div>
      <div className="text-xs text-gray-400">{desc}</div>
    </Link>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function MetricCard({ label, sublabel, value, color, border }: {
  label: string; sublabel: string; value: number; color: string; border: string;
}) {
  return (
    <div className={`rounded-lg p-4 border ${border}`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-700 font-medium mt-1">{label}</div>
      <div className="text-xs text-gray-400">{sublabel}</div>
    </div>
  );
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  'B+': 'bg-blue-100 text-blue-800',
  B: 'bg-yellow-100 text-yellow-800',
  C: 'bg-gray-100 text-gray-600',
};

const PROB_COLORS: Record<string, string> = {
  hot: 'bg-green-500',
  high_interest: 'bg-orange-500',
  interested: 'bg-blue-500',
  slight_interest: 'bg-yellow-400',
  cold: 'bg-gray-300',
};

function getRecommendation(lead: Record<string, any>): { action: string; label: string } {
  // Use AI recommendation if available
  if (lead.next_recommended_action) {
    return { action: 'follow_up', label: lead.next_recommended_action };
  }

  if (!lead.first_touch_at) {
    if (lead.contact_email) return { action: 'email', label: '发送首次邮件' };
    if (lead.contact_linkedin) return { action: 'social_outreach', label: 'LinkedIn 首次触达' };
    if (lead.instagram_handle) return { action: 'social_outreach', label: 'IG 首次触达' };
    return { action: 'social_outreach', label: '查找联系方式' };
  }
  if (lead.action_count <= 2) {
    return { action: 'email', label: '发送跟进邮件' };
  }
  return { action: 'call', label: '电话跟进' };
}

function overdueLabel(lead: Record<string, any>, now: Date): string | null {
  if (!lead.next_action_due) return null;
  const due = new Date(lead.next_action_due);
  if (due > now) return null;
  const diffH = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60));
  if (diffH < 1) return '刚到期';
  if (diffH < 24) return `逾期 ${diffH}h`;
  return `逾期 ${Math.floor(diffH / 24)}天`;
}

function TaskSection({ title, subtitle, leads, color, now }: {
  title: string; subtitle: string; leads: any[]; color: string; now: Date;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{leads.length}</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">{subtitle}</p>

      <div className="space-y-2">
        {leads.map((lead) => {
          const rec = getRecommendation(lead);
          const overdue = overdueLabel(lead, now);
          const prob = lead.deal_probability || 0;
          const probColor = PROB_COLORS[lead.probability_stage || 'cold'] || 'bg-gray-300';

          return (
            <div key={lead.id} className={`rounded-lg border p-3 ${color}`}>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Link href={`/growth/leads/${lead.id}`} className="font-medium text-sm text-gray-900 hover:text-blue-600 hover:underline">
                      {lead.company_name}
                    </Link>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${GRADE_COLORS[lead.grade || 'C']}`}>
                      {lead.grade}
                    </span>
                    {/* Probability badge */}
                    {prob > 0 && (
                      <span className="flex items-center gap-1 text-xs text-gray-600">
                        <span className={`inline-block w-2 h-2 rounded-full ${probColor}`} />
                        {prob}%
                      </span>
                    )}
                    {overdue && (
                      <span className="text-xs font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                        {overdue}
                      </span>
                    )}
                    {lead.escalation_level >= 2 && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">老板关注</span>
                    )}
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500 mb-1">
                    {lead.contact_email && <span className="bg-blue-50 text-blue-600 px-1 py-0.5 rounded">邮箱</span>}
                    {lead.contact_linkedin && <span className="bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded">LI</span>}
                    {lead.instagram_handle && <span className="bg-pink-50 text-pink-600 px-1 py-0.5 rounded">IG</span>}
                    {lead.action_count > 0 && <span>已触达 {lead.action_count} 次</span>}
                  </div>
                  <div className="text-xs">
                    <span className="text-indigo-600 font-medium bg-indigo-50 px-1.5 py-0.5 rounded">{rec.label}</span>
                    {lead.next_action_reason && (
                      <span className="text-gray-400 ml-2">{lead.next_action_reason}</span>
                    )}
                  </div>
                </div>
                <LeadActionPanel
                  leadId={lead.id}
                  leadName={lead.company_name}
                  recommendedAction={rec.action}
                  prefillEmail={lead.contact_email || ''}
                  prefillPlatform={lead.contact_linkedin ? 'linkedin' : lead.instagram_handle ? 'instagram' : 'linkedin'}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

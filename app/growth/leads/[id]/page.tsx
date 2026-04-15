import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';
import { GrowthLead, GrowthLeadAction } from '@/lib/types';
import LeadDetailActions from './LeadDetailActions';

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  'B+': 'bg-blue-100 text-blue-800',
  B: 'bg-yellow-100 text-yellow-800',
  C: 'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  new: { text: '新线索', color: 'bg-blue-100 text-blue-700' },
  qualified: { text: '已合格', color: 'bg-green-100 text-green-700' },
  disqualified: { text: '已淘汰', color: 'bg-red-100 text-red-700' },
  converted: { text: '已转化', color: 'bg-purple-100 text-purple-700' },
};

const ACTION_LABELS: Record<string, string> = {
  email: '邮件触达',
  social_outreach: '社交触达',
  call: '电话触达',
  reject: '拒绝',
  return: '退回',
  reply: '收到回复',
  promote: '转为商机',
};

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const profile = await getCurrentProfile();
  const role = profile?.role || '';

  if (role !== '销售' && role !== '管理员') {
    redirect('/login');
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from('growth_leads')
    .select('*')
    .eq('id', id)
    .single();

  if (!lead) notFound();

  const d = lead as GrowthLead;

  // Action history
  const { data: actionsData } = await supabase
    .from('growth_lead_actions')
    .select('*')
    .eq('lead_id', id)
    .order('created_at', { ascending: false });

  const actions = (actionsData || []) as GrowthLeadAction[];

  // Assignee name
  let assigneeName = '未分配';
  if (d.assigned_to) {
    const { data: assigneeProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('user_id', d.assigned_to)
      .single();
    assigneeName = assigneeProfile?.name || d.assigned_to.slice(0, 8);
  }

  const st = STATUS_LABELS[d.status] || STATUS_LABELS.new;
  const gc = GRADE_COLORS[d.grade || 'C'];
  const isActive = d.status === 'new' || d.status === 'qualified';

  // Recommended action
  let recLabel = '—';
  let recAction = '';
  if (isActive) {
    if (!d.first_touch_at) {
      if (d.contact_email) { recLabel = '发送首次邮件'; recAction = 'email'; }
      else if (d.contact_linkedin) { recLabel = 'LinkedIn 首次触达'; recAction = 'social_outreach'; }
      else { recLabel = '查找联系方式并触达'; recAction = 'social_outreach'; }
    } else if (d.action_count <= 2) {
      if (d.contact_email) { recLabel = '发送跟进邮件'; recAction = 'email'; }
      else { recLabel = '发送跟进消息'; recAction = 'social_outreach'; }
    } else {
      recLabel = '电话跟进'; recAction = 'call';
    }
  }

  const now = new Date();
  let overdueText: string | null = null;
  if (d.next_action_due) {
    const due = new Date(d.next_action_due);
    if (due <= now) {
      const diffH = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60));
      overdueText = diffH < 1 ? '刚到期' : diffH < 24 ? `逾期 ${diffH} 小时` : `逾期 ${Math.floor(diffH / 24)} 天`;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        <div className="mb-4 flex items-center gap-3">
          <Link href="/growth/workspace" className="text-sm text-gray-500 hover:text-gray-700">&larr; 工作台</Link>
        </div>

        {/* Header */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-gray-900">{d.company_name}</h1>
                <span className={`text-sm font-semibold px-3 py-0.5 rounded-full ${gc}`}>{d.grade}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.text}</span>
                {overdueText && (
                  <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{overdueText}</span>
                )}
              </div>
              {d.contact_name && <p className="text-sm text-gray-600">{d.contact_name}</p>}
            </div>
          </div>

          {/* Score breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
            <ScoreCard label="综合分" value={d.final_score} />
            <ScoreCard label="质量" value={d.quality_score} />
            <ScoreCard label="机会" value={d.opportunity_score} />
            <ScoreCard label="触达" value={d.reachability_score} />
          </div>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          {/* Source & assignment */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">来源与分配</h3>
            <dl className="space-y-2 text-sm">
              <Row label="来源" value={d.source || '—'} />
              <Row label="分配给" value={assigneeName} />
              <Row label="分配时间" value={d.assigned_at ? new Date(d.assigned_at).toLocaleString('zh-CN') : '—'} />
              <Row label="创建时间" value={new Date(d.created_at).toLocaleString('zh-CN')} />
            </dl>
          </div>

          {/* Contact paths */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">联系路径</h3>
            <dl className="space-y-2 text-sm">
              <Row label="邮箱" value={d.contact_email || '—'} />
              <Row label="LinkedIn" value={d.contact_linkedin || '—'} />
              <Row label="Instagram" value={d.instagram_handle || '—'} />
              <Row label="网站" value={d.website || '—'} />
            </dl>
          </div>
        </div>

        {/* Execution state */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">执行状态</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <Row label="首次触达" value={d.first_touch_at ? new Date(d.first_touch_at).toLocaleString('zh-CN') : '未触达'} />
            <Row label="最近操作" value={d.last_action_at ? new Date(d.last_action_at).toLocaleString('zh-CN') : '—'} />
            <Row label="下次到期" value={d.next_action_due ? new Date(d.next_action_due).toLocaleString('zh-CN') : '—'} />
            <Row label="操作次数" value={String(d.action_count)} />
          </div>
          {isActive && (
            <div className="mt-4 pt-3 border-t border-gray-100 text-sm">
              <span className="text-gray-500">建议下一步:</span>{' '}
              <span className="font-semibold text-gray-900">{recLabel}</span>
            </div>
          )}
          {d.product_match && (
            <div className="mt-2 text-sm">
              <span className="text-gray-500">产品匹配:</span>{' '}
              <span className="text-gray-700">{d.product_match}</span>
            </div>
          )}
        </div>

        {/* Actions panel */}
        {isActive && (
          <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">执行操作</h3>
            <LeadDetailActions
              leadId={d.id}
              leadName={d.company_name}
              recommendedAction={recAction}
              prefillEmail={d.contact_email || ''}
              prefillPlatform={d.contact_linkedin ? 'linkedin' : d.instagram_handle ? 'instagram' : 'linkedin'}
              productMatch={d.product_match || ''}
            />
          </div>
        )}

        {/* Action history */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">操作记录</h3>
          {actions.length === 0 ? (
            <p className="text-sm text-gray-400">暂无操作记录</p>
          ) : (
            <div className="space-y-3">
              {actions.map((a) => (
                <div key={a.id} className="border border-gray-100 rounded-lg px-4 py-3 text-sm">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {ACTION_LABELS[a.action_type] || a.action_type}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(a.created_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  {a.note && <p className="text-gray-600 mt-1">{a.note}</p>}
                  {a.evidence_json && Object.keys(a.evidence_json).length > 0 && (
                    <div className="mt-2 bg-gray-50 rounded px-3 py-2 text-xs text-gray-600 space-y-0.5">
                      {Object.entries(a.evidence_json).map(([k, v]) => (
                        <div key={k}>
                          <span className="text-gray-400">{k}:</span>{' '}
                          <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? 'text-green-700' : value >= 50 ? 'text-blue-700' : value >= 30 ? 'text-yellow-700' : 'text-gray-500';
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-gray-400">{label}:</span>{' '}
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import GrowthNavbar from '@/components/GrowthNavbar';
import { GrowthLead, IntakeRun } from '@/lib/types';
import BatchIntakeButton from './BatchIntakeButton';

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

const SOURCE_LABELS: Record<string, { text: string; color: string }> = {
  ig: { text: 'IG', color: 'bg-pink-100 text-pink-700' },
  linkedin: { text: 'LI', color: 'bg-indigo-100 text-indigo-700' },
  website: { text: 'Web', color: 'bg-sky-100 text-sky-700' },
  customs: { text: '海关', color: 'bg-amber-100 text-amber-700' },
  referral: { text: '推荐', color: 'bg-green-100 text-green-700' },
  test_batch: { text: '测试', color: 'bg-gray-100 text-gray-500' },
  auto_scrape: { text: '抓取', color: 'bg-violet-100 text-violet-700' },
};

const TRIGGER_LABELS: Record<string, string> = {
  auto_scrape: '品牌抓取',
  test_batch: '模拟导入',
  api: 'API 导入',
  manual: '手动导入',
};

export default async function IntakePage() {
  await requireAuth();
  const profile = await getCurrentProfile();
  const role = profile?.role || '';

  if (role !== '销售' && role !== '管理员') {
    redirect('/login');
  }

  const supabase = await createClient();

  // Leads (newest first)
  const { data: leads } = await supabase
    .from('growth_leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const leadList = (leads || []) as GrowthLead[];

  // Recent intake runs
  const { data: runsData } = await supabase
    .from('growth_intake_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  const runs = (runsData || []) as IntakeRun[];

  // Staff name lookup for assigned_to
  const assigneeIds = [...new Set(leadList.map((l) => l.assigned_to).filter(Boolean))] as string[];
  let staffMap = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: staffData } = await supabase
      .from('profiles')
      .select('user_id, name')
      .in('user_id', assigneeIds);
    (staffData || []).forEach((s: any) => staffMap.set(s.user_id, s.name));
  }

  // Determine "recent" threshold: leads created in last 30 minutes
  const recentThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Stats
  const total = leadList.length;
  const gradeA = leadList.filter((l) => l.grade === 'A').length;
  const gradeBPlus = leadList.filter((l) => l.grade === 'B+').length;
  const gradeB = leadList.filter((l) => l.grade === 'B').length;
  const gradeC = leadList.filter((l) => l.grade === 'C').length;
  const disqualified = leadList.filter((l) => l.status === 'disqualified').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Lead Intake</h1>
            <p className="text-sm text-gray-500 mt-1">
              线索录入、评分、分级与分配
            </p>
          </div>
          <BatchIntakeButton />
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 sm:gap-4 mb-6">
          <StatCard label="总计" value={total} border="border-gray-200" text="text-gray-900" />
          <StatCard label="A 级" value={gradeA} border="border-green-200" text="text-green-700" />
          <StatCard label="B+ 级" value={gradeBPlus} border="border-blue-200" text="text-blue-700" />
          <StatCard label="B 级" value={gradeB} border="border-yellow-200" text="text-yellow-700" />
          <StatCard label="C 级" value={gradeC} border="border-gray-200" text="text-gray-500" />
          <StatCard label="已淘汰" value={disqualified} border="border-red-200" text="text-red-600" />
        </div>

        {/* Recent runs */}
        {runs.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-400">最近导入:</span>
            {runs.map((run) => (
              <span key={run.id} className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1 text-gray-600">
                {TRIGGER_LABELS[run.trigger_type] || run.trigger_type}
                {' '}{run.total}条
                {' '}({run.qualified}合格{run.duplicates > 0 ? ` ${run.duplicates}重复` : ''})
                {' '}<span className="text-gray-400">{new Date(run.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              </span>
            ))}
          </div>
        )}

        {/* Lead table */}
        {leadList.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">暂无线索，点击右上角按钮生成测试数据</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">公司</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">来源</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">等级</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">综合</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">分配给</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">质量</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">机会</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">触达</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">联系方式</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {leadList.map((lead) => {
                    const st = STATUS_LABELS[lead.status] || STATUS_LABELS.new;
                    const gc = GRADE_COLORS[lead.grade || 'C'];
                    const src = SOURCE_LABELS[lead.source || ''] || { text: lead.source || '—', color: 'bg-gray-100 text-gray-500' };
                    const assignee = lead.assigned_to ? staffMap.get(lead.assigned_to) || '—' : '—';
                    const isRecent = lead.created_at >= recentThreshold;
                    const rowClass = lead.status === 'disqualified'
                      ? 'bg-gray-50 opacity-60'
                      : isRecent
                        ? 'bg-blue-50/40'
                        : '';
                    return (
                      <tr key={lead.id} className={rowClass}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {isRecent && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="最近导入" />}
                            <Link href={`/growth/leads/${lead.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline">
                              {lead.company_name}
                            </Link>
                          </div>
                          {lead.contact_name && (
                            <div className="text-xs text-gray-500 ml-3">{lead.contact_name}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${src.color}`}>{src.text}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gc}`}>
                            {lead.grade || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs font-mono font-semibold text-gray-700">{lead.final_score}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>
                            {st.text}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">
                          {assignee}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ScoreBar value={lead.quality_score} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ScoreBar value={lead.opportunity_score} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ScoreBar value={lead.reachability_score} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {lead.contact_email && (
                              <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">邮箱</span>
                            )}
                            {lead.contact_linkedin && (
                              <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">LI</span>
                            )}
                            {lead.instagram_handle && (
                              <span className="text-xs bg-pink-50 text-pink-600 px-1.5 py-0.5 rounded">IG</span>
                            )}
                            {!lead.contact_email && !lead.contact_linkedin && !lead.instagram_handle && (
                              <span className="text-xs text-gray-400">无</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(lead.created_at).toLocaleString('zh-CN', {
                            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, border, text }: { label: string; value: number; border: string; text: string }) {
  return (
    <div className={`bg-white rounded-lg border p-4 text-center ${border}`}>
      <div className={`text-2xl font-bold ${text}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function ScoreBar({ value }: { value: number }) {
  const color = value >= 70 ? 'bg-green-500' : value >= 50 ? 'bg-blue-500' : value >= 30 ? 'bg-yellow-500' : 'bg-gray-300';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-6 text-right">{value}</span>
    </div>
  );
}

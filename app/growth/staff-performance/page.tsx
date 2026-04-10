import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import GrowthNavbar from '@/components/GrowthNavbar';
import { GrowthLead, GrowthLeadAction } from '@/lib/types';
import { scoreStaff, StaffScoreResult, Judgment } from '@/lib/growth/staff-scoring';
import Link from 'next/link';

const JUDGMENT_COLORS: Record<Judgment, string> = {
  '高效执行': 'bg-green-100 text-green-800',
  '表现良好': 'bg-blue-100 text-blue-700',
  '需要关注': 'bg-amber-100 text-amber-800',
  '需要干预': 'bg-red-100 text-red-700',
};

const GRADE_COLORS: Record<string, string> = {
  A: 'text-green-700',
  'B+': 'text-blue-700',
  B: 'text-yellow-700',
  C: 'text-gray-500',
};

interface Props {
  searchParams: Promise<{ period?: string }>;
}

export default async function StaffPerformancePage({ searchParams }: Props) {
  await requireAdmin();
  const supabase = await createClient();

  const params = await searchParams;
  const period = params.period === 'week' ? 'week' : 'today';

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).toISOString();
  const periodStart = period === 'week' ? weekStart : todayStart;
  const days = period === 'week' ? 7 : 1;

  // Fetch all data
  const [
    { data: allLeads },
    { data: periodActions },
    { data: staffData },
  ] = await Promise.all([
    supabase
      .from('growth_leads')
      .select('id, company_name, assigned_to, status, first_touch_at, last_action_at, next_action_due, action_count, assigned_at, grade'),
    supabase
      .from('growth_lead_actions')
      .select('id, lead_id, action_type, created_by, created_at')
      .gte('created_at', periodStart),
    supabase
      .from('profiles')
      .select('user_id, name, sales_tier')
      .eq('role', '销售'),
  ]);

  const leads = (allLeads || []) as GrowthLead[];
  const actions = (periodActions || []) as GrowthLeadAction[];
  const staff = (staffData || []) as { user_id: string; name: string; sales_tier: string | null }[];

  // Score each staff member
  const results: StaffScoreResult[] = staff
    .map((s) => scoreStaff(s.user_id, s.name, s.sales_tier, leads, actions, periodStart, nowIso, days))
    .sort((a, b) => b.composite - a.composite);

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Staff Performance</h1>
            <p className="text-sm text-gray-500 mt-1">
              员工绩效看板 — 基于执行量、纪律性、转化结果三维评估
            </p>
          </div>
          {/* Period toggle */}
          <div className="flex bg-white border border-gray-200 rounded-md overflow-hidden">
            <PeriodLink label="Today" value="today" active={period === 'today'} />
            <PeriodLink label="This Week" value="week" active={period === 'week'} />
          </div>
        </div>

        <p className="text-xs text-gray-400 mb-6">
          评分基于参考基线（非硬性 KPI），用于发现趋势和辅助管理判断。数据不足时不强制评分。
        </p>

        {/* Summary table */}
        {results.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">无销售员工数据</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">员工</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">执行量</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">纪律性</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">转化</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">综合</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">判定</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">建议</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((r) => (
                    <tr key={r.userId} className={r.dataInsufficient ? 'opacity-50' : ''}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{r.name}</div>
                        {r.tier && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${r.tier === 'top' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                            {r.tier}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ScoreCell value={r.scores.volume} insufficient={r.dataInsufficient} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ScoreCell value={r.scores.discipline} insufficient={r.dataInsufficient} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ScoreCell value={r.scores.conversion} insufficient={r.dataInsufficient} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.dataInsufficient ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : (
                          <span className="text-sm font-bold text-gray-900">{r.composite}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${JUDGMENT_COLORS[r.judgment]}`}>
                          {r.dataInsufficient ? '数据不足' : r.judgment}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px]">
                        {r.recommendation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Detail cards */}
        {results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((r) => (
              <DetailCard key={r.userId} result={r} period={period} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Components ──────────────────────────────────────────────

function PeriodLink({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <Link
      href={`/growth/staff-performance${value === 'today' ? '' : '?period=' + value}`}
      className={`px-4 py-2 text-sm font-medium ${
        active ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </Link>
  );
}

function ScoreCell({ value, insufficient }: { value: number; insufficient: boolean }) {
  if (insufficient) return <span className="text-xs text-gray-400">—</span>;
  const color = value >= 70 ? 'text-green-700' : value >= 50 ? 'text-blue-700' : value >= 30 ? 'text-amber-700' : 'text-red-600';
  return <span className={`text-sm font-semibold ${color}`}>{value}</span>;
}

function DimBar({ label, value, insufficient }: { label: string; value: number; insufficient: boolean }) {
  const color = insufficient ? 'bg-gray-200' :
    value >= 70 ? 'bg-green-500' : value >= 50 ? 'bg-blue-500' : value >= 30 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-8 text-right">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${insufficient ? 0 : value}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-600 w-6 text-right">
        {insufficient ? '—' : value}
      </span>
    </div>
  );
}

function DetailCard({ result: r, period }: { result: StaffScoreResult; period: string }) {
  const m = r.metrics;
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 ${r.dataInsufficient ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-semibold text-gray-900">{r.name}</span>
          {r.tier && (
            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${r.tier === 'top' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
              {r.tier}
            </span>
          )}
        </div>
        {r.dataInsufficient ? (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">数据不足</span>
        ) : (
          <span className="text-lg font-bold text-gray-900">{r.composite}</span>
        )}
      </div>

      {/* Dimension bars */}
      <div className="space-y-1.5 mb-4">
        <DimBar label="Vol" value={r.scores.volume} insufficient={r.dataInsufficient} />
        <DimBar label="Disc" value={r.scores.discipline} insufficient={r.dataInsufficient} />
        <DimBar label="Conv" value={r.scores.conversion} insufficient={r.dataInsufficient} />
      </div>

      {/* Raw metrics */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-gray-100 pt-3">
        <MetricRow label="活跃线索" value={m.activeLeadCount} />
        <MetricRow label={`${period === 'week' ? '本周' : '今日'}分配`} value={m.assignedInPeriod} />
        <MetricRow label="外联次数" value={m.outreachCount} />
        <MetricRow label="首触" value={m.firstTouchCount} />
        <MetricRow label="跟进" value={m.followUpCount} />
        <MetricRow
          label="逾期"
          value={m.overdueCount}
          highlight={m.overdueCount > 0 ? 'red' : undefined}
        />
        <MetricRow
          label="闲置"
          value={m.idleCount}
          highlight={m.idleCount > 0 ? 'amber' : undefined}
        />
        <MetricRow
          label="响应时间"
          value={m.avgResponseHours !== null ? `${m.avgResponseHours.toFixed(1)}h` : '—'}
        />
        <MetricRow label="回复" value={m.replyCount} highlight={m.replyCount > 0 ? 'green' : undefined} />
        <MetricRow label="转化" value={m.promoteCount} highlight={m.promoteCount > 0 ? 'green' : undefined} />
        <MetricRow label="回复率" value={`${(m.replyRate * 100).toFixed(0)}%`} />
        <MetricRow
          label="线索质量"
          value={m.avgLeadGrade || '—'}
          highlight={m.avgLeadGrade ? undefined : undefined}
          gradeColor={m.avgLeadGrade ? GRADE_COLORS[m.avgLeadGrade] : undefined}
        />
      </div>

      {/* Recommendation */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500">{r.recommendation}</p>
      </div>
    </div>
  );
}

function MetricRow({
  label, value, highlight, gradeColor,
}: {
  label: string; value: number | string; highlight?: 'red' | 'amber' | 'green'; gradeColor?: string;
}) {
  const colorMap = {
    red: 'text-red-600 font-semibold',
    amber: 'text-amber-600 font-semibold',
    green: 'text-green-600 font-semibold',
  };
  const valueClass = gradeColor || (highlight ? colorMap[highlight] : 'text-gray-700');
  return (
    <>
      <span className="text-gray-500">{label}</span>
      <span className={`text-right font-mono ${valueClass}`}>{value}</span>
    </>
  );
}

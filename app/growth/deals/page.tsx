import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import GrowthNavbar from '@/components/GrowthNavbar';
import { GrowthDeal, GrowthLead, DealStage } from '@/lib/types';
import DealActions from './DealActions';

const STAGE_ORDER: Record<string, number> = {
  '大货': 0,
  '试单': 1,
  '样品': 2,
  '报价': 3,
};

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  won: 1,
  lost: 2,
};

const STAGE_COLORS: Record<string, string> = {
  '报价': 'bg-gray-100 text-gray-700',
  '样品': 'bg-blue-100 text-blue-700',
  '试单': 'bg-amber-100 text-amber-700',
  '大货': 'bg-green-100 text-green-700',
};

const STATUS_COLORS: Record<string, { text: string; color: string }> = {
  active: { text: '进行中', color: 'bg-blue-100 text-blue-700' },
  won: { text: '已赢单', color: 'bg-green-100 text-green-700' },
  lost: { text: '已丢单', color: 'bg-red-100 text-red-700' },
};

const SOURCE_LABELS: Record<string, { text: string; color: string }> = {
  ig: { text: 'IG', color: 'bg-pink-100 text-pink-700' },
  linkedin: { text: 'LI', color: 'bg-indigo-100 text-indigo-700' },
  website: { text: 'Web', color: 'bg-sky-100 text-sky-700' },
  customs: { text: '海关', color: 'bg-amber-100 text-amber-700' },
  referral: { text: '推荐', color: 'bg-green-100 text-green-700' },
  test_batch: { text: '测试', color: 'bg-gray-100 text-gray-500' },
};

export default async function DealsPage() {
  await requireAuth();
  const profile = await getCurrentProfile();
  const role = profile?.role || '';

  if (role !== '销售' && role !== '管理员') {
    redirect('/login');
  }

  const supabase = await createClient();

  // Fetch all deals
  const { data: dealsData } = await supabase
    .from('growth_deals')
    .select('*')
    .order('created_at', { ascending: false });

  const deals = (dealsData || []) as GrowthDeal[];

  // Fetch source leads for lead source + last_action_at
  const leadIds = [...new Set(deals.map((d) => d.lead_id).filter(Boolean))] as string[];
  let leadMap = new Map<string, GrowthLead>();
  if (leadIds.length > 0) {
    const { data: leadsData } = await supabase
      .from('growth_leads')
      .select('id, source, last_action_at, company_name')
      .in('id', leadIds);
    (leadsData || []).forEach((l: any) => leadMap.set(l.id, l as GrowthLead));
  }

  // Fetch owner names
  const ownerIds = [...new Set(deals.map((d) => d.owner_id).filter(Boolean))] as string[];
  let ownerMap = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: staffData } = await supabase
      .from('profiles')
      .select('user_id, name')
      .in('user_id', ownerIds);
    (staffData || []).forEach((s: any) => ownerMap.set(s.user_id, s.name));
  }

  // Sort: active first → later stage first → newest first
  const sorted = [...deals].sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    const stageDiff = (STAGE_ORDER[a.deal_stage] ?? 9) - (STAGE_ORDER[b.deal_stage] ?? 9);
    if (stageDiff !== 0) return stageDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Metrics
  const activeDeals = deals.filter((d) => d.status === 'active').length;
  const wonDeals = deals.filter((d) => d.status === 'won').length;
  const lostDeals = deals.filter((d) => d.status === 'lost').length;
  const totalValue = deals.reduce((sum, d) => sum + (d.estimated_order_value || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Deals</h1>
          <p className="text-sm text-gray-500 mt-1">商机管理 — 已转化线索的跟进进度</p>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <MetricCard label="进行中" value={activeDeals} color="text-blue-700" border="border-blue-200" />
          <MetricCard label="已赢单" value={wonDeals} color="text-green-700" border="border-green-200" />
          <MetricCard label="已丢单" value={lostDeals} color="text-red-600" border="border-red-200" />
          <MetricCard
            label="预估总值"
            value={totalValue > 0 ? `$${(totalValue / 1000).toFixed(0)}K` : '—'}
            color="text-gray-900"
            border="border-gray-200"
          />
        </div>

        {/* Deals table */}
        {sorted.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">暂无商机。通过线索详情页的"转为商机"创建。</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">客户</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">来源</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">负责人</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">阶段</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">预估金额</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最近动态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sorted.map((deal) => {
                    const lead = deal.lead_id ? leadMap.get(deal.lead_id) : null;
                    const source = lead?.source || null;
                    const src = source ? SOURCE_LABELS[source] || { text: source, color: 'bg-gray-100 text-gray-500' } : null;
                    const owner = deal.owner_id ? ownerMap.get(deal.owner_id) || '—' : '—';
                    const stageColor = STAGE_COLORS[deal.deal_stage] || 'bg-gray-100 text-gray-600';
                    const st = STATUS_COLORS[deal.status] || STATUS_COLORS.active;
                    const lastAction = lead?.last_action_at;
                    const rowClass = deal.status === 'lost' ? 'bg-gray-50 opacity-60' : '';

                    return (
                      <tr key={deal.id} className={rowClass}>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">
                            {deal.customer_name}
                          </div>
                          {deal.lead_id && (
                            <Link
                              href={`/growth/leads/${deal.lead_id}`}
                              className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                            >
                              View Lead
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {src ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${src.color}`}>{src.text}</span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{owner}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stageColor}`}>
                            {deal.deal_stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-gray-700">
                          {deal.estimated_order_value
                            ? `$${deal.estimated_order_value.toLocaleString()}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>
                            {st.text}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(deal.created_at).toLocaleString('zh-CN', {
                            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {lastAction
                            ? new Date(lastAction).toLocaleString('zh-CN', {
                                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <DealActions
                            dealId={deal.id}
                            stage={deal.deal_stage as DealStage}
                            status={deal.status}
                          />
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

function MetricCard({ label, value, color, border }: { label: string; value: number | string; color: string; border: string }) {
  return (
    <div className={`bg-white rounded-lg border p-4 text-center ${border}`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

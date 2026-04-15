import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import GrowthNavbar from '@/components/GrowthNavbar';

export const dynamic = 'force-dynamic';

export default async function ProductIntelPage() {
  await requireAuth();
  const supabase = await createClient();

  // Get latest product intel run
  const { data: latestRun } = await supabase
    .from('discovery_runs')
    .select('metadata, created_at')
    .eq('source', 'product_intel')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const recommendations = (latestRun?.metadata as any)?.recommendations || [];
  const trends = (latestRun?.metadata as any)?.trends || [];
  const lastScan = latestRun?.created_at ? new Date(latestRun.created_at).toLocaleString('zh-CN') : '暂未扫描';

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">新品发现</h1>
            <p className="text-sm text-gray-500 mt-1">AI 扫描全品类趋势，发现供需不平衡的蓝海机会</p>
          </div>
          <div className="text-xs text-gray-400">最近扫描: {lastScan}</div>
        </div>

        {/* Quick scan button */}
        <ScanButton />

        {/* Recommendations */}
        {recommendations.length > 0 ? (
          <div className="space-y-4 mt-6">
            <h2 className="text-sm font-semibold text-gray-900">AI 推荐新品 TOP {recommendations.length}</h2>
            {recommendations.map((rec: any, i: number) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-indigo-600">#{i + 1}</span>
                    <h3 className="text-sm font-semibold text-gray-900">{rec.product}</h3>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded ${
                    rec.opportunity_score >= 80 ? 'bg-green-100 text-green-700' :
                    rec.opportunity_score >= 60 ? 'bg-blue-100 text-blue-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    机会分 {rec.opportunity_score}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-gray-500 mb-1">趋势</div>
                    <div className="text-gray-700">{rec.trend}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">市场规模</div>
                    <div className="text-gray-700">{rec.market_size}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">竞争态势</div>
                    <div className="text-gray-700">{rec.competition}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">我们的优势</div>
                    <div className="text-gray-700">{rec.our_advantage}</div>
                  </div>
                </div>

                <div className="mt-3 bg-green-50 rounded p-3 text-xs">
                  <div className="font-medium text-green-800 mb-1">利润分析</div>
                  <div className="text-green-700">{rec.estimated_profit}</div>
                </div>

                <div className="mt-3 bg-indigo-50 rounded p-3 text-xs">
                  <div className="font-medium text-indigo-800 mb-1">建议</div>
                  <div className="text-indigo-700">{rec.recommendation}</div>
                </div>

                {rec.action_items?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-700 mb-1">行动计划</div>
                    <ul className="text-xs text-gray-600 space-y-1">
                      {rec.action_items.map((item: string, j: number) => (
                        <li key={j} className="flex gap-1"><span className="text-indigo-500">→</span> {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center mt-6">
            <p className="text-gray-400 text-sm">暂无新品推荐数据</p>
            <p className="text-gray-400 text-xs mt-1">点击上方「立即扫描」按钮开始分析产品趋势</p>
          </div>
        )}

        {/* Trend data */}
        {trends.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">趋势数据</h2>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">品类</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">趋势</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">变化</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">竞争</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">零售价</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">FOB估算</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">供需</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">机会分</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trends.map((t: any, i: number) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-xs font-medium text-gray-900">{t.category}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className={t.trend_direction === 'rising' ? 'text-green-600' : t.trend_direction === 'declining' ? 'text-red-600' : 'text-gray-500'}>
                          {t.trend_direction === 'rising' ? '↑上升' : t.trend_direction === 'declining' ? '↓下降' : '→平稳'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={t.search_volume_change > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
                          {t.search_volume_change > 0 ? '+' : ''}{t.search_volume_change}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{t.competition_level}</td>
                      <td className="px-3 py-2 text-xs">{t.avg_retail_price || '—'}</td>
                      <td className="px-3 py-2 text-xs">{t.estimated_fob || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className={t.supply_demand_gap === 'undersupply' ? 'text-green-600 font-medium' : 'text-gray-500'}>
                          {t.supply_demand_gap === 'undersupply' ? '供不应求' : t.supply_demand_gap === 'oversupply' ? '供过于求' : '平衡'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-bold">{t.opportunity_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ScanButton() {
  'use client';
  return <ScanButtonClient />;
}

function ScanButtonClient() {
  return (
    <form action={async () => {
      'use server';
      // Trigger scan
      try {
        await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://order-growth-os.vercel.app'}/api/cron/product-intel`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
        });
      } catch {}
    }}>
      <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-medium">
        立即扫描全品类趋势
      </button>
    </form>
  );
}

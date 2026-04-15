import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import GrowthNavbar from '@/components/GrowthNavbar';

export const dynamic = 'force-dynamic';

export default async function ProductIntelPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: latestRun } = await supabase
    .from('discovery_runs')
    .select('metadata, created_at')
    .eq('source', 'product_intel')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const meta = (latestRun?.metadata || {}) as any;
  const recommendations = meta.recommendations || [];
  const crowdfund = meta.crowdfund_brands || [];
  const tiktok = meta.tiktok_opportunities || [];
  const gaps = meta.supply_gaps || [];
  const fabrics = meta.fabric_trends || [];
  const lastScan = latestRun?.created_at ? new Date(latestRun.created_at).toLocaleString('zh-CN') : '暂未扫描';

  const totalSignals = crowdfund.length + tiktok.length + gaps.length + fabrics.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">新品发现</h1>
            <p className="text-sm text-gray-500 mt-1">5个渠道实时扫描市场机会，找到供需不平衡的蓝海产品</p>
          </div>
          <div className="text-xs text-gray-400">最近扫描: {lastScan}</div>
        </div>

        {/* Signal summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <Card label="众筹新品牌" value={crowdfund.length} desc="急需工厂" color="text-purple-600" border="border-purple-200" />
          <Card label="TikTok 爆款" value={tiktok.length} desc="供应不足" color="text-pink-600" border="border-pink-200" />
          <Card label="供给缺口" value={gaps.length} desc="竞品断货" color="text-red-600" border="border-red-200" />
          <Card label="面料趋势" value={fabrics.length} desc="新技术" color="text-blue-600" border="border-blue-200" />
          <Card label="AI 推荐" value={recommendations.length} desc="可执行方案" color="text-green-600" border="border-green-200" />
        </div>

        {/* AI Recommendations */}
        {recommendations.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">AI 新品推荐（基于真实市场数据）</h2>
            <div className="space-y-4">
              {recommendations.map((rec: any, i: number) => (
                <div key={i} className="bg-white rounded-lg border border-gray-200 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-sm font-bold px-2 py-1 rounded ${
                      (rec.confidence || 0) >= 80 ? 'bg-green-100 text-green-700' :
                      (rec.confidence || 0) >= 60 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                    }`}>{rec.confidence || 0}分</span>
                    <h3 className="text-sm font-semibold text-gray-900">{rec.product_name}</h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mb-3">
                    <div className="bg-indigo-50 rounded p-3">
                      <div className="font-medium text-indigo-800 mb-1">为什么现在做</div>
                      <div className="text-indigo-700">{rec.why_now}</div>
                    </div>
                    <div className="bg-green-50 rounded p-3">
                      <div className="font-medium text-green-800 mb-1">定价策略</div>
                      <div className="text-green-700">{rec.pricing}</div>
                    </div>
                    <div className="bg-blue-50 rounded p-3">
                      <div className="font-medium text-blue-800 mb-1">目标客户</div>
                      <div className="text-blue-700">{rec.target_customer}</div>
                    </div>
                    <div className="bg-amber-50 rounded p-3">
                      <div className="font-medium text-amber-800 mb-1">第一步怎么做</div>
                      <div className="text-amber-700">{rec.first_step}</div>
                    </div>
                  </div>

                  {rec.risk && (
                    <div className="text-xs text-red-600 bg-red-50 rounded p-2">
                      ⚠️ 风险: {rec.risk}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw intelligence */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Crowdfund brands */}
          {crowdfund.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-purple-800 mb-3">众筹成功的新品牌</h2>
              <p className="text-xs text-gray-500 mb-3">这些品牌已验证市场需求，正在找工厂量产</p>
              <div className="space-y-2">
                {crowdfund.slice(0, 5).map((b: any, i: number) => (
                  <a key={i} href={b.url} target="_blank" rel="noopener noreferrer" className="block border rounded p-2 hover:bg-purple-50">
                    <div className="text-xs font-medium text-gray-900">{b.name}</div>
                    <div className="text-xs text-gray-500">{b.platform} · {b.category} {b.funded_amount && `· ${b.funded_amount}`}</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* TikTok opportunities */}
          {tiktok.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-pink-800 mb-3">TikTok 爆款信号</h2>
              <p className="text-xs text-gray-500 mb-3">TikTok上卖爆但供应不足的产品</p>
              <div className="space-y-2">
                {tiktok.slice(0, 5).map((t: any, i: number) => (
                  <div key={i} className="border rounded p-2">
                    <span className="text-xs font-medium text-pink-700 bg-pink-50 px-1.5 py-0.5 rounded">{t.product}</span>
                    <div className="text-xs text-gray-500 mt-1">{t.tiktok_signal}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Supply gaps */}
          {gaps.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-red-800 mb-3">供给缺口</h2>
              <p className="text-xs text-gray-500 mb-3">竞品缺货/涨价 = 我们的机会</p>
              <div className="space-y-2">
                {gaps.slice(0, 5).map((g: any, i: number) => (
                  <div key={i} className="border rounded p-2">
                    <div className="text-xs font-medium text-gray-900">{g.product}</div>
                    <div className="text-xs text-gray-500 mt-1">{g.evidence}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fabric trends */}
          {fabrics.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-blue-800 mb-3">面料/技术趋势</h2>
              <p className="text-xs text-gray-500 mb-3">新面料被追捧 → 我们提前备面料抢先机</p>
              <div className="space-y-2">
                {fabrics.slice(0, 5).map((f: any, i: number) => (
                  <div key={i} className="border rounded p-2">
                    <span className="text-xs font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{f.fabric}</span>
                    <div className="text-xs text-gray-500 mt-1">{f.evidence}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {totalSignals === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-400 text-sm">暂无市场情报数据</p>
            <p className="text-gray-400 text-xs mt-1">系统每天早上6点自动扫描，或等待手动触发</p>
          </div>
        )}
      </main>
    </div>
  );
}

function Card({ label, value, desc, color, border }: { label: string; value: number; desc: string; color: string; border: string }) {
  return (
    <div className={`bg-white rounded-lg p-3 border ${border} text-center`}>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-700 font-medium">{label}</div>
      <div className="text-xs text-gray-400">{desc}</div>
    </div>
  );
}

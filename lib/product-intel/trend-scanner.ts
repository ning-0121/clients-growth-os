/**
 * Product Intelligence Engine V2 — 真正的选品引擎
 *
 * 不是泛泛看趋势，而是回答4个具体问题:
 * 1. 哪些品牌刚融资/众筹成功，急需工厂？→ 主动找他们
 * 2. 哪些品类 TikTok 卖爆但供应不足？→ 我们自己做或找这些卖家
 * 3. 哪些竞品在涨价/缺货？→ 供给不足，我们能填补
 * 4. 哪些面料/技术正在被追捧？→ 提前备面料抢先机
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { analyzeStructured } from '@/lib/ai/ai-service';
import { enqueueUrls } from '@/lib/scrapers/source-queue';

// ══════════════════════════════════════
// Channel 1: 众筹新品牌发现
// Kickstarter/Indiegogo 成功的服装品牌 = 已验证需求 + 急需工厂量产
// ══════════════════════════════════════

export interface CrowdfundBrand {
  name: string;
  url: string;
  platform: string;
  category: string;
  funded_amount: string;
  description: string;
  why_opportunity: string;
}

async function discoverCrowdfundBrands(apiKey: string): Promise<CrowdfundBrand[]> {
  const brands: CrowdfundBrand[] = [];

  const queries = [
    'site:kickstarter.com activewear OR sportswear OR athletic clothing funded 2025 2026',
    'site:kickstarter.com sustainable clothing brand funded successfully',
    'site:indiegogo.com fitness apparel OR yoga wear OR gym clothing funded',
    'kickstarter successful clothing brand "looking for manufacturer" OR "made in" OR "production"',
    '"just launched" apparel brand seed funding 2025 2026',
    '"raised" "$" clothing brand startup activewear sportswear 2025 2026',
  ];

  const idx = new Date().getHours() % queries.length;
  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(queries[idx])}&num=10&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return brands;
    const data = await res.json();

    for (const r of (data.organic_results || []).slice(0, 8)) {
      const isKickstarter = r.link?.includes('kickstarter.com');
      const isIndiegogo = r.link?.includes('indiegogo.com');
      const snippet = (r.snippet || '').toLowerCase();

      // Extract funding amount
      const fundedMatch = (r.snippet || '').match(/\$[\d,]+(?:\.\d+)?(?:\s*(?:k|K|M|million|thousand))?/);

      brands.push({
        name: r.title?.replace(/ - Kickstarter| \| Indiegogo/g, '').slice(0, 60) || '',
        url: r.link || '',
        platform: isKickstarter ? 'Kickstarter' : isIndiegogo ? 'Indiegogo' : 'Other',
        category: snippet.includes('yoga') ? 'yoga' : snippet.includes('running') ? 'running' :
          snippet.includes('gym') ? 'gym' : snippet.includes('sustainable') ? 'sustainable' : 'activewear',
        funded_amount: fundedMatch?.[0] || '',
        description: (r.snippet || '').slice(0, 200),
        why_opportunity: '众筹成功 = 已验证市场需求，品牌方急需找工厂量产',
      });
    }
  } catch {}

  return brands;
}

// ══════════════════════════════════════
// Channel 2: TikTok 爆款但 Amazon 供应不足
// TikTok 卖爆 → Amazon 搜索量暴增 → 但供应商没跟上
// ══════════════════════════════════════

export interface TikTokOpportunity {
  product: string;
  tiktok_signal: string;
  amazon_gap: string;
  our_action: string;
}

async function discoverTikTokGaps(apiKey: string): Promise<TikTokOpportunity[]> {
  const opportunities: TikTokOpportunity[] = [];

  const queries = [
    '"tiktok made me buy" clothing OR activewear OR leggings 2025 2026',
    'tiktok viral product clothing apparel trending now',
    'tiktok shop best seller clothing activewear this week',
    '"sold out" clothing tiktok viral restocking',
  ];

  const idx = new Date().getDate() % queries.length;
  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(queries[idx])}&num=8&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return opportunities;
    const data = await res.json();

    for (const r of (data.organic_results || []).slice(0, 6)) {
      const snippet = (r.snippet || '');
      // Extract product mentions
      const productMatch = snippet.match(/(?:leggings|shorts|sports bra|hoodie|jacket|tank top|joggers|crop top|bodysuit|set|dress|skirt|sweatpants|compression|yoga pants)/i);

      if (productMatch) {
        opportunities.push({
          product: productMatch[0],
          tiktok_signal: snippet.slice(0, 150),
          amazon_gap: '需要进一步验证Amazon上该产品的供应量和评分',
          our_action: `TikTok爆款 → 我们可以快速打样 → 找到这些TikTok卖家合作`,
        });
      }
    }
  } catch {}

  return opportunities;
}

// ══════════════════════════════════════
// Channel 3: 竞品涨价/缺货监控
// 竞品涨价或缺货 = 供给不足 = 我们的机会
// ══════════════════════════════════════

export interface SupplyGap {
  product: string;
  signal: string;
  evidence: string;
  action: string;
}

async function detectSupplyGaps(apiKey: string): Promise<SupplyGap[]> {
  const gaps: SupplyGap[] = [];

  const queries = [
    '"out of stock" activewear OR sportswear OR yoga Amazon 2025 2026',
    '"price increase" athletic clothing apparel wholesale 2025',
    '"supply chain" disruption activewear sportswear clothing 2025 2026',
    '"long lead time" clothing manufacturer apparel "weeks" OR "months"',
    '"MOQ too high" clothing manufacturer small brand',
  ];

  const idx = new Date().getDate() % queries.length;
  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(queries[idx])}&num=5&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return gaps;
    const data = await res.json();

    for (const r of (data.organic_results || []).slice(0, 4)) {
      gaps.push({
        product: r.title?.slice(0, 60) || '',
        signal: r.link?.includes('reddit') ? 'Reddit讨论' : r.link?.includes('amazon') ? 'Amazon信号' : '行业新闻',
        evidence: (r.snippet || '').slice(0, 200),
        action: '竞品供给出问题 → 我们能快速补位',
      });
    }
  } catch {}

  return gaps;
}

// ══════════════════════════════════════
// Channel 4: 面料/技术趋势
// 新面料被追捧 → 我们提前备面料 → 抢客户
// ══════════════════════════════════════

export interface FabricTrend {
  fabric: string;
  trend_signal: string;
  evidence: string;
  our_capability: string;
}

async function detectFabricTrends(apiKey: string): Promise<FabricTrend[]> {
  const trends: FabricTrend[] = [];

  const queries = [
    'trending fabric technology activewear 2025 2026 new material',
    '"recycled" OR "sustainable" fabric clothing brand demand growing 2025',
    'new activewear fabric technology moisture wicking cooling 2025 2026',
    '"graphene" OR "bamboo" OR "merino" OR "tencel" activewear trending',
    '"anti-odor" OR "UV protection" OR "infrared" fabric clothing trend',
  ];

  const idx = new Date().getDate() % queries.length;
  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(queries[idx])}&num=5&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return trends;
    const data = await res.json();

    for (const r of (data.organic_results || []).slice(0, 4)) {
      const snippet = (r.snippet || '').toLowerCase();
      const fabricMatch = snippet.match(/(?:recycled|sustainable|bamboo|tencel|merino|graphene|cooling|infrared|anti-odor|moisture.wicking|UV.protection|organic cotton|hemp|nylon|spandex|compression|seamless)/i);

      if (fabricMatch) {
        trends.push({
          fabric: fabricMatch[0],
          trend_signal: r.title?.slice(0, 80) || '',
          evidence: (r.snippet || '').slice(0, 200),
          our_capability: '我们面料合作工厂可以打样，2周出面料样',
        });
      }
    }
  } catch {}

  return trends;
}

// ══════════════════════════════════════
// Channel 5: 新融资品牌发现
// 刚拿到融资的服装品牌 → 有钱 + 要扩产 = 好客户
// ══════════════════════════════════════

async function discoverFundedBrands(apiKey: string, supabase: SupabaseClient): Promise<number> {
  let enqueued = 0;

  const queries = [
    '"seed round" OR "series A" clothing brand activewear 2025 2026',
    '"raised" "million" apparel brand DTC fashion 2025 2026',
    'new funding athletic wear sportswear brand startup 2025',
    '"just raised" fashion brand clothing startup',
  ];

  const idx = new Date().getDate() % queries.length;
  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(queries[idx])}&num=8&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return 0;
    const data = await res.json();

    const urls: { url: string; source: string; priority: number; data: any }[] = [];
    for (const r of (data.organic_results || []).slice(0, 6)) {
      if (r.link && !r.link.includes('crunchbase.com') && !r.link.includes('techcrunch.com')) {
        urls.push({
          url: r.link,
          source: 'google',
          priority: 15, // Very high priority — funded brands are hot leads
          data: { from_funding_search: true, snippet: r.snippet?.slice(0, 150) },
        });
      }
    }

    if (urls.length > 0) {
      const { queued } = await enqueueUrls(urls, supabase);
      enqueued = queued;
    }
  } catch {}

  return enqueued;
}

// ══════════════════════════════════════
// AI 综合分析: 4个渠道数据 → 具体可执行的新品建议
// ══════════════════════════════════════

export interface ProductIntelReport {
  crowdfund_brands: CrowdfundBrand[];
  tiktok_opportunities: TikTokOpportunity[];
  supply_gaps: SupplyGap[];
  fabric_trends: FabricTrend[];
  funded_brands_enqueued: number;
  ai_recommendations: any[];
}

async function generateActionableRecommendations(
  report: Omit<ProductIntelReport, 'ai_recommendations'>
): Promise<any[]> {
  const hasData = report.crowdfund_brands.length > 0 ||
    report.tiktok_opportunities.length > 0 ||
    report.supply_gaps.length > 0 ||
    report.fabric_trends.length > 0;

  if (!hasData) return [];

  const prompt = `你是一个在服装OEM行业干了20年的**产品开发总监**，同时精通跨境电商。

你的工厂能力:
- 针织: T恤($3.5-6 FOB), 卫衣($8-14), 运动裤($6-10), 压缩衣($6-10), 瑜伽裤($5-8)
- 梭织: 外套($12-22), 衬衫($5-8), 裤子($6-10)
- 面料: 四面弹、吸湿排汗、回收涤纶、竹纤维、有机棉、seamless
- MOQ: 300-500件（首单200件可谈）
- 交期: 30-45天

以下是今天扫描到的市场情报:

**众筹成功的新品牌（急需工厂）:**
${report.crowdfund_brands.slice(0, 5).map(b => `- ${b.name} (${b.platform}): ${b.description}`).join('\n') || '暂无数据'}

**TikTok爆款信号:**
${report.tiktok_opportunities.slice(0, 5).map(t => `- ${t.product}: ${t.tiktok_signal}`).join('\n') || '暂无数据'}

**供给缺口信号:**
${report.supply_gaps.slice(0, 5).map(g => `- ${g.product}: ${g.evidence}`).join('\n') || '暂无数据'}

**面料/技术趋势:**
${report.fabric_trends.slice(0, 5).map(f => `- ${f.fabric}: ${f.evidence}`).join('\n') || '暂无数据'}

请基于以上真实数据，给出 3-5 个**具体可执行**的新品/新战线建议。

每个建议必须包含:
1. **具体产品**（不要说"运动服"，要说"高腰侧口袋瑜伽裤，Nylon/Spandex 80/20"这种精确度）
2. **为什么现在做**（引用上面的哪条数据支撑这个判断）
3. **目标客户**（谁会买？DTC品牌？Amazon卖家？线下零售？）
4. **定价策略**（FOB多少 → 零售多少 → 利润空间多少）
5. **第一步怎么做**（打样？找面料？找客户？上平台？具体动作）
6. **风险提醒**（可能踩什么坑）

全中文。JSON数组格式（不要markdown）:
[
  {
    "product_name": "具体产品名+面料规格",
    "why_now": "为什么现在做（引用数据）",
    "target_customer": "目标客户描述",
    "pricing": "FOB $X → 零售 $Y → 利润 Z%",
    "first_step": "具体第一步动作",
    "risk": "风险提醒",
    "confidence": 85
  }
]`;

  try {
    return await analyzeStructured<any[]>(
      prompt,
      'product_recommendation_v2',
      (data) => {
        if (!Array.isArray(data)) throw new Error('Not array');
        return data.slice(0, 5);
      }
    );
  } catch {
    return [];
  }
}

// ══════════════════════════════════════
// Master: 运行完整产品情报扫描
// ══════════════════════════════════════

export async function runFullProductScan(
  supabase: SupabaseClient
): Promise<{
  trends_scanned: number;
  opportunities_found: number;
  top_recommendations: any[];
}> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { trends_scanned: 0, opportunities_found: 0, top_recommendations: [] };

  // Run 2 channels per day (rotate) to stay within 60s timeout
  // Day 1: crowdfund + tiktok
  // Day 2: gaps + fabrics
  // Day 3: funded + crowdfund
  // ...rotates
  const dayOfWeek = new Date().getDay();
  const channelPairs = [
    [0, 1], // Sun: crowdfund + tiktok
    [2, 3], // Mon: gaps + fabrics
    [4, 0], // Tue: funded + crowdfund
    [1, 2], // Wed: tiktok + gaps
    [3, 4], // Thu: fabrics + funded
    [0, 2], // Fri: crowdfund + gaps
    [1, 3], // Sat: tiktok + fabrics
  ];
  const todayChannels = channelPairs[dayOfWeek];

  const channelFns = [
    () => discoverCrowdfundBrands(apiKey),
    () => discoverTikTokGaps(apiKey),
    () => detectSupplyGaps(apiKey),
    () => detectFabricTrends(apiKey),
    () => discoverFundedBrands(apiKey, supabase),
  ];

  const results = await Promise.allSettled(
    todayChannels.map(idx => channelFns[idx]())
  );

  // Map results back
  const channelNames = ['crowdfund', 'tiktok', 'gaps', 'fabrics', 'funded'];
  const emptyArrays = [[], [], [], [], 0];

  const channelResults: any[] = [[], [], [], [], 0];
  todayChannels.forEach((chIdx, i) => {
    channelResults[chIdx] = results[i].status === 'fulfilled' ? results[i].value : emptyArrays[chIdx];
  });

  const [crowdfund, tiktok, gaps, fabrics, funded] = channelResults as [CrowdfundBrand[], TikTokOpportunity[], SupplyGap[], FabricTrend[], number];

  const report: Omit<ProductIntelReport, 'ai_recommendations'> = {
    crowdfund_brands: Array.isArray(crowdfund) ? crowdfund : [],
    tiktok_opportunities: Array.isArray(tiktok) ? tiktok : [],
    supply_gaps: Array.isArray(gaps) ? gaps : [],
    fabric_trends: Array.isArray(fabrics) ? fabrics : [],
    funded_brands_enqueued: typeof funded === 'number' ? funded : 0,
  };

  // AI analyze all data and generate recommendations
  const recommendations = await generateActionableRecommendations(report);

  const totalSignals = report.crowdfund_brands.length + report.tiktok_opportunities.length +
    report.supply_gaps.length + report.fabric_trends.length;

  // Store
  await supabase.from('discovery_runs').insert({
    source: 'product_intel',
    query_used: 'crowdfund+tiktok+supply_gaps+fabric+funding',
    urls_found: totalSignals,
    urls_new: recommendations.length,
    metadata: { ...report, recommendations },
  });

  return {
    trends_scanned: totalSignals,
    opportunities_found: recommendations.length,
    top_recommendations: recommendations,
  };
}

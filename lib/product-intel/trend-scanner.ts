/**
 * Product Trend Scanner — 全品类新品发现引擎
 *
 * 不限于 activewear，扫描所有产品品类寻找:
 * 1. 搜索量上升的品类（Google Trends）
 * 2. 销量暴涨的产品（Amazon BSR变化）
 * 3. 供需不平衡的产品（需求大但供应商少）
 * 4. 高利润空间的品类
 * 5. 新兴品类/蓝海市场
 *
 * 数据来源: Google Trends + Amazon + Shopify + Alibaba + TikTok
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { analyzeStructured } from '@/lib/ai/ai-service';

// ── 全品类监控列表 ──
// 不只是运动服，覆盖我们能做的所有品类
const PRODUCT_CATEGORIES = {
  // 核心品类（我们已经做的）
  core: [
    'activewear', 'sportswear', 'yoga pants', 'compression leggings',
    'gym shorts', 'sports bra', 'performance t-shirt', 'hoodie',
    'track pants', 'athletic jacket',
  ],
  // 扩展品类（可以做的）
  expandable: [
    'loungewear', 'sleepwear pajamas', 'streetwear', 'workwear',
    'scrubs medical uniform', 'school uniform', 'polo shirt',
    'cargo pants', 'jogger pants', 'sweatpants', 'tank top',
    'crop top', 'bodysuit', 'romper jumpsuit', 'dress',
    'denim jacket', 'puffer jacket', 'windbreaker', 'rain jacket',
    'swimwear bikini', 'rash guard', 'board shorts',
    'hiking pants', 'cycling shorts', 'running shorts',
    'tennis skirt', 'golf polo', 'ski base layer',
  ],
  // 新兴品类（可能有机会的）
  emerging: [
    'modest activewear hijab', 'maternity activewear', 'plus size activewear',
    'kids activewear', 'pet matching activewear', 'adaptive clothing',
    'cooling clothing', 'heated clothing', 'UV protection clothing',
    'anti-odor clothing', 'bamboo fabric clothing', 'hemp clothing',
    'mushroom leather', 'recycled ocean plastic clothing',
    'smart clothing wearable', 'posture correcting shirt',
  ],
  // 配件（利润高）
  accessories: [
    'gym bag', 'yoga mat bag', 'sports headband', 'sweatband',
    'compression socks', 'athletic socks', 'sports gloves',
    'waist trainer', 'resistance bands', 'jump rope',
  ],
};

const ALL_CATEGORIES = [
  ...PRODUCT_CATEGORIES.core,
  ...PRODUCT_CATEGORIES.expandable,
  ...PRODUCT_CATEGORIES.emerging,
  ...PRODUCT_CATEGORIES.accessories,
];

export interface TrendData {
  category: string;
  trend_direction: 'rising' | 'stable' | 'declining';
  search_volume_change: number; // percentage change
  competition_level: 'low' | 'medium' | 'high';
  avg_retail_price: string;
  estimated_fob: string;
  profit_margin_estimate: string;
  supply_demand_gap: 'oversupply' | 'balanced' | 'undersupply';
  opportunity_score: number; // 0-100
  evidence: string[];
  source: string;
}

export interface ProductOpportunity {
  product: string;
  opportunity_score: number;
  trend: string;
  market_size: string;
  competition: string;
  our_advantage: string;
  estimated_profit: string;
  recommendation: string;
  action_items: string[];
}

// ══════════════════════════════════════
// Scanner 1: Google Trends — 搜索趋势变化
// ══════════════════════════════════════

export async function scanGoogleTrends(
  categories: string[] = ALL_CATEGORIES.slice(0, 10)
): Promise<TrendData[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  const trends: TrendData[] = [];

  for (const cat of categories) {
    try {
      // Use SerpAPI Google Trends
      const url = `https://serpapi.com/search.json?api_key=${apiKey}&engine=google_trends&q=${encodeURIComponent(cat)}&date=today+3-m&geo=US`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();

      // Analyze interest over time
      const timeline = data.interest_over_time?.timeline_data || [];
      if (timeline.length >= 2) {
        const recent = timeline.slice(-4); // Last month
        const earlier = timeline.slice(0, 4); // First month

        const recentAvg = recent.reduce((s: number, t: any) => s + (t.values?.[0]?.extracted_value || 0), 0) / recent.length;
        const earlierAvg = earlier.reduce((s: number, t: any) => s + (t.values?.[0]?.extracted_value || 0), 0) / earlier.length;

        const change = earlierAvg > 0 ? Math.round(((recentAvg - earlierAvg) / earlierAvg) * 100) : 0;
        const direction = change > 15 ? 'rising' : change < -15 ? 'declining' : 'stable';

        trends.push({
          category: cat,
          trend_direction: direction,
          search_volume_change: change,
          competition_level: 'medium', // Will be refined by Amazon/Alibaba data
          avg_retail_price: '',
          estimated_fob: '',
          profit_margin_estimate: '',
          supply_demand_gap: direction === 'rising' ? 'undersupply' : 'balanced',
          opportunity_score: Math.max(0, Math.min(100, 50 + change)),
          evidence: [`Google Trends: ${change > 0 ? '+' : ''}${change}% in 3 months`],
          source: 'google_trends',
        });
      }

      await new Promise(r => setTimeout(r, 500));
    } catch {}
  }

  return trends.sort((a, b) => b.opportunity_score - a.opportunity_score);
}

// ══════════════════════════════════════
// Scanner 2: Amazon 爆款 + 价格分析
// ══════════════════════════════════════

export async function scanAmazonTrends(
  categories: string[] = ['activewear', 'yoga pants', 'gym shorts', 'sports bra', 'loungewear']
): Promise<TrendData[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  const trends: TrendData[] = [];

  for (const cat of categories) {
    try {
      const url = `https://serpapi.com/search.json?api_key=${apiKey}&engine=amazon&amazon_domain=amazon.com&k=${encodeURIComponent(cat)}&s=review-rank`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();

      const results = data.organic_results || [];
      if (results.length === 0) continue;

      // Analyze prices
      const prices = results
        .map((r: any) => {
          const price = r.price?.raw || r.price?.value;
          if (!price) return null;
          const num = parseFloat(String(price).replace(/[^0-9.]/g, ''));
          return isNaN(num) ? null : num;
        })
        .filter(Boolean) as number[];

      const avgPrice = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

      // Analyze reviews (high reviews + high rating = validated demand)
      const highRatedCount = results.filter((r: any) => (r.rating || 0) >= 4.0).length;

      // Estimate FOB based on retail price
      const estimatedFOB = avgPrice > 0 ? (avgPrice * 0.15).toFixed(2) : ''; // ~15% of retail
      const profitMargin = avgPrice > 0 ? `${Math.round((1 - 0.15 / 0.4) * 100)}%` : ''; // Rough estimate

      trends.push({
        category: cat,
        trend_direction: highRatedCount > 5 ? 'rising' : 'stable',
        search_volume_change: 0,
        competition_level: results.length >= 20 ? 'high' : results.length >= 10 ? 'medium' : 'low',
        avg_retail_price: avgPrice > 0 ? `$${avgPrice.toFixed(2)}` : '',
        estimated_fob: estimatedFOB ? `$${estimatedFOB}` : '',
        profit_margin_estimate: profitMargin,
        supply_demand_gap: highRatedCount > 5 && results.length < 15 ? 'undersupply' : 'balanced',
        opportunity_score: Math.min(100, Math.round(highRatedCount * 8 + (30 - results.length))),
        evidence: [
          `Amazon: ${results.length} results, avg $${avgPrice.toFixed(2)}, ${highRatedCount} with 4+ stars`,
          `Price range: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`,
          `Est. FOB: $${estimatedFOB}, margin potential: ${profitMargin}`,
        ],
        source: 'amazon',
      });

      await new Promise(r => setTimeout(r, 500));
    } catch {}
  }

  return trends;
}

// ══════════════════════════════════════
// Scanner 3: Shopify 竞品产品+定价分析
// ══════════════════════════════════════

export async function scanShopifyCompetitors(
  storeUrls: string[]
): Promise<{ store: string; products: { title: string; price: number; type: string }[] }[]> {
  const results: { store: string; products: { title: string; price: number; type: string }[] }[] = [];

  for (const storeUrl of storeUrls.slice(0, 5)) {
    try {
      const url = `${storeUrl.replace(/\/$/, '')}/products.json?limit=30`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();

      const products = (data.products || []).map((p: any) => ({
        title: p.title || '',
        price: parseFloat(p.variants?.[0]?.price || '0'),
        type: p.product_type || '',
      }));

      results.push({ store: storeUrl, products });
    } catch {}
  }

  return results;
}

// ══════════════════════════════════════
// Scanner 4: Alibaba 供给端分析
// ══════════════════════════════════════

export async function scanAlibabaSupply(
  keyword: string
): Promise<{ suppliers: number; min_price: string; moq: string }> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { suppliers: 0, min_price: '', moq: '' };

  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(keyword)}&engine=google&num=3`;
    // Note: Alibaba doesn't have direct SerpAPI engine, use Google site: search
    const searchUrl = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent('site:alibaba.com ' + keyword + ' manufacturer')}&num=5&engine=google`;
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { suppliers: 0, min_price: '', moq: '' };
    const data = await res.json();

    const results = data.organic_results || [];
    // Extract price/MOQ from snippets
    let minPrice = '';
    let moq = '';
    for (const r of results) {
      const snippet = r.snippet || '';
      const priceMatch = snippet.match(/\$[\d.]+/);
      if (priceMatch && !minPrice) minPrice = priceMatch[0];
      const moqMatch = snippet.match(/(\d+)\s*(?:pieces|pcs|units)/i);
      if (moqMatch && !moq) moq = moqMatch[0];
    }

    return { suppliers: results.length, min_price: minPrice, moq };
  } catch {
    return { suppliers: 0, min_price: '', moq: '' };
  }
}

// ══════════════════════════════════════
// Master: AI 综合分析 + 新品推荐
// ══════════════════════════════════════

export async function generateProductRecommendations(
  trends: TrendData[]
): Promise<ProductOpportunity[]> {
  // Use all trends for analysis (even low-scoring ones have value for comparison)
  const topTrends = trends
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 15);

  if (topTrends.length === 0) return [];

  const trendSummary = topTrends.map(t =>
    `${t.category}: score=${t.opportunity_score}, trend=${t.trend_direction}, change=${t.search_volume_change}%, competition=${t.competition_level}, price=${t.avg_retail_price}, gap=${t.supply_demand_gap}`
  ).join('\n');

  try {
    const prompt = `你是一个服装行业产品开发总监，同时也是跨境电商专家。

我们是中国服装OEM/ODM工厂，能做:
- 针织: T恤、卫衣、运动服、瑜伽裤、压缩衣
- 梭织: 外套、裤子、衬衫、裙子
- 面料能力: 四面弹、吸湿排汗、回收涤纶、竹纤维、有机棉
- MOQ: 300-500件，首单可谈200件
- FOB价格: T恤$3.5-6, 卫衣$8-14, 裤子$6-10, 外套$12-22

以下是我们扫描到的产品趋势数据:
${trendSummary}

请分析并推荐 TOP 5 新品机会。对每个机会给出:
1. 产品名称和具体描述（不要泛泛说"运动服"，要具体到"高腰口袋瑜伽裤"这种）
2. 为什么现在是机会（供需数据说了什么）
3. 市场规模估算
4. 竞争态势
5. 我们的优势（成本/面料/灵活性）
6. 预估利润率（FOB → 零售价 → 利润）
7. 具体行动建议（开发什么样的产品、定什么价、走什么渠道）

全部用中文输出。

JSON格式（不要markdown）:
[
  {
    "product": "具体产品名",
    "opportunity_score": 85,
    "trend": "上升趋势描述",
    "market_size": "市场规模描述",
    "competition": "竞争态势分析",
    "our_advantage": "我们的优势",
    "estimated_profit": "利润分析（含具体数字）",
    "recommendation": "总体建议",
    "action_items": ["行动1", "行动2", "行动3"]
  }
]`;

    const result = await analyzeStructured<ProductOpportunity[]>(
      prompt,
      'product_recommendation',
      (data) => {
        if (!Array.isArray(data)) throw new Error('Not array');
        return data.slice(0, 5).map((d: any) => ({
          product: String(d.product || ''),
          opportunity_score: Number(d.opportunity_score) || 0,
          trend: String(d.trend || ''),
          market_size: String(d.market_size || ''),
          competition: String(d.competition || ''),
          our_advantage: String(d.our_advantage || ''),
          estimated_profit: String(d.estimated_profit || ''),
          recommendation: String(d.recommendation || ''),
          action_items: Array.isArray(d.action_items) ? d.action_items.map(String) : [],
        }));
      }
    );

    return result;
  } catch {
    return [];
  }
}

// ══════════════════════════════════════
// Full scan: run all scanners + generate recommendations
// ══════════════════════════════════════

export async function runFullProductScan(
  supabase: SupabaseClient
): Promise<{
  trends_scanned: number;
  opportunities_found: number;
  top_recommendations: ProductOpportunity[];
}> {
  // Pick categories for this scan (rotate daily)
  const dayOfMonth = new Date().getDate();
  const coreSlice = PRODUCT_CATEGORIES.core.slice((dayOfMonth * 3) % PRODUCT_CATEGORIES.core.length).slice(0, 3);
  const expandSlice = PRODUCT_CATEGORIES.expandable.slice((dayOfMonth * 2) % PRODUCT_CATEGORIES.expandable.length).slice(0, 3);
  const emergingSlice = PRODUCT_CATEGORIES.emerging.slice((dayOfMonth) % PRODUCT_CATEGORIES.emerging.length).slice(0, 2);
  const accessorySlice = PRODUCT_CATEGORIES.accessories.slice((dayOfMonth) % PRODUCT_CATEGORIES.accessories.length).slice(0, 2);

  const todayCategories = [...coreSlice, ...expandSlice, ...emergingSlice, ...accessorySlice];

  // Run scanners in parallel
  const [googleTrends, amazonTrends] = await Promise.allSettled([
    scanGoogleTrends(todayCategories),
    scanAmazonTrends(todayCategories.slice(0, 5)),
  ]);

  const allTrends: TrendData[] = [
    ...(googleTrends.status === 'fulfilled' ? googleTrends.value : []),
    ...(amazonTrends.status === 'fulfilled' ? amazonTrends.value : []),
  ];

  // Merge trends for same category
  const mergedTrends = mergeTrends(allTrends);

  // Generate AI recommendations
  const recommendations = await generateProductRecommendations(mergedTrends);

  // Store results
  await supabase.from('discovery_runs').insert({
    source: 'product_intel',
    query_used: todayCategories.join(', '),
    urls_found: allTrends.length,
    urls_new: recommendations.length,
    metadata: {
      trends: mergedTrends.slice(0, 15),
      recommendations,
      categories_scanned: todayCategories,
    },
  });

  return {
    trends_scanned: mergedTrends.length,
    opportunities_found: recommendations.length,
    top_recommendations: recommendations,
  };
}

function mergeTrends(trends: TrendData[]): TrendData[] {
  const map = new Map<string, TrendData>();
  for (const t of trends) {
    const existing = map.get(t.category);
    if (!existing) {
      map.set(t.category, t);
    } else {
      // Merge: take the higher opportunity score
      if (t.opportunity_score > existing.opportunity_score) {
        existing.opportunity_score = t.opportunity_score;
      }
      existing.evidence.push(...t.evidence);
      if (t.avg_retail_price && !existing.avg_retail_price) existing.avg_retail_price = t.avg_retail_price;
      if (t.estimated_fob && !existing.estimated_fob) existing.estimated_fob = t.estimated_fob;
      if (t.profit_margin_estimate && !existing.profit_margin_estimate) existing.profit_margin_estimate = t.profit_margin_estimate;
    }
  }
  return [...map.values()].sort((a, b) => b.opportunity_score - a.opportunity_score);
}

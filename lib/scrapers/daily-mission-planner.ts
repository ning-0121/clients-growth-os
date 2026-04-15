import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Daily Mission Planner — 每日搜索任务规划器
 *
 * 核心原则：
 * 1. 每天搜索方向不同（今天美国瑜伽品牌，明天欧洲运动品牌）
 * 2. 绝不重复搜索同一个组合
 * 3. 每天产出精准且新鲜
 * 4. 允许对老客户补充联系方式
 * 5. 30天一个完整周期，覆盖所有组合
 */

// ── 搜索维度定义 ──

const PRODUCT_DIMENSIONS = [
  { id: 'activewear', keywords: ['activewear brand', 'active wear', 'performance wear brand'], weight: 10 },
  { id: 'sportswear', keywords: ['sportswear brand', 'sports clothing brand', 'athletic wear brand'], weight: 9 },
  { id: 'yoga', keywords: ['yoga wear brand', 'yoga clothing', 'yoga pants brand', 'yoga leggings brand'], weight: 8 },
  { id: 'gym', keywords: ['gym clothing brand', 'gym wear', 'workout clothing brand'], weight: 8 },
  { id: 'compression', keywords: ['compression wear brand', 'compression clothing', 'compression leggings'], weight: 7 },
  { id: 'athleisure', keywords: ['athleisure brand', 'athleisure wear', 'casual athletic brand'], weight: 7 },
  { id: 'running', keywords: ['running apparel brand', 'running clothing', 'jogging wear brand'], weight: 6 },
  { id: 'tennis', keywords: ['tennis wear brand', 'tennis clothing', 'tennis apparel'], weight: 5 },
  { id: 'golf', keywords: ['golf wear brand', 'golf apparel', 'golf clothing brand'], weight: 5 },
  { id: 'cycling', keywords: ['cycling jersey brand', 'cycling apparel', 'bike wear brand'], weight: 5 },
  { id: 'outdoor', keywords: ['outdoor sportswear brand', 'hiking clothing brand', 'outdoor athletic'], weight: 5 },
  { id: 'swim', keywords: ['swimwear brand', 'swim clothing', 'beach wear brand'], weight: 4 },
  { id: 'sustainable', keywords: ['sustainable activewear', 'eco sportswear brand', 'recycled athletic wear'], weight: 6 },
  { id: 'plus_size', keywords: ['plus size activewear brand', 'inclusive activewear', 'extended size sportswear'], weight: 4 },
  { id: 'kids', keywords: ['kids activewear brand', 'children sportswear', 'youth athletic brand'], weight: 3 },
];

const MARKET_DIMENSIONS = [
  { id: 'us_east', region: 'USA East Coast', queries: ['New York', 'Florida', 'Georgia', 'North Carolina'] },
  { id: 'us_west', region: 'USA West Coast', queries: ['California', 'Oregon', 'Washington', 'Colorado'] },
  { id: 'us_central', region: 'USA Central', queries: ['Texas', 'Illinois', 'Ohio', 'Minnesota'] },
  { id: 'uk', region: 'United Kingdom', queries: ['UK', 'London', 'Manchester', 'British'] },
  { id: 'germany', region: 'Germany/DACH', queries: ['Germany', 'Berlin', 'Munich', 'Austria', 'Switzerland'] },
  { id: 'france', region: 'France/Benelux', queries: ['France', 'Paris', 'Belgium', 'Netherlands'] },
  { id: 'nordic', region: 'Nordics', queries: ['Sweden', 'Denmark', 'Norway', 'Finland'] },
  { id: 'south_eu', region: 'Southern Europe', queries: ['Italy', 'Spain', 'Portugal', 'Greece'] },
  { id: 'australia', region: 'Australia/NZ', queries: ['Australia', 'Sydney', 'Melbourne', 'New Zealand'] },
  { id: 'canada', region: 'Canada', queries: ['Canada', 'Toronto', 'Vancouver', 'Montreal'] },
  { id: 'japan', region: 'Japan', queries: ['Japan', 'Tokyo', 'Japanese'] },
  { id: 'korea', region: 'South Korea', queries: ['South Korea', 'Seoul', 'Korean'] },
  { id: 'middle_east', region: 'Middle East', queries: ['UAE', 'Dubai', 'Saudi Arabia'] },
  { id: 'southeast_asia', region: 'Southeast Asia', queries: ['Singapore', 'Thailand', 'Indonesia', 'Philippines'] },
  { id: 'latin_america', region: 'Latin America', queries: ['Brazil', 'Mexico', 'Colombia', 'Chile'] },
];

const SCALE_DIMENSIONS = [
  { id: 'startup', modifier: 'new brand startup 2024 2025 2026 launch', desc: '新创品牌（刚起步，MOQ灵活）' },
  { id: 'dtc', modifier: 'DTC direct-to-consumer brand online', desc: 'DTC品牌（线上直销，增长快）' },
  { id: 'boutique', modifier: 'boutique brand premium small batch', desc: '精品品牌（小批量高端）' },
  { id: 'medium', modifier: 'established brand growing', desc: '成长期品牌（已有规模，在扩张）' },
  { id: 'wholesale', modifier: 'wholesale distributor bulk', desc: '批发商（量大，价格敏感）' },
  { id: 'retailer', modifier: 'retailer store chain', desc: '零售商（线下连锁）' },
  { id: 'amazon', modifier: 'amazon seller FBA brand', desc: 'Amazon卖家（电商，注重价格和评价）' },
  { id: 'instagram', modifier: 'instagram brand influencer', desc: 'IG品牌（社媒驱动，视觉导向）' },
];

const CHANNEL_DIMENSIONS = [
  { id: 'google', engine: 'google', prefix: '' },
  { id: 'bing', engine: 'bing', prefix: '' },
  { id: 'ig', engine: 'google', prefix: 'site:instagram.com' },
  { id: 'shopify', engine: 'google', prefix: '"powered by shopify"' },
  { id: 'linkedin', engine: 'google', prefix: 'site:linkedin.com/company' },
];

export interface DailyMission {
  date: string;
  day_of_cycle: number;    // 1-30 in the rotation
  theme: string;           // 今日主题描述
  product_focus: string;   // 今天聚焦的品类
  market_focus: string;    // 今天聚焦的地区
  scale_focus: string;     // 今天聚焦的规模
  queries: { query: string; engine: string; priority: number }[];
  re_enrich_count: number; // 今天要补充联系方式的老客户数
}

/**
 * Generate today's unique search mission.
 * Uses date-based rotation to ensure no two days are the same within a 30-day cycle.
 */
export function planDailyMission(date: Date = new Date()): DailyMission {
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const cycleDay = (dayOfYear % 30) + 1; // 1-30 rotation

  // Select today's focus dimensions using rotation
  const productIdx = cycleDay % PRODUCT_DIMENSIONS.length;
  const product = PRODUCT_DIMENSIONS[productIdx];

  const marketIdx = Math.floor(cycleDay / 2) % MARKET_DIMENSIONS.length;
  const market = MARKET_DIMENSIONS[marketIdx];

  const scaleIdx = Math.floor(cycleDay / 4) % SCALE_DIMENSIONS.length;
  const scale = SCALE_DIMENSIONS[scaleIdx];

  // Channels rotate daily
  const channelIdx = cycleDay % CHANNEL_DIMENSIONS.length;
  const primaryChannel = CHANNEL_DIMENSIONS[channelIdx];
  const secondaryChannel = CHANNEL_DIMENSIONS[(channelIdx + 1) % CHANNEL_DIMENSIONS.length];

  // Build today's search queries — unique combinations
  const queries: { query: string; engine: string; priority: number }[] = [];

  // Primary focus: product × market × scale (high priority)
  for (const kw of product.keywords.slice(0, 2)) {
    for (const region of market.queries.slice(0, 2)) {
      const q = `${primaryChannel.prefix} "${kw}" ${scale.modifier} ${region}`.trim();
      queries.push({ query: q, engine: primaryChannel.engine, priority: 1 });
    }
  }

  // Secondary: product × different market (medium priority)
  const altMarketIdx = (marketIdx + 7) % MARKET_DIMENSIONS.length; // Jump 7 to get different market
  const altMarket = MARKET_DIMENSIONS[altMarketIdx];
  for (const kw of product.keywords.slice(0, 1)) {
    for (const region of altMarket.queries.slice(0, 2)) {
      const q = `${secondaryChannel.prefix} "${kw}" ${region}`.trim();
      queries.push({ query: q, engine: secondaryChannel.engine, priority: 2 });
    }
  }

  // Cross-category: different product × same market (exploration)
  const altProductIdx = (productIdx + 5) % PRODUCT_DIMENSIONS.length;
  const altProduct = PRODUCT_DIMENSIONS[altProductIdx];
  const q = `"${altProduct.keywords[0]}" ${market.queries[0]} brand official`;
  queries.push({ query: q, engine: 'google', priority: 3 });

  // Today's theme description
  const theme = `${product.id}品类 × ${market.region}市场 × ${scale.desc}`;

  return {
    date: date.toISOString().split('T')[0],
    day_of_cycle: cycleDay,
    theme,
    product_focus: product.id,
    market_focus: market.id,
    scale_focus: scale.id,
    queries,
    re_enrich_count: 10, // 每天补充10个老客户的联系方式
  };
}

/**
 * Get leads that need contact info re-enrichment.
 * These are leads we found before but couldn't get email/phone — try again with new methods.
 */
export async function getLeadsForReEnrichment(
  supabase: SupabaseClient,
  limit: number = 10
): Promise<any[]> {
  // Find leads that:
  // 1. Have a website (so we can re-scrape)
  // 2. Don't have an email (the gap we want to fill)
  // 3. Were not re-enriched in the last 7 days
  // 4. Are still active (not disqualified)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: leads } = await supabase
    .from('growth_leads')
    .select('id, company_name, website, contact_name, contact_linkedin')
    .in('status', ['new', 'qualified'])
    .not('website', 'is', null)
    .is('contact_email', null) // No email yet
    .or(`probability_updated_at.is.null,probability_updated_at.lt.${sevenDaysAgo}`)
    .order('deal_probability', { ascending: false }) // Highest probability first
    .limit(limit);

  return leads || [];
}

/**
 * Get queries that were already used recently (to avoid within the same cycle)
 */
export async function getRecentlyUsedQueries(
  supabase: SupabaseClient,
  daysBack: number = 7
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString();

  const { data: runs } = await supabase
    .from('discovery_runs')
    .select('metadata')
    .gte('created_at', cutoff);

  const used = new Set<string>();
  for (const run of (runs || [])) {
    const details = (run.metadata as any)?.details || [];
    for (const d of details) {
      if (d.query) used.add(d.query.toLowerCase().trim());
    }
  }

  return used;
}

/**
 * Filter out queries that were used in the last 7 days
 */
export function deduplicateQueries(
  queries: { query: string; engine: string; priority: number }[],
  recentlyUsed: Set<string>
): { query: string; engine: string; priority: number }[] {
  return queries.filter(q => !recentlyUsed.has(q.query.toLowerCase().trim()));
}

/**
 * Get the full 30-day plan overview (for display in UI)
 */
export function get30DayCyclePlan(): { day: number; product: string; market: string; scale: string }[] {
  const plan: { day: number; product: string; market: string; scale: string }[] = [];

  const baseDate = new Date();
  const dayOfYear = Math.floor((baseDate.getTime() - new Date(baseDate.getFullYear(), 0, 0).getTime()) / 86400000);
  const currentCycleStart = dayOfYear - ((dayOfYear % 30));

  for (let i = 0; i < 30; i++) {
    const cycleDay = i + 1;
    const productIdx = cycleDay % PRODUCT_DIMENSIONS.length;
    const marketIdx = Math.floor(cycleDay / 2) % MARKET_DIMENSIONS.length;
    const scaleIdx = Math.floor(cycleDay / 4) % SCALE_DIMENSIONS.length;

    plan.push({
      day: cycleDay,
      product: PRODUCT_DIMENSIONS[productIdx].id,
      market: MARKET_DIMENSIONS[marketIdx].region,
      scale: SCALE_DIMENSIONS[scaleIdx].desc,
    });
  }

  return plan;
}

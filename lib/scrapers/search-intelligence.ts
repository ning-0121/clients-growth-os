import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Search Intelligence — 搜索自主学习引擎
 *
 * 系统自动分析历史搜索效果，持续优化搜索策略：
 * 1. 记录每次搜索的「投入产出比」（搜索词 → 找到几个 → 进入pipeline几个 → 最终合格几个）
 * 2. 高产出的搜索词自动加权，低产出的降权
 * 3. 从成功案例中提取新关键词（赢单客户的特征 → 新搜索词）
 * 4. 自动发现新的搜索渠道和关键词组合
 */

export interface SearchPerformance {
  query: string;
  source: string;
  times_used: number;
  urls_found: number;
  leads_qualified: number;
  leads_converted: number;
  success_rate: number; // qualified / found
  last_used_at: string;
}

/**
 * Analyze search history and generate optimized query list.
 * Top-performing queries get used more, underperformers get replaced.
 */
export async function getSmartQueries(
  supabase: SupabaseClient,
  maxQueries: number = 10
): Promise<string[]> {
  // Get discovery run history
  const { data: runs } = await supabase
    .from('discovery_runs')
    .select('source, query_used, urls_found, urls_new, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!runs || runs.length < 5) {
    return []; // Not enough data to learn yet
  }

  // Parse query performance from run metadata
  const queryStats = new Map<string, { found: number; new: number; uses: number }>();

  for (const run of runs) {
    const details = (run.metadata as any)?.details || [];
    for (const d of details) {
      const query = d.query?.slice(0, 80);
      if (!query) continue;
      const existing = queryStats.get(query) || { found: 0, new: 0, uses: 0 };
      existing.found += d.found || 0;
      existing.new += d.new || 0;
      existing.uses++;
      queryStats.set(query, existing);
    }
  }

  // Score each query: new_per_use = urls_new / times_used
  const scored = [...queryStats.entries()]
    .map(([query, stats]) => ({
      query,
      score: stats.uses > 0 ? stats.new / stats.uses : 0,
      totalNew: stats.new,
      uses: stats.uses,
    }))
    .filter(q => q.uses >= 2) // Need at least 2 uses for reliable data
    .sort((a, b) => b.score - a.score);

  // Return top performing queries
  return scored.slice(0, maxQueries).map(q => q.query);
}

/**
 * Learn from won deals — extract patterns to generate new search queries.
 * "What do our best customers have in common?" → search for more like them
 */
export async function learnFromWonDeals(
  supabase: SupabaseClient
): Promise<string[]> {
  const newQueries: string[] = [];

  // Get won deals with lead info
  const { data: wonDeals } = await supabase
    .from('growth_deals')
    .select('lead_id, customer_name, product_category')
    .eq('status', 'won')
    .limit(50);

  if (!wonDeals || wonDeals.length < 3) return newQueries;

  // Get the leads behind won deals
  const leadIds = wonDeals.map(d => d.lead_id).filter(Boolean);
  if (leadIds.length === 0) return newQueries;

  const { data: wonLeads } = await supabase
    .from('growth_leads')
    .select('company_name, source, product_match, ai_analysis')
    .in('id', leadIds);

  if (!wonLeads) return newQueries;

  // Extract patterns
  const productCategories = new Map<string, number>();
  const companyTypes = new Map<string, number>();
  const sources = new Map<string, number>();

  for (const lead of wonLeads) {
    const ai = lead.ai_analysis as any;

    // Product categories from won deals
    if (ai?.product_categories) {
      for (const cat of ai.product_categories) {
        productCategories.set(cat, (productCategories.get(cat) || 0) + 1);
      }
    }
    if (lead.product_match) {
      productCategories.set(lead.product_match, (productCategories.get(lead.product_match) || 0) + 1);
    }

    // Company types
    if (ai?.company_type) {
      companyTypes.set(ai.company_type, (companyTypes.get(ai.company_type) || 0) + 1);
    }

    // Source channels
    if (lead.source) {
      sources.set(lead.source, (sources.get(lead.source) || 0) + 1);
    }
  }

  // Generate new queries based on winning patterns
  const topCategories = [...productCategories.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  const topTypes = [...companyTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([type]) => type);

  for (const cat of topCategories) {
    for (const type of topTypes) {
      newQueries.push(`"${cat}" ${type} brand official website`);
    }
    newQueries.push(`"${cat}" brand 2025 2026 new`);
    newQueries.push(`site:instagram.com "${cat}" brand`);
  }

  return newQueries;
}

/**
 * Auto-expand search scope based on what works.
 * If "activewear brand USA" works well, try "activewear brand Canada" too.
 */
export async function expandSearchScope(
  supabase: SupabaseClient
): Promise<string[]> {
  const newQueries: string[] = [];

  // Get successful queries (found 3+ new URLs)
  const { data: runs } = await supabase
    .from('discovery_runs')
    .select('metadata')
    .order('urls_new', { ascending: false })
    .limit(20);

  if (!runs) return newQueries;

  const successfulKeywords = new Set<string>();
  const successfulCountries = new Set<string>();

  for (const run of runs) {
    const details = (run.metadata as any)?.details || [];
    for (const d of details) {
      if ((d.new || 0) >= 3) {
        // Extract keyword and country from successful query
        const query = d.query || '';
        const keywordMatch = query.match(/"([^"]+)"/);
        if (keywordMatch) successfulKeywords.add(keywordMatch[1]);

        const countries = ['USA', 'UK', 'Germany', 'France', 'Australia', 'Canada', 'Japan', 'South Korea', 'Netherlands', 'Italy', 'Spain', 'Sweden', 'Denmark', 'Norway', 'Brazil', 'Mexico', 'India', 'Singapore', 'UAE', 'South Africa'];
        for (const country of countries) {
          if (query.includes(country)) {
            // Found a country that works — try other countries with same keyword
            if (keywordMatch) {
              const otherCountries = countries.filter(c => c !== country);
              for (const other of otherCountries.slice(0, 3)) {
                newQueries.push(`"${keywordMatch[1]}" ${other}`);
              }
            }
            break;
          }
        }
      }
    }
  }

  return [...new Set(newQueries)].slice(0, 15);
}

/**
 * Get search stats for display in the UI
 */
export async function getSearchStats(supabase: SupabaseClient): Promise<{
  total_queries: number;
  total_urls_found: number;
  total_urls_new: number;
  top_queries: { query: string; new_count: number }[];
  channels: { source: string; runs: number; urls_new: number }[];
}> {
  const { data: runs } = await supabase
    .from('discovery_runs')
    .select('source, urls_found, urls_new, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (!runs) return { total_queries: 0, total_urls_found: 0, total_urls_new: 0, top_queries: [], channels: [] };

  let totalFound = 0;
  let totalNew = 0;
  const queryPerf = new Map<string, number>();
  const channelStats = new Map<string, { runs: number; urls_new: number }>();

  for (const run of runs) {
    totalFound += run.urls_found || 0;
    totalNew += run.urls_new || 0;

    const ch = channelStats.get(run.source) || { runs: 0, urls_new: 0 };
    ch.runs++;
    ch.urls_new += run.urls_new || 0;
    channelStats.set(run.source, ch);

    const details = (run.metadata as any)?.details || [];
    for (const d of details) {
      if (d.query && d.new > 0) {
        const q = d.query.slice(0, 60);
        queryPerf.set(q, (queryPerf.get(q) || 0) + d.new);
      }
    }
  }

  return {
    total_queries: runs.length,
    total_urls_found: totalFound,
    total_urls_new: totalNew,
    top_queries: [...queryPerf.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([query, new_count]) => ({ query, new_count })),
    channels: [...channelStats.entries()]
      .map(([source, stats]) => ({ source, ...stats }))
      .sort((a, b) => b.urls_new - a.urls_new),
  };
}

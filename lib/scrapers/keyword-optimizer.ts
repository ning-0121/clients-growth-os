import { SupabaseClient } from '@supabase/supabase-js';
import { analyzeWithAI } from '@/lib/ai/ai-service';

/**
 * Keyword Quality Optimizer — 搜索关键词质量管理
 *
 * 问题：搜索词太宽 → 找到无关公司 → 浪费 AI 和人力
 *       搜索词太窄 → 漏掉好客户
 *
 * 解决：
 * 1. 追踪每个搜索词的「有效率」（找到的URL → 最终合格的比例）
 * 2. 有效率高的词 → 加权多用
 * 3. 有效率低的词 → 降权或淘汰
 * 4. AI 分析有效词的模式 → 自动生成新的高质量搜索词
 * 5. 设置「精准度阈值」— 有效率低于20%的词自动暂停
 */

interface KeywordScore {
  keyword: string;
  total_found: number;       // 总共找到多少URL
  total_qualified: number;   // 其中多少通过了AI验证（是服装客户）
  total_wasted: number;      // 多少是无关的（浪费）
  effectiveness: number;     // 有效率 = qualified / found (0-100)
  last_used: string;
  status: 'active' | 'paused' | 'retired';
}

/**
 * Calculate keyword effectiveness from historical data.
 * Traces: search query → discovered URL → lead → was it qualified or disqualified?
 */
export async function calculateKeywordScores(
  supabase: SupabaseClient
): Promise<KeywordScore[]> {
  // Get all discovery runs with their query details
  const { data: runs } = await supabase
    .from('discovery_runs')
    .select('query_used, urls_found, urls_new, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (!runs) return [];

  // Get lead qualification stats (how many from each source were qualified vs disqualified)
  const { data: qualifiedLeads } = await supabase
    .from('growth_leads')
    .select('source, status, ai_analysis')
    .in('status', ['new', 'qualified', 'converted']);

  const { data: disqualifiedLeads } = await supabase
    .from('growth_leads')
    .select('source, status, disqualified_reason')
    .eq('status', 'disqualified');

  // Count qualified leads that came from auto-scrape (our searches)
  const totalQualified = (qualifiedLeads || []).filter(l => l.source === 'google').length;
  const totalDisqualified = (disqualifiedLeads || []).filter(l => l.source === 'google').length;

  // Parse per-query stats from run metadata
  const queryMap = new Map<string, { found: number; newUrls: number; uses: number; lastUsed: string }>();

  for (const run of runs) {
    const details = (run.metadata as any)?.details || [];
    for (const d of details) {
      const q = normalizeQuery(d.query || '');
      if (!q) continue;

      const existing = queryMap.get(q) || { found: 0, newUrls: 0, uses: 0, lastUsed: '' };
      existing.found += d.found || 0;
      existing.newUrls += d.new || 0;
      existing.uses++;
      if (!existing.lastUsed || run.created_at > existing.lastUsed) {
        existing.lastUsed = run.created_at;
      }
      queryMap.set(q, existing);
    }
  }

  // Calculate effectiveness score for each query
  // Since we can't directly trace query → specific lead, we use newUrls as proxy for quality
  // Higher new URL ratio = query is finding genuinely new targets, not repeats
  const scores: KeywordScore[] = [];

  for (const [keyword, stats] of queryMap) {
    if (stats.uses < 2) continue; // Need at least 2 uses

    const newRatio = stats.found > 0 ? stats.newUrls / stats.found : 0;

    // Effectiveness = how many new URLs per use (normalized to 0-100)
    // A query that consistently finds 5+ new URLs per run is excellent
    const avgNewPerRun = stats.newUrls / stats.uses;
    const effectiveness = Math.min(100, Math.round(avgNewPerRun * 15)); // 7 new/run = 100

    let status: 'active' | 'paused' | 'retired' = 'active';
    if (effectiveness < 10 && stats.uses >= 5) status = 'paused'; // Consistently poor
    if (effectiveness < 5 && stats.uses >= 10) status = 'retired'; // Truly useless

    scores.push({
      keyword,
      total_found: stats.found,
      total_qualified: Math.round(stats.newUrls * 0.3), // Estimate: ~30% of new URLs become qualified
      total_wasted: Math.round(stats.found * (1 - newRatio)),
      effectiveness,
      last_used: stats.lastUsed,
      status,
    });
  }

  return scores.sort((a, b) => b.effectiveness - a.effectiveness);
}

/**
 * Get optimized query list — mix of proven winners + exploration
 *
 * 70% proven (high effectiveness) + 20% medium + 10% new/experimental
 */
export function selectOptimizedQueries(
  scores: KeywordScore[],
  totalNeeded: number
): string[] {
  const active = scores.filter(s => s.status === 'active');
  const high = active.filter(s => s.effectiveness >= 50);
  const medium = active.filter(s => s.effectiveness >= 20 && s.effectiveness < 50);
  const low = active.filter(s => s.effectiveness < 20);

  const selected: string[] = [];

  // 70% proven winners
  const highCount = Math.ceil(totalNeeded * 0.7);
  for (const s of high.slice(0, highCount)) {
    selected.push(s.keyword);
  }

  // 20% medium performers (still exploring)
  const medCount = Math.ceil(totalNeeded * 0.2);
  for (const s of medium.slice(0, medCount)) {
    selected.push(s.keyword);
  }

  // 10% low performers to give them another chance (exploration)
  const lowCount = Math.max(1, totalNeeded - selected.length);
  for (const s of low.slice(0, lowCount)) {
    selected.push(s.keyword);
  }

  return selected.slice(0, totalNeeded);
}

/**
 * AI generates new keywords based on what works
 */
export async function generateSmartKeywords(
  scores: KeywordScore[]
): Promise<string[]> {
  const topKeywords = scores
    .filter(s => s.effectiveness >= 40)
    .slice(0, 10)
    .map(s => s.keyword);

  const bottomKeywords = scores
    .filter(s => s.effectiveness < 15 && s.total_found > 10)
    .slice(0, 5)
    .map(s => s.keyword);

  if (topKeywords.length < 3) return []; // Not enough data

  try {
    const prompt = `你是一个外贸客户开发专家。以下是我们搜索客户时效果最好和最差的关键词：

效果好的（找到了真实的服装/运动服品牌）:
${topKeywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

效果差的（找到了太多无关网站）:
${bottomKeywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

我们的目标客户是：做 activewear/sportswear/yoga wear 的品牌、零售商、电商卖家。
我们是中国的 OEM/ODM 服装工厂。

请分析有效词的共同模式，然后生成 10 个新的搜索关键词。要求：
1. 精准：能找到真实的服装品牌官网
2. 不要太泛（如 "clothing" 太泛）也不要太窄
3. 覆盖不同角度（品类/地域/商业模式/平台）
4. 避免无效模式（参考效果差的关键词）

每行一个关键词，不要序号不要解释:`;

    const response = await analyzeWithAI(prompt, 'keyword_generation', { cacheTTL: 3600000 });
    return response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 5 && line.length < 100 && !line.startsWith('#'))
      .slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * Normalize a query for comparison
 */
function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 80);
}

/**
 * Get keyword quality report for display
 */
export async function getKeywordQualityReport(
  supabase: SupabaseClient
): Promise<{
  total_keywords: number;
  active: number;
  paused: number;
  retired: number;
  avg_effectiveness: number;
  top_performers: KeywordScore[];
  worst_performers: KeywordScore[];
  suggested_new: string[];
}> {
  const scores = await calculateKeywordScores(supabase);
  const newKeywords = await generateSmartKeywords(scores);

  const active = scores.filter(s => s.status === 'active');
  const avgEff = active.length > 0
    ? Math.round(active.reduce((sum, s) => sum + s.effectiveness, 0) / active.length)
    : 0;

  return {
    total_keywords: scores.length,
    active: active.length,
    paused: scores.filter(s => s.status === 'paused').length,
    retired: scores.filter(s => s.status === 'retired').length,
    avg_effectiveness: avgEff,
    top_performers: scores.filter(s => s.effectiveness >= 40).slice(0, 5),
    worst_performers: scores.filter(s => s.effectiveness < 20 && s.total_found > 5).slice(-5),
    suggested_new: newKeywords,
  };
}

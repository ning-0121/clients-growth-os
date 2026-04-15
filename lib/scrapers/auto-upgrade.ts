import { SupabaseClient } from '@supabase/supabase-js';
import { analyzeWithAI } from '@/lib/ai/ai-service';

/**
 * Auto-Upgrade Engine — 自动升级系统能力
 *
 * 每周自动执行:
 * 1. 分析过去一周的搜索效果
 * 2. 搜索 GitHub + 技术社区的最新工具
 * 3. 自动生成新的搜索查询词加入搜索池
 * 4. 自动发现并记录新的免费API
 * 5. 用 AI 评估哪些发现值得集成
 * 6. 生成升级报告
 *
 * 学到的东西存在 `system_learned_skills` 表里,
 * 搜索引擎和联系方式猎手每次运行时读取最新的技能。
 */

export interface LearnedSkill {
  type: 'search_query' | 'api_endpoint' | 'scraping_pattern' | 'email_source' | 'data_source';
  name: string;
  value: string;          // The actual query/URL/pattern
  effectiveness: number;  // 0-100 estimated value
  source: string;         // Where we learned it
  auto_apply: boolean;    // Should system automatically use this?
}

/**
 * Run weekly auto-upgrade: analyze + discover + apply
 */
export async function runWeeklyUpgrade(
  supabase: SupabaseClient
): Promise<{
  skills_learned: number;
  queries_added: number;
  apis_discovered: number;
  report: string;
}> {
  const serpApiKey = process.env.SERPAPI_KEY;
  if (!serpApiKey) return { skills_learned: 0, queries_added: 0, apis_discovered: 0, report: 'No SERPAPI_KEY' };

  const newSkills: LearnedSkill[] = [];

  // ── Phase 1: Analyze what's working ──
  const { data: recentRuns } = await supabase
    .from('discovery_runs')
    .select('source, urls_found, urls_new, metadata')
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  const totalFound = (recentRuns || []).reduce((s: number, r: any) => s + (r.urls_new || 0), 0);

  // ── Phase 2: Search for new tools this week ──
  const weeklySearches = [
    'email finder new tool free 2025 2026',
    'b2b lead generation scraper open source new',
    'linkedin contact finder free API 2025',
    'shopify store database directory',
    'activewear brand database wholesale directory',
    'sportswear buyer directory list',
    'apparel trade show 2025 2026 exhibitor',
    'free company data API enrichment',
  ];

  // Pick 3 searches for this week
  const weekNum = Math.floor(Date.now() / (7 * 86400000));
  const weekSearches = weeklySearches.slice((weekNum * 3) % weeklySearches.length).slice(0, 3);

  for (const query of weekSearches) {
    try {
      const url = `https://serpapi.com/search.json?api_key=${serpApiKey}&q=${encodeURIComponent(query)}&num=5&engine=google`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();

      for (const r of (data.organic_results || []).slice(0, 3)) {
        const snippet = `${r.title} ${r.snippet || ''}`.toLowerCase();

        // Auto-detect useful patterns from results
        if (snippet.includes('free') && (snippet.includes('api') || snippet.includes('tool'))) {
          newSkills.push({
            type: 'data_source',
            name: r.title?.slice(0, 60) || '',
            value: r.link || '',
            effectiveness: 50,
            source: query,
            auto_apply: false, // Needs manual review
          });
        }

        // Extract new search queries from articles
        if (snippet.includes('directory') || snippet.includes('database') || snippet.includes('list')) {
          newSkills.push({
            type: 'search_query',
            name: `From: ${r.title?.slice(0, 40)}`,
            value: r.title?.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().slice(0, 80) || '',
            effectiveness: 40,
            source: 'auto_extract',
            auto_apply: true,
          });
        }
      }

      await new Promise(r => setTimeout(r, 500));
    } catch {}
  }

  // ── Phase 3: AI-evaluate and generate new search strategies ──
  let aiSuggestions: string[] = [];
  try {
    const prompt = `你是外贸服装行业客户开发专家。

我们系统过去一周的搜索结果：
- 总共发现 ${totalFound} 个新客户URL
- 搜索来源: Google, Bing, Instagram, Shopify, LinkedIn

请给出5个新的搜索策略建议（用英文搜索词），要求：
1. 能找到小众但高质量的运动服/瑜伽服品牌
2. 不要重复常见的搜索词
3. 可以是特定平台的搜索（如 site:某个网站）
4. 考虑行业展会、设计师社区、众筹平台等非传统渠道

每行一个搜索词，不要序号不要解释:`;

    const response = await analyzeWithAI(prompt, 'weekly_upgrade_ai', { cacheTTL: 86400000 });
    aiSuggestions = response.split('\n').filter(l => l.trim().length > 5).slice(0, 5);

    for (const suggestion of aiSuggestions) {
      newSkills.push({
        type: 'search_query',
        name: 'AI weekly suggestion',
        value: suggestion.trim(),
        effectiveness: 60,
        source: 'ai_weekly',
        auto_apply: true,
      });
    }
  } catch {}

  // ── Phase 4: Store learned skills ──
  const autoApplyQueries = newSkills
    .filter(s => s.type === 'search_query' && s.auto_apply)
    .map(s => s.value);

  // Store in discovery_runs for the search engine to pick up
  if (newSkills.length > 0) {
    await supabase.from('discovery_runs').insert({
      source: 'weekly_upgrade',
      query_used: weekSearches.join(' | '),
      urls_found: newSkills.length,
      urls_new: autoApplyQueries.length,
      metadata: {
        skills: newSkills,
        ai_suggestions: aiSuggestions,
        auto_apply_queries: autoApplyQueries,
        week_number: weekNum,
        total_found_this_week: totalFound,
      },
    });
  }

  // Generate report
  const report = `本周升级报告:
- 搜索效果: 过去7天发现 ${totalFound} 个新URL
- 新技能: 发现 ${newSkills.length} 个（${newSkills.filter(s => s.type === 'search_query').length}个搜索词 + ${newSkills.filter(s => s.type === 'data_source').length}个数据源）
- AI建议: ${aiSuggestions.length} 个新搜索策略
- 自动应用: ${autoApplyQueries.length} 个新搜索词已加入搜索池`;

  return {
    skills_learned: newSkills.length,
    queries_added: autoApplyQueries.length,
    apis_discovered: newSkills.filter(s => s.type === 'data_source').length,
    report,
  };
}

/**
 * Get auto-apply search queries learned from weekly upgrades
 * Called by the discover cron to use learned queries
 */
export async function getLearnedSearchQueries(
  supabase: SupabaseClient
): Promise<string[]> {
  const { data: runs } = await supabase
    .from('discovery_runs')
    .select('metadata')
    .eq('source', 'weekly_upgrade')
    .order('created_at', { ascending: false })
    .limit(4); // Last 4 weeks

  const queries: string[] = [];
  for (const run of (runs || [])) {
    const autoApply = (run.metadata as any)?.auto_apply_queries || [];
    queries.push(...autoApply);
  }

  return [...new Set(queries)].slice(0, 20);
}

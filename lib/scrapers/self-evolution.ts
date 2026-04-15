import { SupabaseClient } from '@supabase/supabase-js';
import { analyzeWithAI } from '@/lib/ai/ai-service';

/**
 * Self-Evolution Engine — 自我进化引擎
 *
 * 每天自动搜索 GitHub、技术社区，发现最新的：
 * 1. 邮箱查找工具/API
 * 2. 线索挖掘技术
 * 3. 网站爬虫新方法
 * 4. 联系方式验证工具
 * 5. 销售自动化最佳实践
 *
 * 用 AI 评估每个发现是否对我们有用，生成升级建议。
 */

export interface DiscoveredTool {
  name: string;
  description: string;
  url: string;
  stars: number;
  language: string;
  category: string;
  relevance_score: number;
  ai_evaluation: string;
  implementation_suggestion: string;
}

// GitHub search queries for sales/lead-gen tools
const GITHUB_SEARCHES = [
  // Email finding
  'email finder scraper stars:>50',
  'email hunter API stars:>100',
  'email verification tool stars:>50',
  'find email from domain stars:>30',
  'email permutator generator',

  // Lead generation
  'lead generation scraper stars:>100',
  'b2b lead finder stars:>50',
  'sales prospecting tool stars:>100',
  'company enrichment API stars:>50',
  'contact discovery tool stars:>30',

  // Web scraping
  'website scraper contact info stars:>100',
  'linkedin scraper stars:>200',
  'instagram scraper brand stars:>100',
  'shopify store finder stars:>50',
  'ecommerce scraper stars:>100',

  // Sales automation
  'cold email automation stars:>100',
  'outreach sequence tool stars:>50',
  'crm sales automation stars:>200',
  'whatsapp business API bot stars:>50',

  // Data enrichment
  'company data enrichment stars:>50',
  'whois lookup API stars:>30',
  'social media profile finder stars:>50',
  'phone number finder API stars:>30',
];

// Tech blog/community searches for latest techniques
const TECHNIQUE_SEARCHES = [
  '"email finding" technique 2025 2026',
  '"lead generation" new tool API 2025 2026',
  '"web scraping" bypass block 2025 2026',
  '"b2b sales" automation AI 2025 2026',
  '"contact enrichment" API free 2025',
  '"cold outreach" best practice 2025 2026',
  'find anyone email address method 2025',
  'scrape company data without API 2025',
  '"find decision maker" email tool',
  '"linkedin scraper" open source 2025',
  'email hunter alternative free 2025',
  '"shopify store" scraper tool 2025',
  '"instagram brand" finder scraper',
  'b2b contact database free API',
  '"company info" API free enrichment',
  '"phone number" finder business API',
  'apparel brand database list 2025',
  'activewear brand directory list',
];

/**
 * Search GitHub for relevant tools
 */
async function searchGitHub(query: string): Promise<any[]> {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'GrowthOS-SelfEvolution',
    };
    // Use token if available for higher rate limit
    const ghToken = process.env.GITHUB_TOKEN;
    if (ghToken) headers.Authorization = `token ${ghToken}`;

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json();
    return (data.items || []).slice(0, 3).map((repo: any) => ({
      name: repo.full_name,
      description: repo.description?.slice(0, 200) || '',
      url: repo.html_url,
      stars: repo.stargazers_count,
      language: repo.language || 'Unknown',
      updated_at: repo.updated_at,
      topics: repo.topics || [],
    }));
  } catch {
    return [];
  }
}

/**
 * Search Google for latest techniques and tools (via SerpAPI)
 */
async function searchTechniques(query: string): Promise<any[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=3&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.organic_results || []).slice(0, 3).map((r: any) => ({
      title: r.title,
      snippet: r.snippet,
      url: r.link,
    }));
  } catch {
    return [];
  }
}

/**
 * Use AI to evaluate a discovered tool and generate implementation suggestion
 */
async function evaluateTool(tool: any): Promise<{
  relevance: number;
  evaluation: string;
  suggestion: string;
  category: string;
}> {
  try {
    const prompt = `你是 Growth OS 的技术架构师。Growth OS 是一个 B2B 外贸服装客户开发系统。

当前系统能力:
- 网站爬取找邮箱（8页深度扫描 + Schema.org + Footer + 法律页）
- Google/Bing 搜索找品牌
- Instagram/Shopify 发现
- PhantomBuster LinkedIn 导入
- WHOIS域名查询
- 邮箱模式猜测 + MX验证
- 企业注册/招聘网站搜索
- Google Maps 地址电话

发现了一个GitHub工具/技术:
名称: ${tool.name}
描述: ${tool.description}
Stars: ${tool.stars || 'N/A'}
语言: ${tool.language || 'N/A'}
URL: ${tool.url}

请评估:
1. 这个工具对我们系统是否有用？(0-100分)
2. 它能增强我们哪方面能力？
3. 如果有用，怎么集成？(1-2句话)

回答要极简(中文，共3行):
第1行: 分数(数字)
第2行: 分类(email_finding/lead_gen/scraping/enrichment/automation/other)
第3行: 一句话评估和集成建议`;

    const response = await analyzeWithAI(prompt, 'tool_evaluation', { cacheTTL: 86400000 }); // Cache 24h
    const lines = response.trim().split('\n').filter(Boolean);

    return {
      relevance: parseInt(lines[0]) || 0,
      category: lines[1]?.trim() || 'other',
      evaluation: lines[2]?.trim() || '',
      suggestion: lines[2]?.trim() || '',
    };
  } catch {
    return { relevance: 0, category: 'other', evaluation: 'AI评估失败', suggestion: '' };
  }
}

/**
 * Main: Run daily self-evolution scan
 */
export async function runSelfEvolution(
  supabase: SupabaseClient
): Promise<{
  tools_discovered: number;
  tools_relevant: number;
  techniques_found: number;
  learned_queries: number;
  new_apis_found: number;
  top_discoveries: DiscoveredTool[];
}> {
  const allTools: DiscoveredTool[] = [];

  // Rotate through GitHub searches (3 per run to stay within rate limits)
  const now = new Date();
  const offset = (now.getDate() * 3) % GITHUB_SEARCHES.length;
  const ghQueries = GITHUB_SEARCHES.slice(offset, offset + 3);

  for (const query of ghQueries) {
    const repos = await searchGitHub(query);
    for (const repo of repos) {
      // Quick relevance filter before AI evaluation
      const desc = (repo.description || '').toLowerCase();
      const isRelevant = desc.includes('email') || desc.includes('lead') ||
        desc.includes('scrape') || desc.includes('contact') ||
        desc.includes('sales') || desc.includes('enrichment') ||
        desc.includes('linkedin') || desc.includes('instagram');

      if (!isRelevant && repo.stars < 500) continue;

      const evaluation = await evaluateTool(repo);

      if (evaluation.relevance >= 40) {
        allTools.push({
          name: repo.name,
          description: repo.description,
          url: repo.url,
          stars: repo.stars,
          language: repo.language,
          category: evaluation.category,
          relevance_score: evaluation.relevance,
          ai_evaluation: evaluation.evaluation,
          implementation_suggestion: evaluation.suggestion,
        });
      }
    }
    await new Promise(r => setTimeout(r, 1000)); // GitHub rate limit
  }

  // Search for techniques (1 query per run)
  const techOffset = now.getDate() % TECHNIQUE_SEARCHES.length;
  const techniques = await searchTechniques(TECHNIQUE_SEARCHES[techOffset]);

  // Store discoveries
  const toolsToStore = allTools
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 10);

  if (toolsToStore.length > 0) {
    await supabase.from('discovery_runs').insert({
      source: 'self_evolution',
      query_used: ghQueries.join(' | '),
      urls_found: allTools.length,
      urls_new: toolsToStore.length,
      metadata: {
        tools: toolsToStore,
        techniques: techniques.slice(0, 5),
        github_queries: ghQueries,
      },
    });
  }

  // Phase 3: Auto-learn — extract new search queries from techniques
  const learnedQueries: string[] = [];
  for (const tech of techniques) {
    if (tech.snippet) {
      // Extract useful search patterns from technique articles
      const patterns = extractSearchPatternsFromText(tech.snippet + ' ' + tech.title);
      learnedQueries.push(...patterns);
    }
  }

  // Phase 4: Search for free email/contact APIs and try them
  const newAPIs = await discoverFreeAPIs();

  // Store everything
  const allDiscoveries = {
    tools: toolsToStore,
    techniques: techniques.slice(0, 5),
    github_queries: ghQueries,
    learned_queries: learnedQueries,
    new_apis: newAPIs,
  };

  await supabase.from('discovery_runs').insert({
    source: 'self_evolution',
    query_used: ghQueries.join(' | '),
    urls_found: allTools.length + techniques.length,
    urls_new: toolsToStore.length + learnedQueries.length,
    metadata: allDiscoveries,
  });

  return {
    tools_discovered: allTools.length,
    tools_relevant: toolsToStore.filter(t => t.relevance_score >= 60).length,
    techniques_found: techniques.length,
    learned_queries: learnedQueries.length,
    new_apis_found: newAPIs.length,
    top_discoveries: toolsToStore.slice(0, 5),
  };
}

/**
 * Extract actionable search patterns from technique article text.
 * E.g., if an article mentions "use site:apollo.io to find contacts",
 * we learn a new search pattern.
 */
function extractSearchPatternsFromText(text: string): string[] {
  const patterns: string[] = [];
  const lower = text.toLowerCase();

  // Learn new data sources mentioned in articles
  const sourcePatterns = [
    { keyword: 'apollo.io', query: 'site:apollo.io activewear brand contact' },
    { keyword: 'rocketreach', query: '"rocketreach" activewear contact email' },
    { keyword: 'clearbit', query: '"clearbit" company enrichment activewear' },
    { keyword: 'zoominfo', query: 'site:zoominfo.com sportswear brand' },
    { keyword: 'crunchbase', query: 'site:crunchbase.com activewear sportswear' },
    { keyword: 'pitchbook', query: 'site:pitchbook.com fitness apparel brand' },
    { keyword: 'owler', query: 'site:owler.com activewear brand revenue' },
    { keyword: 'craft.co', query: 'site:craft.co sportswear brand' },
    { keyword: 'datanyze', query: '"datanyze" shopify activewear store' },
    { keyword: 'builtwith', query: 'site:builtwith.com shopify activewear' },
    { keyword: 'similarweb', query: 'site:similarweb.com activewear brand traffic' },
    { keyword: 'tradeshow', query: 'activewear trade show exhibitor list 2025 2026' },
    { keyword: 'trade show', query: 'sportswear expo exhibitor directory' },
  ];

  for (const sp of sourcePatterns) {
    if (lower.includes(sp.keyword)) {
      patterns.push(sp.query);
    }
  }

  // Learn new email finding techniques mentioned
  if (lower.includes('hunter.io') || lower.includes('email finder')) {
    patterns.push('"email finder" free alternative 2025');
  }
  if (lower.includes('linkedin sales navigator')) {
    patterns.push('linkedin sales navigator activewear brand sourcing');
  }

  return [...new Set(patterns)].slice(0, 5);
}

/**
 * Discover free APIs that could enhance our contact finding
 */
async function discoverFreeAPIs(): Promise<{ name: string; url: string; description: string }[]> {
  const apis: { name: string; url: string; description: string }[] = [];

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return apis;

  try {
    const query = 'free email finder API 2025 no signup';
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=5&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return apis;
    const data = await res.json();

    for (const r of (data.organic_results || []).slice(0, 3)) {
      apis.push({
        name: r.title?.slice(0, 60) || '',
        url: r.link || '',
        description: r.snippet?.slice(0, 150) || '',
      });
    }
  } catch {}

  return apis;
}

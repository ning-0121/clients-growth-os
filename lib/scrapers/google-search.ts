/**
 * Google Custom Search API 爬虫 — 合法、免费（100次/天）、真实结果
 *
 * 设置步骤:
 * 1. https://programmablesearchengine.google.com → 创建搜索引擎
 * 2. https://console.cloud.google.com → 启用 Custom Search API → 获取 API Key
 * 3. 设置环境变量 GOOGLE_CSE_API_KEY 和 GOOGLE_CSE_ID
 *
 * 免费额度: 100 次搜索/天（对于精准关键词搜索足够）
 */

export interface GoogleSearchResult {
  title: string;
  link: string;          // 网站URL
  snippet: string;       // 页面摘要
  displayLink: string;   // 显示域名
}

export interface SearchResponse {
  results: GoogleSearchResult[];
  totalResults: number;
  query: string;
}

/**
 * 通过 Google Custom Search API 搜索
 */
export async function googleSearch(
  query: string,
  maxResults = 10
): Promise<SearchResponse> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) {
    console.warn('[Google Search] GOOGLE_CSE_API_KEY 或 GOOGLE_CSE_ID 未配置，跳过');
    return { results: [], totalResults: 0, query };
  }

  const results: GoogleSearchResult[] = [];
  // Google CSE 每次最多返回10条，需要分页
  const pages = Math.ceil(Math.min(maxResults, 30) / 10);

  for (let page = 0; page < pages; page++) {
    const start = page * 10 + 1;
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cseId);
    url.searchParams.set('q', query);
    url.searchParams.set('start', String(start));
    url.searchParams.set('num', '10');

    try {
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`[Google Search] API error: ${response.status} ${err}`);
        break;
      }

      const data = await response.json();
      const items = data.items || [];

      for (const item of items) {
        results.push({
          title: item.title || '',
          link: item.link || '',
          snippet: item.snippet || '',
          displayLink: item.displayLink || '',
        });
      }

      // 没有更多结果了
      if (items.length < 10) break;
    } catch (err) {
      console.error('[Google Search] Fetch error:', err);
      break;
    }
  }

  return {
    results: results.slice(0, maxResults),
    totalResults: results.length,
    query,
  };
}

/**
 * 批量搜索多个关键词（带速率控制）
 */
export async function batchSearch(
  queries: string[],
  maxResultsPerQuery = 10,
  delayMs = 1000
): Promise<Map<string, SearchResponse>> {
  const allResults = new Map<string, SearchResponse>();

  for (let i = 0; i < queries.length; i++) {
    const result = await googleSearch(queries[i], maxResultsPerQuery);
    allResults.set(queries[i], result);

    // 速率控制
    if (i < queries.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return allResults;
}

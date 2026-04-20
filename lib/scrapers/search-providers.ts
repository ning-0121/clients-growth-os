/**
 * Unified search provider interface.
 * Multiple backends, same API. Lets us swap providers based on cost/quality.
 *
 * Priority order (auto-fallback):
 * 1. Brave Search API — $5/mo for 2000 queries, independent index
 * 2. DataForSEO — $0.6/1000 queries, ~10x cheaper than SerpAPI
 * 3. SerpAPI — $50/mo for 5000 queries, Google direct
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: 'brave' | 'dataforseo' | 'serpapi';
}

export interface SearchOpts {
  maxResults?: number;
  timeout?: number;
  country?: string;       // 'US', 'UK', etc.
}

// ──────────────────────────────────────────────────────────────────
// Brave Search API
// ──────────────────────────────────────────────────────────────────

export async function searchBrave(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  const { maxResults = 10, timeout = 12000, country = 'us' } = opts;

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}&country=${country}`;
    const res = await fetch(url, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.web?.results || [];
    return items.map((r: any): SearchResult => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      provider: 'brave',
    }));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────
// DataForSEO — cheapest SERP API ($0.6/1000 vs SerpAPI's $10/1000)
// ──────────────────────────────────────────────────────────────────

export async function searchDataForSEO(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return [];
  const { maxResults = 10, timeout = 15000, country = 'us' } = opts;

  try {
    const auth = Buffer.from(`${login}:${password}`).toString('base64');
    // Use live endpoint for immediate results (slightly more expensive)
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        keyword: query,
        language_code: 'en',
        location_code: country === 'us' ? 2840 : 2826, // 2840=US, 2826=UK
        depth: maxResults,
      }]),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return items
      .filter((i: any) => i.type === 'organic')
      .map((r: any): SearchResult => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.description || '',
        provider: 'dataforseo',
      }));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────
// SerpAPI fallback (existing)
// ──────────────────────────────────────────────────────────────────

export async function searchSerpAPI(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];
  const { maxResults = 10, timeout = 12000 } = opts;

  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=${maxResults}&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.error) return [];
    return (data.organic_results || []).map((r: any): SearchResult => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      provider: 'serpapi',
    }));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────
// Smart search: try cheapest first, fall back to Google-direct if empty
// ──────────────────────────────────────────────────────────────────

/**
 * Unified search — tries Brave (cheapest, independent) first, then DataForSEO,
 * then SerpAPI as last resort. Returns as soon as one succeeds.
 *
 * Cost comparison (per 1000 queries):
 *   Brave:      ~$5.0  (2000 free/mo on Pro)
 *   DataForSEO: ~$0.6  (cheapest, Google-direct)
 *   SerpAPI:    ~$10.0
 *
 * Quality:
 *   Brave: independent index, excellent for long-tail + new brands
 *   DataForSEO: Google proxy, same quality as SerpAPI
 *   SerpAPI: Google direct, gold standard
 */
export async function smartSearch(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  // Try providers in order of cost-efficiency, skip if not configured
  const providers = [
    { name: 'brave', fn: searchBrave, enabled: !!process.env.BRAVE_SEARCH_API_KEY },
    { name: 'dataforseo', fn: searchDataForSEO, enabled: !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) },
    { name: 'serpapi', fn: searchSerpAPI, enabled: !!process.env.SERPAPI_KEY },
  ];

  for (const p of providers) {
    if (!p.enabled) continue;
    const results = await p.fn(query, opts);
    if (results.length > 0) return results;
  }

  return [];
}

/**
 * Get which provider would be used (for diagnostics / cost attribution).
 */
export function getActiveSearchProvider(): 'brave' | 'dataforseo' | 'serpapi' | 'none' {
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave';
  if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) return 'dataforseo';
  if (process.env.SERPAPI_KEY) return 'serpapi';
  return 'none';
}

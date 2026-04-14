import { SupabaseClient } from '@supabase/supabase-js';
import { extractDomain } from '@/lib/growth/lead-engine';
import { enqueueUrls } from './source-queue';
import { DiscoveryResult } from './google-discovery';

/**
 * SerpAPI Bing engine discovery.
 * Uses same SerpAPI key but different engine — returns different results from Google.
 * This effectively doubles our discovery coverage with the same API.
 */

const BING_QUERIES = [
  'activewear brand official website',
  'sportswear brand official store',
  'athletic clothing brand shop',
  'fitness apparel brand online',
  'yoga wear brand official',
  'gym clothing brand website',
  'compression wear brand store',
  'athleisure brand official',
  'performance apparel brand',
  'running apparel brand store',
  'cycling jersey brand official',
  'crossfit apparel brand',
  'sustainable activewear brand',
  'DTC fitness brand',
  'new sportswear brand 2025 2026',
  'custom activewear private label brand',
  'activewear brand USA',
  'sportswear brand UK',
  'athletic brand Germany',
  'fitness brand Australia',
  'activewear brand Canada',
  'sportswear brand Japan',
  'athletic brand France',
  'activewear brand South Korea',
  'sportswear brand Europe',
  'premium activewear brand',
];

const SKIP_DOMAINS = [
  'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'pinterest.com',
  'instagram.com', 'tiktok.com', 'linkedin.com',
  'reddit.com', 'quora.com', 'medium.com',
  'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com',
  'alibaba.com', 'aliexpress.com', 'dhgate.com', 'shein.com', 'temu.com',
  'trustpilot.com', 'yelp.com', 'glassdoor.com',
  'wikipedia.org', 'wikihow.com',
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com',
  'forbes.com', 'bloomberg.com', 'cnbc.com', 'bbc.com', 'cnn.com',
  'vogue.com', 'instyle.com', 'cosmopolitan.com', 'glamour.com',
  'shopify.com', 'squarespace.com', 'wix.com', 'wordpress.com',
  'github.com', 'apple.com', 'indeed.com',
  // Big brands we already know — not prospects
  'nike.com', 'adidas.com', 'underarmour.com', 'lululemon.com',
  'gymshark.com', 'fabletics.com', 'gap.com', 'puma.com',
];

async function searchBing(query: string, apiKey: string): Promise<string[]> {
  const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=10&engine=bing`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return [];

    const data = await res.json();
    if (data.error) return [];

    return (data.organic_results || [])
      .map((item: any) => {
        let link = item.link as string;
        if (!link) return '';
        // Clean tracking params
        try {
          const u = new URL(link);
          ['msockid', 'utm_source', 'utm_medium', 'gclid'].forEach((p) => u.searchParams.delete(p));
          const skipPaths = ['/pages/', '/collections/', '/products/', '/about'];
          if (skipPaths.some((p) => u.pathname.startsWith(p))) {
            return `${u.protocol}//${u.host}`;
          }
          return u.toString().replace(/\/$/, '');
        } catch {
          return link;
        }
      })
      .filter((link: string) => {
        if (!link) return false;
        const domain = extractDomain(link);
        if (SKIP_DOMAINS.some((s) => domain.includes(s))) return false;
        if (link.endsWith('.pdf')) return false;
        return true;
      });
  } catch {
    return [];
  }
}

async function filterExisting(urls: string[], supabase: SupabaseClient): Promise<string[]> {
  if (urls.length === 0) return [];

  const { data: existingLeads } = await supabase
    .from('growth_leads').select('website').not('website', 'is', null);
  const { data: existingQueue } = await supabase
    .from('lead_source_queue').select('target_url').not('target_url', 'is', null);

  const existing = new Set([
    ...(existingLeads || []).map((l: any) => extractDomain(l.website)),
    ...(existingQueue || []).map((q: any) => extractDomain(q.target_url)),
  ]);

  return urls.filter((url) => !existing.has(extractDomain(url)));
}

/**
 * Discover leads via SerpAPI Bing engine.
 * Complements Google results with different ranking algorithm.
 */
export async function discoverFromBing(
  supabase: SupabaseClient,
  maxQueries = 5
): Promise<DiscoveryResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error('SERPAPI_KEY not configured');

  const now = new Date();
  const offset = ((now.getDate() * 24 + now.getHours()) * 3) % BING_QUERIES.length;
  const queries = Array.from({ length: maxQueries }, (_, i) =>
    BING_QUERIES[(offset + i) % BING_QUERIES.length]
  );

  const result: DiscoveryResult = {
    queries_run: 0, urls_found: 0, urls_new: 0, urls_duplicate: 0, details: [],
  };

  const allNewUrls: string[] = [];

  for (const query of queries) {
    const urls = await searchBing(query, apiKey);
    const newUrls = await filterExisting(urls, supabase);

    result.queries_run++;
    result.urls_found += urls.length;
    result.details.push({ query, found: urls.length, new: newUrls.length });
    allNewUrls.push(...newUrls);

    await new Promise((r) => setTimeout(r, 500));
  }

  const unique = [...new Set(allNewUrls)];
  if (unique.length > 0) {
    const { queued } = await enqueueUrls(
      unique.map((url) => ({ url, source: 'google', priority: 32 })),
      supabase
    );
    result.urls_new = queued;
    result.urls_duplicate = result.urls_found - queued;
  }

  await supabase.from('discovery_runs').insert({
    source: 'bing',
    query_used: queries.join(' | '),
    urls_found: result.urls_found,
    urls_new: result.urls_new,
    urls_duplicate: result.urls_duplicate,
  });

  return result;
}

import { SupabaseClient } from '@supabase/supabase-js';
import { extractDomain } from '@/lib/growth/lead-engine';
import { enqueueUrls } from './source-queue';

export interface DiscoveryResult {
  queries_run: number;
  urls_found: number;
  urls_new: number;
  urls_duplicate: number;
  details: { query: string; found: number; new: number }[];
}

// ── Search Query Templates ──

const CATEGORIES = [
  'activewear brand',
  'sportswear brand',
  'athletic clothing brand',
  'fitness apparel brand',
  'yoga wear brand',
  'athleisure brand',
  'compression wear brand',
  'gym clothing brand',
  'performance apparel',
  'outdoor sportswear',
];

const COUNTRIES = [
  'USA', 'UK', 'Germany', 'Australia', 'Canada',
  'France', 'Japan', 'South Korea', 'Netherlands', 'Sweden',
  'Italy', 'Spain', 'Denmark', 'Norway', 'New Zealand',
];

const EXTRA_QUERIES = [
  '"looking for manufacturer" activewear',
  '"private label" sportswear brand',
  '"custom apparel" brand wholesale',
  'new activewear brand 2025 2026',
  'emerging fitness brand',
  'DTC activewear brand',
  'sustainable sportswear brand',
];

// Domains to skip (not potential customers)
const SKIP_DOMAINS = [
  'youtube.com', 'facebook.com', 'twitter.com', 'pinterest.com',
  'amazon.com', 'ebay.com', 'wikipedia.org', 'reddit.com',
  'instagram.com', 'tiktok.com', 'linkedin.com',
  'instyle.com', 'vogue.com', 'gq.com', 'esquire.com',
  'womenshealthmag.com', 'menshealth.com', 'cosmopolitan.com',
  'buzzfeed.com', 'huffpost.com', 'forbes.com', 'bloomberg.com',
  'alibaba.com', 'aliexpress.com', 'dhgate.com',
  'google.com', 'bing.com', 'yahoo.com',
];

/**
 * Build a rotation of search queries. Each call returns a different slice.
 */
function getQueriesForThisRun(maxQueries: number): string[] {
  const allQueries: string[] = [];

  for (const cat of CATEGORIES) {
    for (const country of COUNTRIES) {
      allQueries.push(`"${cat}" ${country}`);
    }
  }
  allQueries.push(...EXTRA_QUERIES);

  // Rotate based on current time
  const now = new Date();
  const rotationIndex = (now.getDate() * 24 + now.getHours()) * 3 + Math.floor(now.getMinutes() / 20);
  const offset = (rotationIndex * maxQueries) % allQueries.length;

  const selected: string[] = [];
  for (let i = 0; i < maxQueries; i++) {
    selected.push(allQueries[(offset + i) % allQueries.length]);
  }

  return selected;
}

/**
 * Search via SerpAPI (Google search results).
 * Free tier: 100 searches/month. Paid: $50/mo for 5000.
 */
async function searchSerpAPI(query: string, apiKey: string): Promise<string[]> {
  const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=10&engine=google`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[SerpAPI] Search failed for "${query}": HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (data.error) {
      console.warn(`[SerpAPI] Error: ${data.error}`);
      return [];
    }

    const results = data.organic_results || [];
    return results
      .map((item: any) => item.link as string)
      .filter((link: string) => {
        if (!link) return false;
        const domain = extractDomain(link);
        return !SKIP_DOMAINS.some((skip) => domain.includes(skip));
      });
  } catch (err) {
    console.warn(`[SerpAPI] Search error for "${query}":`, err);
    return [];
  }
}

/**
 * Filter out URLs that already exist in growth_leads or lead_source_queue.
 */
async function filterExistingUrls(
  urls: string[],
  supabase: SupabaseClient
): Promise<string[]> {
  if (urls.length === 0) return [];

  const domains = urls.map((u) => extractDomain(u));

  const { data: existingLeads } = await supabase
    .from('growth_leads')
    .select('website')
    .not('website', 'is', null);

  const existingDomains = new Set(
    (existingLeads || []).map((l: any) => extractDomain(l.website))
  );

  const { data: existingQueue } = await supabase
    .from('lead_source_queue')
    .select('target_url')
    .not('target_url', 'is', null);

  const existingQueueDomains = new Set(
    (existingQueue || []).map((q: any) => extractDomain(q.target_url))
  );

  return urls.filter((url) => {
    const domain = extractDomain(url);
    return !existingDomains.has(domain) && !existingQueueDomains.has(domain);
  });
}

/**
 * Main discovery function. Runs search queries via SerpAPI and enqueues new URLs.
 */
export async function discoverLeads(
  supabase: SupabaseClient,
  maxQueries = 8
): Promise<DiscoveryResult> {
  const serpApiKey = process.env.SERPAPI_KEY;
  if (!serpApiKey) {
    throw new Error('SERPAPI_KEY not configured. Sign up at https://serpapi.com/');
  }

  const queries = getQueriesForThisRun(maxQueries);
  const result: DiscoveryResult = {
    queries_run: 0,
    urls_found: 0,
    urls_new: 0,
    urls_duplicate: 0,
    details: [],
  };

  const allNewUrls: string[] = [];

  for (const query of queries) {
    const urls = await searchSerpAPI(query, serpApiKey);
    const newUrls = await filterExistingUrls(urls, supabase);

    result.queries_run++;
    result.urls_found += urls.length;
    result.details.push({ query, found: urls.length, new: newUrls.length });

    allNewUrls.push(...newUrls);

    // Respect rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  // Deduplicate within this batch
  const uniqueNewUrls = [...new Set(allNewUrls)];

  if (uniqueNewUrls.length > 0) {
    const { queued } = await enqueueUrls(
      uniqueNewUrls.map((url) => ({
        url,
        source: 'google',
        priority: 30,
      })),
      supabase
    );
    result.urls_new = queued;
    result.urls_duplicate = result.urls_found - queued;
  }

  // Log discovery run
  await supabase.from('discovery_runs').insert({
    source: 'serpapi',
    query_used: queries.join(' | '),
    urls_found: result.urls_found,
    urls_new: result.urls_new,
    urls_duplicate: result.urls_duplicate,
    metadata: { details: result.details },
  });

  return result;
}

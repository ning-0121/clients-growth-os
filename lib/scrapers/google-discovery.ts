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

// Additional high-value queries
const EXTRA_QUERIES = [
  '"looking for manufacturer" activewear',
  '"private label" sportswear brand',
  '"custom apparel" brand wholesale',
  'new activewear brand 2025 2026',
  'emerging fitness brand',
  'DTC activewear brand',
  'sustainable sportswear brand',
];

/**
 * Build a rotation of search queries. Each call returns a different slice.
 * Uses a simple hash of the current date + hour to rotate through combinations.
 */
function getQueriesForThisRun(maxQueries: number): string[] {
  const allQueries: string[] = [];

  // Category × Country combinations
  for (const cat of CATEGORIES) {
    for (const country of COUNTRIES) {
      allQueries.push(`"${cat}" ${country}`);
    }
  }

  // Extra queries
  allQueries.push(...EXTRA_QUERIES);

  // Rotate based on current time (ensures different queries each run)
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
 * Search Google Custom Search API and return unique URLs.
 */
async function searchGoogle(
  query: string,
  apiKey: string,
  searchEngineId: string
): Promise<string[]> {
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(searchEngineId)}&q=${encodeURIComponent(query)}&num=10`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[Google] Search failed for "${query}": HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const items = data.items || [];

    return items
      .map((item: any) => item.link as string)
      .filter((link: string) => {
        // Skip non-website results
        if (!link) return false;
        if (link.includes('youtube.com')) return false;
        if (link.includes('facebook.com')) return false;
        if (link.includes('twitter.com')) return false;
        if (link.includes('pinterest.com')) return false;
        if (link.includes('amazon.com')) return false;
        if (link.includes('ebay.com')) return false;
        if (link.includes('wikipedia.org')) return false;
        if (link.includes('reddit.com')) return false;
        if (link.endsWith('.pdf')) return false;
        return true;
      });
  } catch (err) {
    console.warn(`[Google] Search error for "${query}":`, err);
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

  // Extract domains for matching against existing leads
  const domains = urls.map((u) => extractDomain(u));

  // Check existing leads by website domain
  const { data: existingLeads } = await supabase
    .from('growth_leads')
    .select('website')
    .not('website', 'is', null);

  const existingDomains = new Set(
    (existingLeads || []).map((l: any) => extractDomain(l.website))
  );

  // Check existing queue items
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
 * Main discovery function. Runs search queries and enqueues new URLs.
 */
export async function discoverFromGoogle(
  apiKey: string,
  searchEngineId: string,
  supabase: SupabaseClient,
  maxQueries = 8
): Promise<DiscoveryResult> {
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
    const urls = await searchGoogle(query, apiKey, searchEngineId);
    const newUrls = await filterExistingUrls(urls, supabase);

    result.queries_run++;
    result.urls_found += urls.length;
    result.details.push({
      query,
      found: urls.length,
      new: newUrls.length,
    });

    allNewUrls.push(...newUrls);

    // Small delay between queries to be respectful
    await new Promise((r) => setTimeout(r, 200));
  }

  // Deduplicate within this batch
  const uniqueNewUrls = [...new Set(allNewUrls)];

  // Enqueue
  if (uniqueNewUrls.length > 0) {
    const { queued, duplicates } = await enqueueUrls(
      uniqueNewUrls.map((url) => ({
        url,
        source: 'google',
        priority: 30, // Google results are medium-high priority
      })),
      supabase
    );
    result.urls_new = queued;
    result.urls_duplicate = result.urls_found - queued;
  }

  // Log discovery run
  await supabase.from('discovery_runs').insert({
    source: 'google',
    query_used: queries.join(' | '),
    urls_found: result.urls_found,
    urls_new: result.urls_new,
    urls_duplicate: result.urls_duplicate,
    metadata: { details: result.details },
  });

  return result;
}

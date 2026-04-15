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
  // Social / UGC platforms
  'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'pinterest.com',
  'instagram.com', 'tiktok.com', 'linkedin.com', 'threads.net',
  'reddit.com', 'quora.com', 'medium.com', 'substack.com',

  // Marketplaces
  'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com',
  'alibaba.com', 'aliexpress.com', 'dhgate.com', 'made-in-china.com',
  'wish.com', 'shein.com', 'temu.com',

  // Big brands (too large, not our target — they have their own supply chain)
  'nike.com', 'adidas.com', 'puma.com', 'reebok.com', 'newbalance.com',
  'underarmour.com', 'lululemon.com', 'gymshark.com', 'fabletics.com',
  'vuoriclothing.com', 'vuori.com', 'alo.com', 'aloyoga.com',
  'gap.com', 'oldnavy.com', 'athleta.com', 'bananarepublic.com',
  'hm.com', 'zara.com', 'uniqlo.com', 'forever21.com',
  'patagonia.com', 'thenorthface.com', 'columbia.com',
  'champion.com', 'fila.com', 'asics.com', 'mizuno.com',
  'onrunning.com', 'hoka.com', 'brooksrunning.com',
  'skims.com', 'aritzia.com', 'revolve.com',
  'nordstrom.com', 'macys.com', 'dickssportinggoods.com', 'rei.com',

  // Review / directory / list sites
  'trustpilot.com', 'yelp.com', 'glassdoor.com', 'bbb.org',
  'crunchbase.com', 'zoominfo.com', 'dnb.com',
  'g2.com', 'capterra.com', 'sitejabber.com',

  // Media / magazines / blogs
  'instyle.com', 'vogue.com', 'gq.com', 'esquire.com', 'elle.com',
  'womenshealthmag.com', 'menshealth.com', 'cosmopolitan.com',
  'buzzfeed.com', 'huffpost.com', 'forbes.com', 'bloomberg.com',
  'businessinsider.com', 'cnbc.com', 'bbc.com', 'cnn.com',
  'nytimes.com', 'washingtonpost.com', 'theguardian.com',
  'glamour.com', 'refinery29.com', 'byrdie.com', 'allure.com',
  'harpersbazaar.com', 'coveteur.com', 'whowhatwear.com',

  // Search engines / tools
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com',
  'archive.org', 'web.archive.org',

  // Reference / education
  'wikipedia.org', 'wikihow.com', 'britannica.com',

  // Job boards
  'indeed.com', 'ziprecruiter.com', 'monster.com', 'careerbuilder.com',

  // Generic / not-a-brand indicators
  'shopify.com', 'bigcommerce.com', 'squarespace.com', 'wix.com',
  'wordpress.com', 'blogger.com', 'tumblr.com',
  'github.com', 'stackoverflow.com', 'npmjs.com',
  'apple.com', 'play.google.com',
];

// URL path patterns that indicate non-brand pages
const SKIP_URL_PATTERNS = [
  '/best-', '/top-', '/review', '/ranking', '/list-of-',
  '/article/', '/blog/', '/news/', '/wiki/',
  '/collections/', '/products/', // marketplace product pages
  '/search?', '/tag/', '/category/',
];

/**
 * Clean a URL: remove tracking params, normalize to homepage when possible.
 */
function cleanUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);

    // Remove common tracking parameters
    const trackingParams = [
      'srsltid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'gclid', 'fbclid', 'ref', 'source', 'mc_cid', 'mc_eid',
    ];
    trackingParams.forEach((p) => u.searchParams.delete(p));

    // If the path is just a subpage like /pages/about, use the root domain instead
    const nonHomePaths = ['/pages/', '/blogs/', '/collections/', '/products/', '/about', '/contact'];
    if (nonHomePaths.some((p) => u.pathname.startsWith(p))) {
      return `${u.protocol}//${u.host}`;
    }

    // Remove trailing slash for consistency
    let cleaned = u.toString();
    if (cleaned.endsWith('/') && u.pathname === '/') {
      cleaned = cleaned.slice(0, -1);
    }

    return cleaned;
  } catch {
    return url;
  }
}

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
      .map((item: any) => cleanUrl(item.link as string))
      .filter((link: string) => {
        if (!link) return false;
        const domain = extractDomain(link);

        // Skip known non-brand domains
        if (SKIP_DOMAINS.some((skip) => domain.includes(skip))) return false;

        // Skip URLs with list/review/article patterns
        const lowerLink = link.toLowerCase();
        if (SKIP_URL_PATTERNS.some((pattern) => lowerLink.includes(pattern))) return false;

        // Skip PDFs and non-HTML
        if (link.endsWith('.pdf') || link.endsWith('.xml') || link.endsWith('.json')) return false;

        return true;
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

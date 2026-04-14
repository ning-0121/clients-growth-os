import { SupabaseClient } from '@supabase/supabase-js';
import { extractDomain } from '@/lib/growth/lead-engine';
import { enqueueUrls } from './source-queue';
import { DiscoveryResult } from './google-discovery';

// ── DuckDuckGo Search (FREE, unlimited) ──
// Uses DuckDuckGo HTML endpoint — no API key needed.
// Rate limit: be respectful, ~1 request per 2 seconds.

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Queries optimized for finding brand websites (not list articles)
const DDG_QUERIES = [
  // Direct brand discovery (site:.com forces real websites)
  'site:.com activewear brand shop -amazon -review -best -top -list',
  'site:.com sportswear brand official -amazon -wikipedia -review',
  'site:.com athletic clothing brand -amazon -ebay -best -top',
  'site:.com fitness apparel brand shop -review -list -ranking',
  'site:.com yoga wear brand official store',
  'site:.com gym clothing brand -amazon -review',
  'site:.com compression wear brand official',
  'site:.com athleisure brand shop -review -best',
  'site:.com cycling jersey brand official store',
  'site:.com running apparel brand shop',

  // Country-specific
  'activewear brand USA official website shop',
  'sportswear brand UK official site',
  'athletic clothing brand Germany online shop',
  'fitness apparel brand Australia official',
  'activewear brand Canada shop',
  'sportswear brand Japan official',
  'athletic brand France boutique officielle',
  'activewear brand South Korea',
  'sportswear brand Netherlands official',
  'performance apparel brand Scandinavia',

  // Niche categories (high-value targets)
  'custom activewear manufacturer private label',
  'DTC fitness brand launching 2025 2026',
  'new athletic brand startup',
  'sustainable activewear brand eco',
  'plus size activewear brand',
  'mens sportswear brand premium',
  'womens yoga brand boutique',
  'crossfit apparel brand official',
  'outdoor fitness brand hiking running',
  'tennis apparel brand',
];

// Domains to skip (same as google-discovery but referenced here for clarity)
const SKIP_DOMAINS = [
  'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'pinterest.com',
  'instagram.com', 'tiktok.com', 'linkedin.com', 'threads.net',
  'reddit.com', 'quora.com', 'medium.com', 'substack.com',
  'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com',
  'alibaba.com', 'aliexpress.com', 'dhgate.com', 'made-in-china.com',
  'shein.com', 'temu.com', 'wish.com',
  'trustpilot.com', 'yelp.com', 'glassdoor.com', 'bbb.org',
  'crunchbase.com', 'zoominfo.com', 'g2.com',
  'instyle.com', 'vogue.com', 'gq.com', 'esquire.com', 'elle.com',
  'womenshealthmag.com', 'menshealth.com', 'cosmopolitan.com',
  'buzzfeed.com', 'huffpost.com', 'forbes.com', 'bloomberg.com',
  'businessinsider.com', 'cnbc.com', 'bbc.com', 'cnn.com',
  'nytimes.com', 'washingtonpost.com', 'theguardian.com',
  'glamour.com', 'refinery29.com', 'byrdie.com', 'allure.com',
  'harpersbazaar.com', 'coveteur.com', 'whowhatwear.com',
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com',
  'wikipedia.org', 'wikihow.com',
  'indeed.com', 'ziprecruiter.com',
  'shopify.com', 'bigcommerce.com', 'squarespace.com', 'wix.com',
  'wordpress.com', 'github.com', 'apple.com',
  'allamerican.org', 'usalovelist.com', // list sites
  'lululemon.com', 'nike.com', 'adidas.com', 'underarmour.com', // too big, already known
  'fabletics.com', 'gymshark.com', 'alo.com', // too big
];

const SKIP_URL_PATTERNS = [
  '/best-', '/top-', '/review', '/ranking', '/list-of-',
  '/article/', '/blog/', '/news/', '/wiki/',
  '/search?', '/tag/', '/category/',
];

/**
 * Search DuckDuckGo HTML endpoint. Returns unique URLs.
 */
async function searchDDG(query: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (!res.ok) return [];

    const html = await res.text();

    // Extract URLs from DuckDuckGo's uddg redirect parameter
    const urlRegex = /uddg=([^&"]+)/g;
    const seen = new Set<string>();
    const urls: string[] = [];
    let match;

    while ((match = urlRegex.exec(html)) !== null) {
      try {
        let decoded = decodeURIComponent(match[1]);

        // Clean tracking params
        try {
          const u = new URL(decoded);
          ['srsltid', 'utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'].forEach(
            (p) => u.searchParams.delete(p)
          );
          // Normalize to homepage for subpages
          const skipPaths = ['/pages/', '/blogs/', '/collections/', '/products/', '/about', '/contact'];
          if (skipPaths.some((p) => u.pathname.startsWith(p))) {
            decoded = `${u.protocol}//${u.host}`;
          } else {
            decoded = u.toString().replace(/\/$/, '');
          }
        } catch {}

        if (!decoded.startsWith('http')) continue;

        const domain = extractDomain(decoded);

        // Apply filters
        if (SKIP_DOMAINS.some((skip) => domain.includes(skip))) continue;
        const lower = decoded.toLowerCase();
        if (SKIP_URL_PATTERNS.some((p) => lower.includes(p))) continue;
        if (decoded.endsWith('.pdf')) continue;

        if (!seen.has(domain)) {
          seen.add(domain);
          urls.push(decoded);
        }
      } catch {}
    }

    return urls;
  } catch {
    return [];
  }
}

/**
 * Filter out URLs already in leads or queue.
 */
async function filterExisting(urls: string[], supabase: SupabaseClient): Promise<string[]> {
  if (urls.length === 0) return [];

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
 * Main DuckDuckGo discovery. FREE, no API key needed.
 * Runs maxQueries searches, each returning ~10 unique brand URLs.
 */
export async function discoverFromDDG(
  supabase: SupabaseClient,
  maxQueries = 10
): Promise<DiscoveryResult> {
  // Rotate queries based on time
  const now = new Date();
  const offset = ((now.getDate() * 24 + now.getHours()) * 5 + Math.floor(now.getMinutes() / 12)) % DDG_QUERIES.length;

  const queries: string[] = [];
  for (let i = 0; i < maxQueries; i++) {
    queries.push(DDG_QUERIES[(offset + i) % DDG_QUERIES.length]);
  }

  const result: DiscoveryResult = {
    queries_run: 0,
    urls_found: 0,
    urls_new: 0,
    urls_duplicate: 0,
    details: [],
  };

  const allNewUrls: string[] = [];

  for (const query of queries) {
    const urls = await searchDDG(query);
    const newUrls = await filterExisting(urls, supabase);

    result.queries_run++;
    result.urls_found += urls.length;
    result.details.push({ query, found: urls.length, new: newUrls.length });

    allNewUrls.push(...newUrls);

    // Rate limit: 2 second between requests
    await new Promise((r) => setTimeout(r, 2000));
  }

  const uniqueNewUrls = [...new Set(allNewUrls)];

  if (uniqueNewUrls.length > 0) {
    const { queued } = await enqueueUrls(
      uniqueNewUrls.map((url) => ({
        url,
        source: 'google', // same source type for scoring
        priority: 35, // slightly lower than SerpAPI (30)
      })),
      supabase
    );
    result.urls_new = queued;
    result.urls_duplicate = result.urls_found - queued;
  }

  await supabase.from('discovery_runs').insert({
    source: 'duckduckgo',
    query_used: queries.join(' | '),
    urls_found: result.urls_found,
    urls_new: result.urls_new,
    urls_duplicate: result.urls_duplicate,
    metadata: { details: result.details },
  });

  return result;
}

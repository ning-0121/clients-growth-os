import { SupabaseClient } from '@supabase/supabase-js';
import { extractDomain } from '@/lib/growth/lead-engine';
import { enqueueUrls } from './source-queue';
import { DiscoveryResult } from './google-discovery';

/**
 * Social Media + E-commerce Store Discovery
 *
 * 3 channels:
 * 1. Instagram — search for brand accounts posting activewear products
 * 2. Shopify stores — find independent e-commerce stores
 * 3. Other platforms — Etsy sellers, Amazon brand stores
 */

// ── Instagram Discovery ──
// Search Google for Instagram accounts in our niche
const IG_QUERIES = [
  // Hashtag-based (finds accounts that use these hashtags)
  'site:instagram.com "#activewear" brand',
  'site:instagram.com "#sportswear" brand',
  'site:instagram.com "#yogawear" brand',
  'site:instagram.com "#athleisure" brand',
  'site:instagram.com "#fitnessbrand" shop',
  'site:instagram.com "#gymwear" brand',
  'site:instagram.com "#activewearbrands"',
  'site:instagram.com "#sportswearbrands"',
  'site:instagram.com "#sustainableactivewear"',
  'site:instagram.com "#performanceapparel"',

  // Bio-based (finds accounts with these in bio)
  'site:instagram.com "activewear" "shop now"',
  'site:instagram.com "sportswear brand" "link in bio"',
  'site:instagram.com "athletic wear" "DM for orders"',
  'site:instagram.com "yoga clothing" "worldwide shipping"',
  'site:instagram.com "fitness apparel" "made in"',
  'site:instagram.com "compression" "sportswear"',
  'site:instagram.com "athleisure" "new collection"',
  'site:instagram.com "gym clothing" "premium"',
];

// ── Shopify Store Discovery ──
const SHOPIFY_QUERIES = [
  '"powered by shopify" activewear brand',
  '"powered by shopify" sportswear',
  '"powered by shopify" yoga wear',
  '"powered by shopify" athletic clothing',
  '"powered by shopify" gym wear brand',
  '"powered by shopify" fitness apparel',
  'site:myshopify.com activewear',
  'site:myshopify.com sportswear brand',
  'site:myshopify.com yoga leggings',
  'site:myshopify.com compression wear',

  // Independent stores
  '"free shipping" activewear brand shop -amazon -ebay',
  '"new arrivals" activewear brand "add to cart"',
  '"shop now" "activewear" "collection" -instagram -facebook',
  '"athletic wear" "our story" brand founded',
  '"yoga pants" brand "shop" "sustainable"',
  '"performance fabric" brand "shop collection"',
];

const SKIP_DOMAINS = [
  'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'pinterest.com',
  'tiktok.com', 'linkedin.com', 'reddit.com', 'quora.com', 'medium.com',
  'amazon.com', 'ebay.com', 'walmart.com', 'target.com',
  'alibaba.com', 'aliexpress.com', 'dhgate.com', 'shein.com', 'temu.com',
  'trustpilot.com', 'yelp.com', 'wikipedia.org',
  'google.com', 'bing.com', 'yahoo.com',
  'forbes.com', 'vogue.com', 'instyle.com', 'cosmopolitan.com',
  'nike.com', 'adidas.com', 'lululemon.com', 'gymshark.com', 'fabletics.com',
  'shopify.com', 'squarespace.com', 'wix.com', 'wordpress.com',
  'github.com', 'apple.com', 'play.google.com',
];

async function searchSerpAPI(query: string, apiKey: string): Promise<string[]> {
  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=10&engine=google`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return [];
    const data = await res.json();
    if (data.error) return [];

    return (data.organic_results || [])
      .map((r: any) => r.link as string)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Extract Instagram handle from URL and find their website
 */
async function processInstagramUrls(
  igUrls: string[],
  apiKey: string,
  existingDomains: Set<string>
): Promise<{ url: string; source: string; priority: number; data: any }[]> {
  const results: { url: string; source: string; priority: number; data: any }[] = [];

  // Extract unique IG handles
  const handles = new Set<string>();
  for (const url of igUrls) {
    const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
    if (match && match[1]) {
      const handle = match[1].toLowerCase();
      // Skip non-brand pages
      if (['p', 'reel', 'stories', 'explore', 'accounts', 'about', 'directory', 'tags'].includes(handle)) continue;
      handles.add(handle);
    }
  }

  // For each handle, search Google for their official website
  for (const handle of [...handles].slice(0, 10)) { // Max 10 to save API calls
    try {
      const query = `"${handle}" official website shop -instagram -facebook`;
      const urls = await searchSerpAPI(query, apiKey);

      const validUrl = urls.find(url => {
        const domain = extractDomain(url);
        return !SKIP_DOMAINS.some(s => domain.includes(s)) &&
               !domain.includes('instagram.com') &&
               !existingDomains.has(domain);
      });

      if (validUrl) {
        // Clean URL
        let cleanedUrl = validUrl;
        try {
          const u = new URL(validUrl);
          ['srsltid', 'utm_source', 'gclid', 'fbclid'].forEach(p => u.searchParams.delete(p));
          if (['/pages/', '/collections/'].some(p => u.pathname.startsWith(p))) {
            cleanedUrl = `${u.protocol}//${u.host}`;
          } else {
            cleanedUrl = u.toString().replace(/\/$/, '');
          }
        } catch {}

        results.push({
          url: cleanedUrl,
          source: 'google', // Will be treated as google source for scoring
          priority: 22, // Higher priority than generic search (IG brands are valuable)
          data: { from_instagram: true, ig_handle: handle },
        });
        existingDomains.add(extractDomain(cleanedUrl));
      }

      await new Promise(r => setTimeout(r, 500)); // Rate limit
    } catch {}
  }

  return results;
}

/**
 * Process Shopify/e-commerce URLs directly
 */
function processEcomUrls(
  urls: string[],
  existingDomains: Set<string>
): { url: string; source: string; priority: number; data: any }[] {
  const results: { url: string; source: string; priority: number; data: any }[] = [];

  for (const rawUrl of urls) {
    let url = rawUrl;
    const domain = extractDomain(url);

    if (SKIP_DOMAINS.some(s => domain.includes(s))) continue;
    if (existingDomains.has(domain)) continue;

    // Convert myshopify.com URLs to the real domain if possible
    // (myshopify.com URLs often redirect to the real domain)
    try {
      const u = new URL(url);
      ['srsltid', 'utm_source', 'gclid'].forEach(p => u.searchParams.delete(p));
      if (['/pages/', '/collections/', '/products/'].some(p => u.pathname.startsWith(p))) {
        url = `${u.protocol}//${u.host}`;
      } else {
        url = u.toString().replace(/\/$/, '');
      }
    } catch {}

    results.push({
      url,
      source: 'google',
      priority: 25,
      data: { from_ecommerce_search: true },
    });
    existingDomains.add(extractDomain(url));
  }

  return results;
}

/**
 * Main social + e-commerce discovery function
 */
export async function discoverFromSocialAndEcom(
  supabase: SupabaseClient,
  maxQueries = 8
): Promise<DiscoveryResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error('SERPAPI_KEY not configured');

  const result: DiscoveryResult = {
    queries_run: 0, urls_found: 0, urls_new: 0, urls_duplicate: 0, details: [],
  };

  // Load existing domains
  const { data: existingLeads } = await supabase
    .from('growth_leads').select('website').not('website', 'is', null);
  const { data: existingQueue } = await supabase
    .from('lead_source_queue').select('target_url').not('target_url', 'is', null);

  const existingDomains = new Set([
    ...(existingLeads || []).map((l: any) => extractDomain(l.website)),
    ...(existingQueue || []).map((q: any) => extractDomain(q.target_url)),
  ]);

  // Rotate through queries
  const now = new Date();
  const allQueries = [...IG_QUERIES, ...SHOPIFY_QUERIES];
  const offset = ((now.getDate() * 24 + now.getHours()) * 7) % allQueries.length;
  const selectedQueries = Array.from({ length: maxQueries }, (_, i) =>
    allQueries[(offset + i) % allQueries.length]
  );

  const allUrlsToEnqueue: { url: string; source: string; priority: number; data: any }[] = [];

  for (const query of selectedQueries) {
    const isIgQuery = query.includes('instagram.com');
    const urls = await searchSerpAPI(query, apiKey);

    result.queries_run++;
    result.urls_found += urls.length;

    if (isIgQuery) {
      // IG URLs need extra processing: extract handle → search for website
      const processed = await processInstagramUrls(urls, apiKey, existingDomains);
      allUrlsToEnqueue.push(...processed);
      result.details.push({ query: query.slice(0, 60), found: urls.length, new: processed.length });
    } else {
      // E-commerce URLs can go directly
      const processed = processEcomUrls(urls, existingDomains);
      allUrlsToEnqueue.push(...processed);
      result.details.push({ query: query.slice(0, 60), found: urls.length, new: processed.length });
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Enqueue all
  if (allUrlsToEnqueue.length > 0) {
    const { queued } = await enqueueUrls(allUrlsToEnqueue, supabase);
    result.urls_new = queued;
    result.urls_duplicate = result.urls_found - queued;
  }

  // Log
  await supabase.from('discovery_runs').insert({
    source: 'social_ecom',
    query_used: selectedQueries.map(q => q.slice(0, 50)).join(' | '),
    urls_found: result.urls_found,
    urls_new: result.urls_new,
    urls_duplicate: result.urls_duplicate,
    metadata: { details: result.details },
  });

  return result;
}

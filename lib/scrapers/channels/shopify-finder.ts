import { SupabaseClient } from '@supabase/supabase-js';
import { runSync } from '../apify-client';
import { enqueueUrls } from '../source-queue';

/**
 * Shopify Store Finder — dual-mode:
 *
 * 1. FORWARD: Given a keyword/category → discover new Shopify stores
 *    Uses Apify actor `igolaizola/shopify-store-finder` or SerpAPI fallback.
 *    Good for: "find me all activewear Shopify brands"
 *
 * 2. REVERSE: Given a brand name → find their Shopify store URL
 *    Uses SerpAPI + Shopify fingerprint check.
 *    Good for: "Amazon seller XYZ LLC — what's their real website?"
 */

const SHOPIFY_FINGERPRINTS = [
  'cdn.shopify.com',
  'myshopify.com',
  '/apps/shopify',
  'Shopify.shop',
  'shopify-payment-button',
];

/**
 * Check if a URL is a Shopify store by fingerprint detection.
 * Cheap — just fetches HTML and greps for markers.
 */
export async function isShopifyStore(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthOS/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return false;
    const html = await res.text();
    return SHOPIFY_FINGERPRINTS.some((f) => html.includes(f));
  } catch {
    return false;
  }
}

/**
 * Given a Shopify URL, pull basic store info from /products.json (public endpoint).
 * Returns product count, top products, and helpful signals.
 */
export async function getShopifyStoreInfo(url: string): Promise<{
  product_count?: number;
  top_products?: { title: string; price?: string; vendor?: string }[];
  product_types?: string[];
} | null> {
  try {
    const base = new URL(url);
    const productsUrl = `${base.protocol}//${base.host}/products.json?limit=50`;
    const res = await fetch(productsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthOS/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const products = data.products || [];

    return {
      product_count: products.length,
      top_products: products.slice(0, 5).map((p: any) => ({
        title: p.title,
        price: p.variants?.[0]?.price,
        vendor: p.vendor,
      })),
      product_types: Array.from(new Set(products.map((p: any) => p.product_type).filter(Boolean))),
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// REVERSE MODE: brand name → Shopify/independent website URL
// ──────────────────────────────────────────────────────────────────

/**
 * Given a brand/business name (e.g. from Amazon), find their real independent website.
 *
 * Strategy:
 * 1. SerpAPI search for name + qualifiers, filter out marketplaces
 * 2. Check top 3 results for Shopify fingerprint
 * 3. Return the first confirmed Shopify (or first clean match)
 */
export async function resolveWebsiteFromBrandName(
  brandName: string
): Promise<{ website?: string; is_shopify?: boolean; product_count?: number; confidence: number } | null> {
  if (!brandName || brandName.length < 2) return null;

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return null;

  const SKIP = [
    'amazon.com', 'amazon.co', 'ebay.com', 'etsy.com', 'walmart.com',
    'alibaba.com', 'aliexpress.com', 'shopify.com', // skip the SaaS itself
    'faire.com', 'trustpilot.com', 'yelp.com', 'bbb.org',
    'linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com',
    'pinterest.com', 'tiktok.com', 'youtube.com',
    'crunchbase.com', 'zoominfo.com', 'dnb.com',
    'wikipedia.org', 'wikihow.com',
  ];

  // Try a focused query first: name + exclude marketplaces
  const query = `"${brandName}" -site:amazon.com -site:ebay.com -site:etsy.com`;
  const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=8&engine=google`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();

    const results = (data.organic_results || []).filter((r: any) => {
      const link = r.link || '';
      if (!link) return false;
      try {
        const h = new URL(link).hostname.replace(/^www\./, '');
        return !SKIP.some((s) => h.includes(s));
      } catch {
        return false;
      }
    });

    // Check top 3 for Shopify fingerprint
    for (const r of results.slice(0, 3)) {
      try {
        const u = new URL(r.link);
        const rootUrl = `${u.protocol}//${u.host}`;
        const isShopify = await isShopifyStore(rootUrl);
        if (isShopify) {
          const info = await getShopifyStoreInfo(rootUrl);
          return {
            website: rootUrl,
            is_shopify: true,
            product_count: info?.product_count,
            confidence: 85, // High confidence — Shopify fingerprint confirmed
          };
        }
      } catch {
        // continue to next result
      }
    }

    // No Shopify confirmed — return the top non-marketplace result (medium confidence)
    if (results.length > 0) {
      try {
        const top = new URL(results[0].link);
        return {
          website: `${top.protocol}//${top.host}`,
          is_shopify: false,
          confidence: 55, // Lower — manual verification recommended
        };
      } catch {}
    }

    return null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// FORWARD MODE: keyword → new Shopify stores
// ──────────────────────────────────────────────────────────────────

export interface ShopifyDiscoveryResult {
  total_found: number;
  shopify_confirmed: number;
  urls_queued: number;
  duplicates: number;
  sample: Array<{ store: string; product_count?: number }>;
  error?: string;
}

/**
 * Discover new Shopify stores matching apparel keywords.
 *
 * Uses SerpAPI for the search (cheaper than Apify store-finder for small batches)
 * with Shopify fingerprint verification.
 */
export async function discoverShopifyStores(
  supabase: SupabaseClient,
  opts: { keywords?: string[]; maxPerKeyword?: number } = {}
): Promise<ShopifyDiscoveryResult> {
  const apiKey = process.env.SERPAPI_KEY;
  const result: ShopifyDiscoveryResult = {
    total_found: 0,
    shopify_confirmed: 0,
    urls_queued: 0,
    duplicates: 0,
    sample: [],
  };

  if (!apiKey) {
    result.error = 'SERPAPI_KEY not configured';
    return result;
  }

  const DEFAULT_KEYWORDS = [
    '"shop now" activewear leggings',
    '"add to cart" yoga wear brand',
    '"free shipping" athleisure brand',
    '"powered by shopify" fitness apparel',
    '"shop now" compression wear brand',
  ];

  const keywords = opts.keywords || DEFAULT_KEYWORDS.slice(0, 3);
  const maxPerKeyword = opts.maxPerKeyword || 8;

  const SKIP = [
    'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'shopify.com',
    'alibaba.com', 'aliexpress.com', 'faire.com',
    'pinterest.com', 'facebook.com', 'youtube.com', 'tiktok.com',
    'reddit.com', 'quora.com', 'wikipedia.org',
    'nike.com', 'adidas.com', 'lululemon.com', 'gymshark.com',
  ];

  const seenHosts = new Set<string>();
  const queueItems: { url: string; source: string; priority: number; data: any }[] = [];

  for (const kw of keywords) {
    try {
      const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(kw)}&num=${maxPerKeyword}&engine=google`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json();

      for (const r of data.organic_results || []) {
        const link = r.link as string;
        if (!link) continue;
        try {
          const u = new URL(link);
          const host = u.hostname.replace(/^www\./, '');
          if (seenHosts.has(host)) continue;
          if (SKIP.some((s) => host.endsWith(s))) continue;
          seenHosts.add(host);

          const rootUrl = `${u.protocol}//${u.host}`;
          result.total_found++;

          // Verify Shopify fingerprint
          const isShopify = await isShopifyStore(rootUrl);
          if (!isShopify) continue;
          result.shopify_confirmed++;

          // Fetch product info for scoring
          const info = await getShopifyStoreInfo(rootUrl);

          // Priority: more products = more established; few products = early stage (better target!)
          let priority = 20;
          if (info && info.product_count !== undefined) {
            if (info.product_count < 20) priority = 28; // indie brand — needs factory
            else if (info.product_count < 100) priority = 25;
            else priority = 18; // established — less urgent
          }

          queueItems.push({
            url: rootUrl,
            source: 'directory',
            priority,
            data: {
              shopify_verified: true,
              product_count: info?.product_count,
              top_products: info?.top_products,
              product_types: info?.product_types,
              discovery_keyword: kw,
              channel: 'shopify',
              found_at: new Date().toISOString(),
            },
          });

          if (result.sample.length < 5) {
            result.sample.push({ store: host, product_count: info?.product_count });
          }
        } catch {}
      }

      // Pace between keywords
      await new Promise((r) => setTimeout(r, 600));
    } catch {}
  }

  if (queueItems.length > 0) {
    const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
    result.urls_queued = queued;
    result.duplicates = duplicates;
  }

  try {
    await supabase.from('discovery_runs').insert({
      source: 'shopify',
      query_used: keywords.join(' | '),
      urls_found: result.total_found,
      urls_new: result.urls_queued,
      metadata: { shopify_confirmed: result.shopify_confirmed },
    });
  } catch {}

  return result;
}

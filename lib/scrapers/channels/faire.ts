import { SupabaseClient } from '@supabase/supabase-js';
import { runSync } from '../apify-client';
import { enqueueUrls } from '../source-queue';
import { extractDomain } from '@/lib/growth/lead-engine';
import { smartSearch } from '../search-providers';

/**
 * Faire.com brand discovery via Apify actor `devcake/faire-data-scraper`.
 *
 * Faire is the #1 wholesale marketplace for small brands in the US.
 * Returns 84 fields per brand including: name, website, Instagram handle,
 * wholesale price, MOQ, lead_time, women_owned badge, etc.
 *
 * Brands with LOW MOQ + LONG lead_time = just-launched = MOST likely
 * to need manufacturing partners.
 */

export interface FaireBrandResult {
  brand_name: string;
  website?: string;
  instagram_handle?: string;
  category?: string;
  min_order?: number;
  lead_time_days?: number;
  women_owned?: boolean;
  eco_friendly?: boolean;
  made_in_country?: string;
  contact_email?: string;
}

export interface FaireDiscoveryResult {
  total_found: number;
  urls_queued: number;
  duplicates: number;
  brands_with_email: number;
  brands_with_ig: number;
  sample: Array<{ brand: string; website?: string; ig?: string; email?: string }>;
  error?: string;
}

// Apparel categories on Faire
const APPAREL_CATEGORY_URLS = [
  'https://www.faire.com/category/womens',
  'https://www.faire.com/category/mens',
  'https://www.faire.com/category/activewear',
  'https://www.faire.com/category/intimates-sleepwear',
  'https://www.faire.com/category/kids-baby/clothing',
];

const SKIP_DOMAINS = [
  'faire.com', 'shopify.com', 'amazon.com', 'etsy.com', 'instagram.com',
  'facebook.com', 'pinterest.com', 'tiktok.com',
];

function cleanUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/**
 * Discover Faire brands that are likely to need manufacturing.
 *
 * @param supabase Supabase client (for deduplication and queuing)
 * @param opts.maxBrandsPerCategory how many brands to pull per category (default 50)
 * @param opts.categoryUrl override default categories, scrape just one
 */
export async function discoverFromFaire(
  supabase: SupabaseClient,
  opts: { maxBrandsPerCategory?: number; categoryUrl?: string } = {}
): Promise<FaireDiscoveryResult> {
  const { maxBrandsPerCategory = 50, categoryUrl } = opts;
  const result: FaireDiscoveryResult = {
    total_found: 0,
    urls_queued: 0,
    duplicates: 0,
    brands_with_email: 0,
    brands_with_ig: 0,
    sample: [],
  };

  const targetCategories = categoryUrl ? [categoryUrl] : APPAREL_CATEGORY_URLS.slice(0, 2);

  // If Apify key not configured, fall back to search-based discovery
  if (!process.env.APIFY_API_KEY) {
    return discoverFromFaireFallback(supabase, targetCategories);
  }

  try {
    // Run Apify actor — it accepts category URLs as input
    const input = {
      startUrls: targetCategories.map((url) => ({ url })),
      maxItems: maxBrandsPerCategory * targetCategories.length,
      // Filter to US-made or non-China-made brands (they need local manufacturing = us!)
      // Or to the opposite: China-made brands (they already have a factory but might switch)
      country: 'US',
    };

    const brands: FaireBrandResult[] = await runSync('devcake/faire-data-scraper', input, {
      timeoutMs: 55000,
      maxItems: 300,
    });

    result.total_found = brands.length;

    // Build queue items
    // 'directory' is accepted by lead_source_queue constraint; actual channel is tracked in data.channel
    const queueItems: { url: string; source: string; priority: number; data: any }[] = [];

    for (const brand of brands) {
      if (brand.instagram_handle) result.brands_with_ig++;
      if (brand.contact_email) result.brands_with_email++;

      // Priority: higher for brands with direct signals
      let priority = 15;
      if (brand.min_order && brand.min_order < 500) priority += 10; // small MOQ = small brand = good target
      if (brand.women_owned) priority += 5;
      if (brand.contact_email) priority += 15;

      // Add website URL to queue
      if (brand.website) {
        const cleaned = cleanUrl(brand.website);
        if (cleaned && !SKIP_DOMAINS.some((d) => cleaned.includes(d))) {
          queueItems.push({
            url: cleaned,
            source: 'directory',
            priority,
            data: {
              faire_brand: brand.brand_name,
              instagram_handle: brand.instagram_handle,
              category: brand.category,
              min_order: brand.min_order,
              lead_time_days: brand.lead_time_days,
              women_owned: brand.women_owned,
              eco_friendly: brand.eco_friendly,
              made_in_country: brand.made_in_country,
              faire_found_at: new Date().toISOString(),
              pre_fetched_email: brand.contact_email,
              channel: 'faire',
            },
          });
        }
      }
    }

    if (queueItems.length > 0) {
      const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
      result.urls_queued = queued;
      result.duplicates = duplicates;
    }

    // Build sample for response
    result.sample = brands.slice(0, 5).map((b) => ({
      brand: b.brand_name,
      website: b.website,
      ig: b.instagram_handle,
      email: b.contact_email,
    }));

    // Log discovery run (best-effort, don't break on error)
    try {
      await supabase.from('discovery_runs').insert({
        source: 'faire',
        query_used: targetCategories.join(' | '),
        urls_found: result.total_found,
        urls_new: result.urls_queued,
        metadata: {
          brands_with_email: result.brands_with_email,
          brands_with_ig: result.brands_with_ig,
        },
      });
    } catch {}

    return result;
  } catch (err: any) {
    result.error = err.message;
    return result;
  }
}

// Search-based fallback when APIFY_API_KEY is not configured.
// Uses smartSearch (Brave/DataForSEO/SerpAPI) to find faire.com/brand/* URLs,
// then fetches each page to extract the brand's external website.
// Yields fewer brands than Apify (~10-20/run vs 50) but costs nothing extra.
async function discoverFromFaireFallback(
  supabase: SupabaseClient,
  targetCategories: string[]
): Promise<FaireDiscoveryResult> {
  const result: FaireDiscoveryResult = {
    total_found: 0, urls_queued: 0, duplicates: 0,
    brands_with_email: 0, brands_with_ig: 0, sample: [],
  };

  const FAIRE_SEARCH_QUERIES = [
    'site:faire.com/brand activewear yoga sportswear',
    'site:faire.com/brand gym clothing workout apparel',
    'site:faire.com/brand running apparel athletic wear',
  ];

  const brandUrls = new Set<string>();

  for (const q of FAIRE_SEARCH_QUERIES.slice(0, 2)) {
    const results = await smartSearch(q, { maxResults: 10 });
    for (const r of results) {
      if (r.url.includes('faire.com/brand/')) {
        try {
          const u = new URL(r.url);
          // Normalize to brand root: faire.com/brand/slug
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts[0] === 'brand' && parts[1]) {
            brandUrls.add(`https://www.faire.com/brand/${parts[1]}`);
          }
        } catch {}
      }
    }
  }

  result.total_found = brandUrls.size;
  if (brandUrls.size === 0) return result;

  const queueItems: { url: string; source: string; priority: number; data: any }[] = [];

  for (const brandPageUrl of brandUrls) {
    try {
      const res = await fetch(brandPageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Extract brand website — Faire pages typically have og:url or a canonical link to the brand site
      const websiteMatch = html.match(/["']https?:\/\/(?!(?:www\.)?faire\.com)[^"'\s>]{5,}["']/);
      const brandNameMatch = html.match(/<title>([^<]+)<\/title>/);
      const brandName = brandNameMatch?.[1]?.replace(/ on Faire$/, '').trim() || brandPageUrl;

      let website: string | null = null;
      if (websiteMatch) {
        const raw = websiteMatch[0].replace(/["']/g, '');
        const domain = extractDomain(raw);
        if (domain && !SKIP_DOMAINS.some(d => domain.includes(d))) {
          website = `https://${domain}`;
        }
      }

      if (website) {
        queueItems.push({
          url: website,
          source: 'directory',
          priority: 15,
          data: { faire_brand: brandName, channel: 'faire', via: 'search_fallback' },
        });
      }
    } catch {}
  }

  if (queueItems.length > 0) {
    const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
    result.urls_queued = queued;
    result.duplicates = duplicates;
  }

  result.sample = queueItems.slice(0, 5).map(i => ({
    brand: i.data.faire_brand, website: i.url,
  }));

  try {
    await supabase.from('discovery_runs').insert({
      source: 'faire',
      query_used: 'search_fallback (no APIFY_API_KEY)',
      urls_found: result.total_found,
      urls_new: result.urls_queued,
      metadata: { via: 'search_fallback' },
    });
  } catch {}

  return result;
}

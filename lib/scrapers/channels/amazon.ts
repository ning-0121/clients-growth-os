import { SupabaseClient } from '@supabase/supabase-js';
import { runSync } from '../apify-client';
import { enqueueUrls } from '../source-queue';
import { extractDomain } from '@/lib/growth/lead-engine';
import { resolveWebsiteFromBrandName } from './shopify-finder';

/**
 * Amazon seller discovery via Apify actor `junglee/amazon-seller-scraper`.
 *
 * Strategy: Amazon doesn't expose seller emails directly. We get business
 * names from the seller database, then later in the pipeline use SerpAPI
 * to find their independent website and Tomba to find wholesale emails.
 *
 * Best targets: FBA sellers in apparel bestsellers — they have Brand Registry
 * and actively need manufacturing.
 */

export interface AmazonSellerResult {
  seller_id?: string;
  business_name?: string;
  store_name?: string;
  brand?: string;
  seller_url?: string;
  rating?: number;
  num_ratings?: number;
  address?: string;
  phone?: string;
  country?: string;
}

export interface AmazonDiscoveryResult {
  total_found: number;
  urls_queued: number;
  duplicates: number;
  brands_with_business_name: number;
  brands_with_phone: number;
  websites_resolved: number;
  shopify_confirmed: number;
  sample: Array<{ brand: string; business_name?: string; country?: string; website?: string }>;
  error?: string;
}

// Amazon US apparel bestsellers — refreshed daily
const APPAREL_BESTSELLER_URLS = [
  'https://www.amazon.com/Best-Sellers-Clothing-Shoes-Jewelry/zgbs/fashion',
  'https://www.amazon.com/Best-Sellers-Clothing-Shoes-Jewelry-Womens-Activewear/zgbs/fashion/1045024',
  'https://www.amazon.com/Best-Sellers-Clothing-Shoes-Jewelry-Mens-Activewear/zgbs/fashion/1044998',
  'https://www.amazon.com/Best-Sellers-Clothing-Shoes-Jewelry-Womens-Athletic-Clothing/zgbs/fashion/1045425',
];

export async function discoverFromAmazon(
  supabase: SupabaseClient,
  opts: { maxSellers?: number; bestsellerUrl?: string; keyword?: string; resolveWebsites?: boolean; maxResolveCount?: number } = {}
): Promise<AmazonDiscoveryResult> {
  const { maxSellers = 50, bestsellerUrl, keyword, resolveWebsites = true, maxResolveCount = 10 } = opts;
  const result: AmazonDiscoveryResult = {
    total_found: 0,
    urls_queued: 0,
    duplicates: 0,
    brands_with_business_name: 0,
    brands_with_phone: 0,
    websites_resolved: 0,
    shopify_confirmed: 0,
    sample: [],
  };

  try {
    const input: any = { maxItems: maxSellers };
    if (keyword) input.keywords = [keyword];
    else input.startUrls = [{ url: bestsellerUrl || APPAREL_BESTSELLER_URLS[0] }];

    const sellers: AmazonSellerResult[] = await runSync('junglee/amazon-seller-scraper', input, {
      timeoutMs: 55000,
      maxItems: 200,
    });

    result.total_found = sellers.length;

    // For Amazon, we don't get the brand's own website directly.
    // Instead, we queue the seller_url to be processed by the main pipeline
    // which will do SerpAPI search: "XYZ LLC" -amazon.com to find independent site.
    // If that fails, we still have business_name for manual outreach.

    const queueItems: { url: string; source: string; priority: number; data: any }[] = [];
    let resolveBudget = maxResolveCount;

    for (const seller of sellers) {
      const name = seller.business_name || seller.brand || seller.store_name;
      if (!name) continue;

      if (seller.business_name) result.brands_with_business_name++;
      if (seller.phone) result.brands_with_phone++;

      // Try to resolve business_name → real website (Shopify/independent site)
      // Only for top N sellers to stay within Vercel timeout
      let resolvedWebsite: string | undefined;
      let isShopify = false;
      let productCount: number | undefined;

      if (resolveWebsites && resolveBudget > 0 && seller.business_name) {
        try {
          const resolved = await resolveWebsiteFromBrandName(seller.business_name);
          if (resolved?.website) {
            resolvedWebsite = resolved.website;
            isShopify = !!resolved.is_shopify;
            productCount = resolved.product_count;
            result.websites_resolved++;
            if (isShopify) result.shopify_confirmed++;
          }
        } catch {}
        resolveBudget--;
      }

      // Priority: higher for resolved Shopify stores (highest quality leads)
      let priority = 12;
      if (isShopify) priority = 26;
      else if (resolvedWebsite) priority = 20;

      // Enqueue: prefer resolved independent website over amazon URL
      const enqueueUrl = resolvedWebsite || seller.seller_url;
      if (enqueueUrl) {
        queueItems.push({
          url: enqueueUrl,
          source: 'directory',
          priority,
          data: {
            amazon_business_name: seller.business_name,
            amazon_brand: seller.brand,
            amazon_store_name: seller.store_name,
            amazon_seller_id: seller.seller_id,
            amazon_phone: seller.phone,
            amazon_address: seller.address,
            amazon_country: seller.country,
            amazon_rating: seller.rating,
            amazon_url: seller.seller_url,
            channel: resolvedWebsite ? 'amazon+shopify' : 'amazon',
            shopify_verified: isShopify,
            product_count: productCount,
            needs_website_lookup: !resolvedWebsite, // still flag if we haven't resolved
          },
        });
      }
    }

    if (queueItems.length > 0) {
      const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
      result.urls_queued = queued;
      result.duplicates = duplicates;
    }

    // Build sample from queue items (so we show the resolved website)
    result.sample = queueItems.slice(0, 5).map((q) => ({
      brand: q.data.amazon_brand || q.data.amazon_store_name || q.data.amazon_business_name || '(unknown)',
      business_name: q.data.amazon_business_name,
      country: q.data.amazon_country,
      website: q.url !== q.data.amazon_url ? q.url : undefined,
    }));

    try {
      await supabase.from('discovery_runs').insert({
        source: 'amazon',
        query_used: keyword || bestsellerUrl || 'default_bestsellers',
        urls_found: result.total_found,
        urls_new: result.urls_queued,
        metadata: {
          brands_with_business_name: result.brands_with_business_name,
          brands_with_phone: result.brands_with_phone,
          websites_resolved: result.websites_resolved,
          shopify_confirmed: result.shopify_confirmed,
        },
      });
    } catch {}

    return result;
  } catch (err: any) {
    result.error = err.message;
    return result;
  }
}

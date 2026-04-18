import { SupabaseClient } from '@supabase/supabase-js';
import { runSync } from '../apify-client';
import { enqueueUrls } from '../source-queue';
import { extractDomain } from '@/lib/growth/lead-engine';

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
  sample: Array<{ brand: string; business_name?: string; country?: string }>;
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
  opts: { maxSellers?: number; bestsellerUrl?: string; keyword?: string } = {}
): Promise<AmazonDiscoveryResult> {
  const { maxSellers = 50, bestsellerUrl, keyword } = opts;
  const result: AmazonDiscoveryResult = {
    total_found: 0,
    urls_queued: 0,
    duplicates: 0,
    brands_with_business_name: 0,
    brands_with_phone: 0,
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

    for (const seller of sellers) {
      const name = seller.business_name || seller.brand || seller.store_name;
      if (!name) continue;

      if (seller.business_name) result.brands_with_business_name++;
      if (seller.phone) result.brands_with_phone++;

      // Amazon seller_url is not ideal as the seed URL (it's amazon.com)
      // Better: use a synthetic URL that triggers SerpAPI lookup
      // We'll put the seller_url but give priority to the search step
      if (seller.seller_url) {
        queueItems.push({
          url: seller.seller_url,
          source: 'directory',
          priority: 12,
          data: {
            amazon_business_name: seller.business_name,
            amazon_brand: seller.brand,
            amazon_store_name: seller.store_name,
            amazon_seller_id: seller.seller_id,
            amazon_phone: seller.phone,
            amazon_address: seller.address,
            amazon_country: seller.country,
            amazon_rating: seller.rating,
            channel: 'amazon',
            needs_website_lookup: true, // flag: pipeline should search for their real website
          },
        });
      }
    }

    if (queueItems.length > 0) {
      const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
      result.urls_queued = queued;
      result.duplicates = duplicates;
    }

    result.sample = sellers.slice(0, 5).map((s) => ({
      brand: s.brand || s.store_name || '(unknown)',
      business_name: s.business_name,
      country: s.country,
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
        },
      });
    } catch {}

    return result;
  } catch (err: any) {
    result.error = err.message;
    return result;
  }
}

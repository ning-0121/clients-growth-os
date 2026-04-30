/**
 * TikTok Shop Brand Discovery
 *
 * Many emerging US apparel/fashion brands sell on TikTok Shop before scaling
 * to wholesale. This channel finds them via search and queues their brand
 * websites as leads. High intent: brands actively selling = budget to source.
 *
 * Strategy:
 * 1. Search for apparel brands on TikTok Shop via SerpAPI/Brave
 * 2. Extract brand handles + website URLs from results
 * 3. Resolve brand website (bio link, Linktree, or direct domain)
 * 4. Enqueue with priority 25–30 (high intent, growing brand signal)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { smartSearch } from '@/lib/scrapers/search-providers';
import { enqueueUrls } from '@/lib/scrapers/source-queue';

const TIKTOK_QUERIES = [
  'tiktok shop women apparel clothing brand US boutique',
  'tiktok shop fashion brand women dress site:tiktok.com',
  '"tiktok shop" women activewear athleisure brand',
  '"shop now on tiktok" women clothing brand boutique',
  'tiktok creator shop women fashion brand wholesale',
  'tiktok shop swimwear women brand US',
  'tiktok shop women loungewear brand boutique US',
];

// Domains to skip (platform/social pages, not brand sites)
const SKIP_DOMAINS = [
  'tiktok.com', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com',
  'youtube.com', 'pinterest.com', 'linkedin.com', 'amazon.com', 'etsy.com',
  'shopify.com', 'wix.com', 'squarespace.com', 'wordpress.com',
];

// Big brands to skip
const SKIP_BRAND_KEYWORDS = [
  'shein', 'zara', 'h&m', 'forever21', 'asos', 'fashion nova', 'prettylittlething',
  'revolve', 'nordstrom', 'macy', 'target', 'walmart', 'amazon',
];

function isSkippedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SKIP_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
  } catch { return true; }
}

function isBigBrand(text: string): boolean {
  const lower = text.toLowerCase();
  return SKIP_BRAND_KEYWORDS.some(b => lower.includes(b));
}

/**
 * Try to resolve a brand's actual website from a TikTok profile page.
 * TikTok bio link often points to Linktree or direct brand website.
 */
async function resolveBrandWebsite(tiktokHandle: string): Promise<string | null> {
  try {
    const url = `https://www.tiktok.com/@${tiktokHandle}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Try og:url or canonical for the profile, and look for bio link in JSON-LD
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';

    // TikTok embeds user data in a __UNIVERSAL_DATA__ script
    const scripts = $('script').toArray();
    for (const script of scripts) {
      const content = $(script).html() || '';
      if (content.includes('bioLink') || content.includes('bio_link')) {
        const match = content.match(/"bio[Ll]ink"\s*:\s*"(https?:\/\/[^"]+)"/);
        if (match) return match[1];
      }
    }

    // Fallback: check description for URL pattern
    const urlMatch = ogDesc.match(/https?:\/\/[^\s"']+/);
    return urlMatch ? urlMatch[0] : null;
  } catch {
    return null;
  }
}

/**
 * Extract TikTok handle from a URL if it's a TikTok profile URL.
 */
function extractTikTokHandle(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('tiktok.com')) return null;
    const match = u.pathname.match(/^\/@([\w.]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

export interface TikTokDiscoveryResult {
  queries_run: number;
  profiles_found: number;
  urls_queued: number;
  duplicates: number;
  error?: string;
}

export async function discoverFromTikTokShop(
  supabase: SupabaseClient,
  opts: { maxQueries?: number; perQueryResults?: number } = {}
): Promise<TikTokDiscoveryResult> {
  const { maxQueries = 4, perQueryResults = 8 } = opts;
  const result: TikTokDiscoveryResult = {
    queries_run: 0,
    profiles_found: 0,
    urls_queued: 0,
    duplicates: 0,
  };

  const queriesToRun = TIKTOK_QUERIES.slice(0, maxQueries);
  const brandWebsites = new Map<string, { handle: string; query: string }>();

  for (const query of queriesToRun) {
    result.queries_run++;
    try {
      const searchResults = await smartSearch(query, { maxResults: perQueryResults });

      for (const r of searchResults) {
        if (isBigBrand(r.title + ' ' + r.snippet)) continue;

        // Case 1: result URL is a TikTok profile → extract handle + resolve website
        const handle = extractTikTokHandle(r.url);
        if (handle) {
          result.profiles_found++;
          // Don't fetch website here — too slow in bulk; queue TikTok URL and
          // let auto-source's fastEnrich handle resolution via bio link
          const key = `https://www.tiktok.com/@${handle}`;
          if (!brandWebsites.has(key)) {
            brandWebsites.set(key, { handle, query });
          }
          continue;
        }

        // Case 2: result URL is a brand website (not TikTok, mentioned in snippet)
        if (!isSkippedDomain(r.url)) {
          const snippet = (r.title + ' ' + r.snippet).toLowerCase();
          // Must mention TikTok Shop context to stay relevant
          if (snippet.includes('tiktok') || snippet.includes('shop')) {
            if (!brandWebsites.has(r.url)) {
              brandWebsites.set(r.url, { handle: '', query });
            }
          }
        }
      }

      // Polite delay between queries
      await new Promise(r => setTimeout(r, 600));
    } catch (err: any) {
      console.error(`[TikTok Shop] Query failed: ${query}`, err.message);
    }
  }

  // Build queue items
  const queueItems = Array.from(brandWebsites.entries()).map(([url, meta]) => ({
    url,
    source: 'tiktok_shop',
    priority: 28,  // high intent — TikTok Shop sellers have budget + sourcing need
    data: {
      channel: 'tiktok_shop',
      tiktok_handle: meta.handle || null,
      discovery_query: meta.query,
      found_at: new Date().toISOString(),
    },
  }));

  if (queueItems.length > 0) {
    const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
    result.urls_queued = queued;
    result.duplicates = duplicates;
  }

  return result;
}

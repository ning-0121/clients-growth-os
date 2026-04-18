import { SupabaseClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { enqueueUrls } from '../source-queue';

/**
 * Instagram brand discovery via SerpAPI Google dork.
 *
 * Why this approach:
 * - Direct IG scraping is unreliable in 2026 (strict anti-bot)
 * - Official Apify IG scrapers do NOT return bio emails (only post data)
 * - Google indexes IG profile pages, so we can search them via SerpAPI
 *
 * Strategy:
 * 1. Run targeted Google dorks like:
 *    site:instagram.com "@gmail.com" "activewear brand"
 *    site:instagram.com "wholesale@" "yoga"
 * 2. SerpAPI returns profile URLs + snippets (which contain bio text)
 * 3. Extract email from snippet with regex
 * 4. Fetch IG page HTML, parse <meta property="og:description"> for full bio
 * 5. Extract external_url from the HTML
 *
 * Result: brands with bio emails are queued with high priority (already verified contact).
 */

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Dork queries targeting brands in buying mode
const IG_DORKS = [
  'site:instagram.com "@gmail.com" "activewear"',
  'site:instagram.com "wholesale@" "apparel"',
  'site:instagram.com "sourcing@" "fashion"',
  'site:instagram.com "@gmail.com" "athleisure"',
  'site:instagram.com "@gmail.com" "streetwear"',
  'site:instagram.com "buying@" "clothing"',
  'site:instagram.com "@gmail.com" "yoga"',
  'site:instagram.com "@gmail.com" "fitness brand"',
  'site:instagram.com "hello@" "swimwear"',
  'site:instagram.com "contact@" "activewear" "new drop"',
];

export interface InstagramDorkResult {
  queries_run: number;
  profiles_found: number;
  emails_extracted: number;
  urls_queued: number;
  duplicates: number;
  sample: Array<{ profile: string; email?: string; snippet?: string }>;
  error?: string;
}

/**
 * Extract IG username from a profile URL like https://www.instagram.com/brandname/
 */
function extractIgHandle(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('instagram.com')) return undefined;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return undefined;
    const handle = parts[0];
    // Skip URL patterns like /p/{post_id} and /reel/
    if (handle === 'p' || handle === 'reel' || handle === 'stories' || handle === 'explore') return undefined;
    return handle;
  } catch {
    return undefined;
  }
}

/**
 * Try to fetch the IG page's og:description meta (usually contains bio preview).
 * Works for public profiles; fails for private/shadow-banned.
 */
async function fetchIgBio(handle: string): Promise<{ bio?: string; externalUrl?: string }> {
  try {
    const res = await fetch(`https://www.instagram.com/${handle}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);

    const bio = $('meta[property="og:description"]').attr('content') || '';
    // IG og:description format: "XX Followers, YY Following, ZZ Posts - See Instagram photos..."
    // Sometimes includes bio text. We keep the whole thing for email extraction.

    // external_url extraction is tricky — IG obfuscates it. Try parsing the bio for URL.
    const urlMatch = bio.match(/https?:\/\/[^\s"']+/);

    return {
      bio,
      externalUrl: urlMatch ? urlMatch[0] : undefined,
    };
  } catch {
    return {};
  }
}

export async function discoverFromInstagramDork(
  supabase: SupabaseClient,
  opts: { maxQueries?: number; perQueryResults?: number } = {}
): Promise<InstagramDorkResult> {
  const { maxQueries = 3, perQueryResults = 10 } = opts;
  const apiKey = process.env.SERPAPI_KEY;

  const result: InstagramDorkResult = {
    queries_run: 0,
    profiles_found: 0,
    emails_extracted: 0,
    urls_queued: 0,
    duplicates: 0,
    sample: [],
  };

  if (!apiKey) {
    result.error = 'SERPAPI_KEY not configured';
    return result;
  }

  // Rotate through dorks based on hour
  const startIdx = new Date().getHours() % IG_DORKS.length;
  const queries = Array.from({ length: maxQueries }, (_, i) => IG_DORKS[(startIdx + i) % IG_DORKS.length]);

  const seenHandles = new Set<string>();
  const queueItems: { url: string; source: string; priority: number; data: any }[] = [];

  for (const query of queries) {
    try {
      const serpUrl = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=${perQueryResults}&engine=google`;
      const res = await fetch(serpUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      result.queries_run++;

      const data = await res.json();
      const organic = data.organic_results || [];

      for (const r of organic) {
        const link = r.link || '';
        const handle = extractIgHandle(link);
        if (!handle || seenHandles.has(handle)) continue;
        seenHandles.add(handle);
        result.profiles_found++;

        // Extract email from snippet
        const snippet = (r.snippet || '') + ' ' + (r.title || '');
        const emailMatches = snippet.match(EMAIL_RE) || [];
        const validEmail = emailMatches.find(
          (e) =>
            !e.includes('instagram.com') &&
            !e.endsWith('.png') &&
            !e.endsWith('.jpg') &&
            e.length < 80
        );

        if (validEmail) result.emails_extracted++;

        // Build queue entry — IG handle URL + metadata
        queueItems.push({
          url: `https://instagram.com/${handle}`,
          source: 'instagram',
          priority: validEmail ? 30 : 18, // Huge bump if email already extracted
          data: {
            instagram_handle: handle,
            pre_fetched_email: validEmail,
            snippet_preview: snippet.slice(0, 300),
            dork_query: query,
            channel: 'instagram_dork',
            found_at: new Date().toISOString(),
          },
        });

        if (result.sample.length < 5) {
          result.sample.push({
            profile: `@${handle}`,
            email: validEmail,
            snippet: snippet.slice(0, 150),
          });
        }
      }

      // Delay between dorks to avoid rate limits
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      // Continue on individual query failures
    }
  }

  if (queueItems.length > 0) {
    const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
    result.urls_queued = queued;
    result.duplicates = duplicates;
  }

  try {
    await supabase.from('discovery_runs').insert({
      source: 'instagram_dork',
      query_used: queries.join(' | '),
      urls_found: result.profiles_found,
      urls_new: result.urls_queued,
      metadata: { emails_extracted: result.emails_extracted },
    });
  } catch {}

  return result;
}

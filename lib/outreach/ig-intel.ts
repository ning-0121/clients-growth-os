/**
 * Pulls recent Instagram post snippets for a brand via SerpAPI.
 * Used by the email generator to reference specific posts/products in
 * the cold email opening — eliminates the "could-be-anyone" feel that
 * kills reply rates.
 */

import { smartSearch } from '@/lib/scrapers/search-providers';

// In-memory cache: prevents duplicate SerpAPI calls for the same handle
// within a single serverless invocation (e.g. batch-processing 50 leads).
// TTL = 4 hours (handles won't post that fast).
const CACHE = new Map<string, { result: InstagramIntel; expiresAt: number }>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export interface InstagramPostRef {
  url: string;          // e.g. https://instagram.com/p/ABC123
  caption_snippet: string;
  kind: 'post' | 'reel' | 'unknown';
}

export interface InstagramIntel {
  handle: string;
  recent_posts: InstagramPostRef[];
  bio_line: string | null;       // one-line bio distillation if captured
}

/**
 * Find recent posts from an IG handle. Strategy: SerpAPI `site:instagram.com/{handle}/p`
 * returns indexed post URLs with snippets from post captions. Not real-time but
 * usually within a few weeks; good enough for cold email personalization.
 */
export async function fetchInstagramIntel(handle: string, options: { maxPosts?: number } = {}): Promise<InstagramIntel> {
  const { maxPosts = 4 } = options;
  const cleaned = handle.replace('@', '').replace(/\/$/, '');

  // Return cached result if fresh
  const cached = CACHE.get(cleaned);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const intel: InstagramIntel = {
    handle: cleaned,
    recent_posts: [],
    bio_line: null,
  };

  // Search for indexed posts from this account
  const query = `site:instagram.com/${cleaned}/p OR site:instagram.com/${cleaned}/reel`;
  let results;
  try {
    results = await smartSearch(query, { maxResults: 10 });
  } catch {
    return intel;
  }

  for (const r of results) {
    if (intel.recent_posts.length >= maxPosts) break;
    if (!r.url.includes(`instagram.com/${cleaned}`)) continue;

    const kind: InstagramPostRef['kind'] =
      r.url.includes('/reel/') ? 'reel' :
      r.url.includes('/p/') ? 'post' : 'unknown';

    // Strip IG's "X Likes, Y Comments - @handle on Instagram: " prefix from snippets
    const raw = (r.snippet || r.title || '').trim();
    const cleanedSnippet = raw
      .replace(/^\d+[\d,]*\s*Likes?,?\s*\d+[\d,]*\s*Comments?\s*-\s*/i, '')
      .replace(/^@?[\w.]+\s+on Instagram:?\s*/i, '')
      .replace(/^"|"$/g, '')
      .trim();

    if (cleanedSnippet.length < 10) continue;

    intel.recent_posts.push({
      url: r.url,
      caption_snippet: cleanedSnippet.slice(0, 300),
      kind,
    });
  }

  // Store in cache before returning
  CACHE.set(cleaned, { result: intel, expiresAt: Date.now() + CACHE_TTL_MS });
  return intel;
}

/**
 * Render the intel as a prompt block that forces the email to reference
 * a specific post, not a generic observation.
 */
export function formatIgIntelForPrompt(intel: InstagramIntel): string {
  if (intel.recent_posts.length === 0) return '';

  const lines = [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `📸 INSTAGRAM INTEL — @${intel.handle}`,
    'These are recent posts from their feed. The opening line of the email',
    'MUST reference ONE specific post below (pick the most concrete / product-',
    'focused one). Do NOT write generic fluff like "love your aesthetic".',
    'Quote a tangible detail: fabric, color, product name, campaign.',
    '',
  ];

  intel.recent_posts.forEach((p, i) => {
    lines.push(`  Post ${i + 1} (${p.kind}): ${p.caption_snippet}`);
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

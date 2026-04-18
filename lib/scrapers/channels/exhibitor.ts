import { SupabaseClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { enqueueUrls } from '../source-queue';

/**
 * Trade show exhibitor list scraping.
 *
 * Strategy: Most trade show sites publish a public exhibitor list page.
 * These companies PAID to exhibit = they have budget + intent to find suppliers/buyers.
 *
 * This scraper uses cheerio (HTML parsing) — no Apify dependency needed.
 * For each exhibitor, we extract: company name + website + booth number + short description.
 *
 * Note: Some shows (MAGIC) use JS-rendered exhibitor lists. For those, we fall
 * back to the Apify actor `skython/exhibitor-list-scraper`.
 */

export interface ExhibitorResult {
  company_name: string;
  website?: string;
  description?: string;
  booth?: string;
  category?: string;
}

export interface ExhibitorDiscoveryResult {
  show_name: string;
  total_found: number;
  urls_queued: number;
  duplicates: number;
  sample: Array<{ company: string; website?: string }>;
  error?: string;
}

// Known apparel trade shows with public exhibitor lists
export const TRADE_SHOWS = {
  'sourcing-at-magic': {
    name: 'Sourcing at MAGIC Las Vegas',
    exhibitor_url: 'https://sourcingatmagic.com/en/sourcing-las-vegas/exhibitor-list.html',
    // HTML extraction pattern
    selector_row: '.exhibitor-item, .exhibitor-card, .exhibitor-listing, [class*="exhibitor"]',
    js_rendered: false,
  },
  'magic': {
    name: 'MAGIC Las Vegas',
    exhibitor_url: 'https://magicfashionevents.com/events/magic-las-vegas/exhibitors',
    selector_row: '.exhibitor-card, [class*="exhibitor"]',
    js_rendered: true, // use Apify
  },
  'coterie': {
    name: 'Coterie',
    exhibitor_url: 'https://coterienewyork.com/exhibitors',
    selector_row: '.exhibitor, .brand-card',
    js_rendered: true,
  },
  'project-show': {
    name: 'Project Show Las Vegas',
    exhibitor_url: 'https://www.projectshow.com/en/las-vegas/exhibitors.html',
    selector_row: '.exhibitor-item',
    js_rendered: false,
  },
} as const;

const SKIP_DOMAINS = [
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'tiktok.com', 'pinterest.com',
  'magicfashionevents.com', 'sourcingatmagic.com', 'coterienewyork.com',
];

function extractCompanyWebsite(href: string | undefined, baseUrl: string): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href, baseUrl);
    const domain = u.hostname.replace(/^www\./, '');
    if (SKIP_DOMAINS.some((d) => domain.endsWith(d))) return undefined;
    // Skip relative links back to the show itself
    if (domain.includes('magic') || domain.includes('coterie') || domain.includes('sourcingatmagic')) return undefined;
    return `https://${domain}`;
  } catch {
    return undefined;
  }
}

/**
 * Scrape a trade show exhibitor list (HTML-based shows only).
 * For JS-rendered shows, use the Apify-backed version in apify-exhibitor.ts.
 */
async function scrapeExhibitorHtml(
  showUrl: string,
  selector: string
): Promise<ExhibitorResult[]> {
  const results: ExhibitorResult[] = [];

  try {
    const res = await fetch(showUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);

    // Try the primary selector, fall back to generic patterns
    const selectors = [selector, '[class*="exhibitor"]', '[class*="brand-card"]', 'article', '.listing-item'];

    let rows: any = null;
    for (const sel of selectors) {
      rows = $(sel);
      if (rows.length > 3) break; // Good selector found
    }

    if (!rows || rows.length === 0) {
      // Last resort: find all anchors that look like exhibitor links
      $('a[href*="exhibitor"], a[href*="/brand/"], a[href*="/company/"]').each((_, el) => {
        const $el = $(el);
        const name = $el.text().trim().slice(0, 100);
        const href = $el.attr('href');
        if (name && name.length > 2 && href) {
          results.push({
            company_name: name,
            website: extractCompanyWebsite(href, showUrl),
          });
        }
      });
      return results.slice(0, 300);
    }

    rows.each((_: any, el: any) => {
      const $row = $(el);
      const name =
        $row.find('h1, h2, h3, h4, .name, .title, .company-name').first().text().trim() ||
        $row.find('a').first().text().trim();
      if (!name || name.length < 2) return;

      const websiteLink = $row.find('a[href^="http"]').filter((_: any, a: any) => {
        const href = $(a).attr('href') || '';
        return !href.includes(new URL(showUrl).host);
      }).first().attr('href');

      const description = $row.find('.description, .bio, p').first().text().trim().slice(0, 300);
      const booth = $row.find('.booth, .booth-number').first().text().trim();

      results.push({
        company_name: name.slice(0, 120),
        website: extractCompanyWebsite(websiteLink, showUrl),
        description: description || undefined,
        booth: booth || undefined,
      });
    });

    return results;
  } catch {
    return [];
  }
}

export async function discoverFromTradeShow(
  supabase: SupabaseClient,
  showKey: keyof typeof TRADE_SHOWS
): Promise<ExhibitorDiscoveryResult> {
  const show = TRADE_SHOWS[showKey];
  const result: ExhibitorDiscoveryResult = {
    show_name: show.name,
    total_found: 0,
    urls_queued: 0,
    duplicates: 0,
    sample: [],
  };

  if (show.js_rendered) {
    result.error = `${show.name} requires JS rendering — use Apify exhibitor-list-scraper instead`;
    return result;
  }

  try {
    const exhibitors = await scrapeExhibitorHtml(show.exhibitor_url, show.selector_row);
    result.total_found = exhibitors.length;

    const queueItems: { url: string; source: string; priority: number; data: any }[] = [];

    for (const ex of exhibitors) {
      if (!ex.website) continue;

      queueItems.push({
        url: ex.website,
        source: 'directory',
        priority: 25, // High — trade show exhibitors are double-qualified
        data: {
          exhibitor_company: ex.company_name,
          booth: ex.booth,
          description: ex.description,
          trade_show: show.name,
          channel: 'exhibitor',
          found_at: new Date().toISOString(),
        },
      });
    }

    if (queueItems.length > 0) {
      const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
      result.urls_queued = queued;
      result.duplicates = duplicates;
    }

    result.sample = exhibitors.slice(0, 5).map((e) => ({
      company: e.company_name,
      website: e.website,
    }));

    try {
      await supabase.from('discovery_runs').insert({
        source: 'exhibitor',
        query_used: show.name,
        urls_found: result.total_found,
        urls_new: result.urls_queued,
        metadata: { show_key: showKey },
      });
    } catch {}

    return result;
  } catch (err: any) {
    result.error = err.message;
    return result;
  }
}

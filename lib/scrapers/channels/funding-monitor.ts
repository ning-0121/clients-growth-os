import { SupabaseClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { enqueueUrls } from '../source-queue';

/**
 * Funding Monitor — discover brands that just raised money and need factories.
 *
 * Channels:
 * 1. Kickstarter "Fashion" category — successfully funded campaigns
 * 2. ProductHunt — weekly "Apparel" / "Fashion" launches
 * 3. HackerNews "Show HN" — startup apparel launches
 *
 * Why this matters: A brand that raised $50k+ on Kickstarter has:
 * - Money to spend on manufacturing
 * - Product-market fit (strangers paid for it)
 * - Urgency (they have to fulfill orders in 3-6 months)
 * - NO existing factory relationship yet = ours to win
 *
 * These are the highest-intent leads possible.
 */

// ──────────────────────────────────────────────────────────────────
// Kickstarter — public discovery (no API, but public search endpoint)
// ──────────────────────────────────────────────────────────────────

export interface FundedProject {
  title: string;
  url: string;
  description?: string;
  pledged?: number;
  goal?: number;
  backers?: number;
  funded_date?: string;
  creator?: string;
  creator_website?: string;
  channel: 'kickstarter' | 'producthunt' | 'hackernews';
}

/**
 * Scrape Kickstarter's public discover page for funded fashion projects.
 * URL pattern: /discover/categories/fashion?sort=end_date&state=successful
 */
export async function findKickstarterFunded(): Promise<FundedProject[]> {
  const url = 'https://www.kickstarter.com/discover/categories/fashion?sort=end_date&state=successful';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);

    const projects: FundedProject[] = [];

    // Kickstarter project cards
    $('[data-project-id], [data-ref="card_category_page"], .project-card, article').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a[href*="/projects/"]').first();
      const href = link.attr('href');
      if (!href) return;
      const fullUrl = href.startsWith('http') ? href : `https://www.kickstarter.com${href}`;

      const title = $el.find('h3, .project-title, [class*="title"]').first().text().trim() || link.text().trim();
      const desc = $el.find('.project-blurb, .blurb, p').first().text().trim();

      // Parse pledged amount if visible
      const pledgedText = $el.find('[class*="pledged"], [class*="amount"]').first().text();
      const pledgedMatch = pledgedText.match(/\$?([\d,]+)/);
      const pledged = pledgedMatch ? parseInt(pledgedMatch[1].replace(/,/g, ''), 10) : undefined;

      if (title && fullUrl.includes('/projects/')) {
        projects.push({
          title: title.slice(0, 200),
          url: fullUrl,
          description: desc.slice(0, 300),
          pledged,
          channel: 'kickstarter',
        });
      }
    });

    return projects.slice(0, 30);
  } catch {
    return [];
  }
}

/**
 * Given a Kickstarter project URL, try to extract the creator's external website
 * from their project page (most creators link their own site).
 */
export async function getKickstarterCreatorWebsite(projectUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(projectUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthOS/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    const $ = cheerio.load(html);

    // External links in the project description (excluding kickstarter, social media)
    const skipHosts = ['kickstarter.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'linkedin.com'];
    const externalLinks: string[] = [];

    $('a[href^="http"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      try {
        const u = new URL(href);
        const host = u.hostname.replace(/^www\./, '');
        if (!skipHosts.some(s => host.includes(s)) && !externalLinks.includes(host)) {
          externalLinks.push(host);
        }
      } catch {}
    });

    // The first non-social link is usually the creator's own site
    if (externalLinks[0]) {
      return `https://${externalLinks[0]}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ──────────────────────────────────────────────────────────────────
// ProductHunt — uses public GraphQL API
// ──────────────────────────────────────────────────────────────────

/**
 * ProductHunt recent apparel/fashion products via their public sitemap + RSS.
 * Official API requires auth; we use their public category page.
 */
export async function findProductHuntLaunches(): Promise<FundedProject[]> {
  const url = 'https://www.producthunt.com/topics/fashion';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GrowthOS/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);

    const products: FundedProject[] = [];

    // ProductHunt product cards
    $('[data-test^="post-item"], article, [class*="ProductCard"]').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a[href*="/posts/"]').first();
      const href = link.attr('href');
      if (!href) return;
      const fullUrl = href.startsWith('http') ? href : `https://www.producthunt.com${href}`;
      const title = $el.find('h3, [class*="title"]').first().text().trim() || link.text().trim();
      const desc = $el.find('p, [class*="tagline"]').first().text().trim();

      if (title && fullUrl.includes('/posts/')) {
        products.push({
          title: title.slice(0, 200),
          url: fullUrl,
          description: desc.slice(0, 300),
          channel: 'producthunt',
        });
      }
    });

    return products.slice(0, 20);
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────
// Main discovery function
// ──────────────────────────────────────────────────────────────────

export interface FundingDiscoveryResult {
  kickstarter_found: number;
  producthunt_found: number;
  total_queued: number;
  duplicates: number;
  sample: Array<{ title: string; website?: string; channel: string; pledged?: number }>;
  error?: string;
}

export async function discoverFundedBrands(
  supabase: SupabaseClient,
  opts: { includeKickstarter?: boolean; includeProductHunt?: boolean } = {}
): Promise<FundingDiscoveryResult> {
  const { includeKickstarter = true, includeProductHunt = true } = opts;
  const result: FundingDiscoveryResult = {
    kickstarter_found: 0,
    producthunt_found: 0,
    total_queued: 0,
    duplicates: 0,
    sample: [],
  };

  const projects: FundedProject[] = [];

  try {
    if (includeKickstarter) {
      const ks = await findKickstarterFunded();
      projects.push(...ks);
      result.kickstarter_found = ks.length;
    }

    if (includeProductHunt) {
      const ph = await findProductHuntLaunches();
      projects.push(...ph);
      result.producthunt_found = ph.length;
    }

    // Resolve websites for Kickstarter (ProductHunt URLs are the site itself)
    const queueItems: { url: string; source: string; priority: number; data: any }[] = [];
    let resolveBudget = 10; // resolve top 10 to stay within timeout

    for (const proj of projects) {
      let websiteUrl: string | undefined;

      if (proj.channel === 'kickstarter' && resolveBudget > 0) {
        websiteUrl = await getKickstarterCreatorWebsite(proj.url);
        resolveBudget--;
      }

      // Use creator's website if found, else the campaign URL as seed
      const url = websiteUrl || proj.url;

      queueItems.push({
        url,
        source: 'directory',
        priority: 32, // HIGHEST — funded brand = urgent factory need
        data: {
          funded_brand: true,
          channel: proj.channel,
          campaign_title: proj.title,
          campaign_url: proj.url,
          pledged: proj.pledged,
          description: proj.description,
          creator_website: websiteUrl,
          found_at: new Date().toISOString(),
        },
      });

      if (result.sample.length < 5) {
        result.sample.push({
          title: proj.title,
          website: websiteUrl,
          channel: proj.channel,
          pledged: proj.pledged,
        });
      }
    }

    if (queueItems.length > 0) {
      const { queued, duplicates } = await enqueueUrls(queueItems, supabase);
      result.total_queued = queued;
      result.duplicates = duplicates;
    }

    try {
      await supabase.from('discovery_runs').insert({
        source: 'funding_monitor',
        query_used: `kickstarter=${includeKickstarter}, ph=${includeProductHunt}`,
        urls_found: projects.length,
        urls_new: result.total_queued,
        metadata: {
          kickstarter_found: result.kickstarter_found,
          producthunt_found: result.producthunt_found,
        },
      });
    } catch {}

    return result;
  } catch (err: any) {
    result.error = err.message;
    return result;
  }
}

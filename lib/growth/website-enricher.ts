import * as cheerio from 'cheerio';
import { mapCategory } from './category-mapper';
import { analyzeWebsite } from '@/lib/ai/website-analyzer';
import { AIWebsiteAnalysis } from '@/lib/ai/types';

export interface EnrichmentResult {
  url: string;
  company_name: string;
  website: string;
  contact_email: string | null;
  instagram_handle: string | null;
  contact_linkedin: string | null;
  product_match: string | null;
  ig_only: boolean; // has IG but no email/linkedin
  ai_analysis?: AIWebsiteAnalysis | null;
}

export interface EnrichmentFailure {
  url: string;
  reason: string;
}

export interface EnrichmentOutput {
  results: EnrichmentResult[];
  failures: EnrichmentFailure[];
}

// Emails to discard — not contactable
const DISCARD_PREFIXES = [
  'noreply',
  'no-reply',
  'no_reply',
  'mailer-daemon',
  'donotreply',
  'do-not-reply',
  'do_not_reply',
  'bounce',
  'automated',
  'postmaster',
];

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const IG_HREF_RE = /instagram\.com\/([a-zA-Z0-9_.]+)\/?/i;
const LI_HREF_RE = /linkedin\.com\/(company|in)\/([a-zA-Z0-9_\-]+)\/?/i;
const CONTACT_PATH_RE = /\/(contact|about|connect|reach)/i;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
}

function isContactableEmail(email: string): boolean {
  const local = email.split('@')[0].toLowerCase();
  return !DISCARD_PREFIXES.some((p) => local === p || local.startsWith(p + '+'));
}

async function fetchPage(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractEmails(html: string, $: cheerio.CheerioAPI): string[] {
  const found = new Set<string>();

  // mailto: links
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
    if (email && EMAIL_RE.test(email)) {
      found.add(email);
    }
  });

  // Regex scan on visible text (limit to avoid noise)
  const text = $('body').text().slice(0, 10000);
  const matches = text.match(EMAIL_RE) || [];
  for (const m of matches) {
    found.add(m.toLowerCase());
  }

  // Filter out non-contactable
  return [...found].filter(isContactableEmail);
}

function extractInstagram($: cheerio.CheerioAPI): string | null {
  let handle: string | null = null;

  $('a[href*="instagram.com"]').each((_, el) => {
    if (handle) return;
    const href = $(el).attr('href') || '';
    const match = href.match(IG_HREF_RE);
    if (match && match[1] && !['p', 'reel', 'stories', 'explore', 'accounts'].includes(match[1].toLowerCase())) {
      handle = match[1].toLowerCase();
    }
  });

  return handle;
}

function extractLinkedIn($: cheerio.CheerioAPI): string | null {
  let url: string | null = null;

  $('a[href*="linkedin.com"]').each((_, el) => {
    if (url) return;
    const href = $(el).attr('href') || '';
    const match = href.match(LI_HREF_RE);
    if (match) {
      url = href.split('?')[0]; // clean tracking params
    }
  });

  return url;
}

function extractCompanyName($: cheerio.CheerioAPI, url: string): string {
  // Try og:site_name first
  const ogSiteName = $('meta[property="og:site_name"]').attr('content');
  if (ogSiteName && ogSiteName.trim().length > 0) {
    return ogSiteName.trim();
  }

  // Try <title>, strip common suffixes
  const title = $('title').text().trim();
  if (title) {
    return title
      .replace(/\s*[-–|·•:]\s*(official\s*(site|website|store)|home|welcome|shop).*$/i, '')
      .replace(/\s*[-–|·•:]\s*$/, '')
      .trim() || title;
  }

  // Last resort: domain name
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    return domain.split('.')[0];
  } catch {
    return url;
  }
}

function findContactPageUrl($: cheerio.CheerioAPI, baseUrl: string): string | null {
  let contactHref: string | null = null;

  $('a').each((_, el) => {
    if (contactHref) return;
    const href = $(el).attr('href') || '';
    if (CONTACT_PATH_RE.test(href)) {
      contactHref = href;
    }
  });

  if (!contactHref) return null;

  try {
    return new URL(contactHref, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Enrich a single URL by fetching its homepage (and optionally contact page).
 */
async function enrichUrl(
  rawUrl: string,
  productHint?: string
): Promise<{ result?: EnrichmentResult; failure?: EnrichmentFailure }> {
  const url = normalizeUrl(rawUrl);

  const html = await fetchPage(url);
  if (!html) {
    return { failure: { url: rawUrl, reason: 'Failed to fetch homepage (timeout or non-200)' } };
  }

  const $ = cheerio.load(html);

  const company_name = extractCompanyName($, url);
  let emails = extractEmails(html, $);
  const instagram_handle = extractInstagram($);
  const contact_linkedin = extractLinkedIn($);

  // If no email found, try contact/about page
  if (emails.length === 0) {
    const contactUrl = findContactPageUrl($, url);
    if (contactUrl) {
      const contactHtml = await fetchPage(contactUrl);
      if (contactHtml) {
        const $contact = cheerio.load(contactHtml);
        emails = extractEmails(contactHtml, $contact);
      }
    }
  }

  // Extract content for analysis
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
  const titleText = $('title').text();
  const bodyText = $('body').text().slice(0, 5000);

  // Extract nav items and headings for AI context
  const navItems: string[] = [];
  $('nav a, header a, [role="navigation"] a').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 50) navItems.push(text);
  });
  const headings: string[] = [];
  $('h1, h2').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 200) headings.push(text);
  });

  // AI-powered analysis (fallback to keyword matching if AI unavailable)
  let ai_analysis: AIWebsiteAnalysis | null = null;
  let product_match: string | null = productHint || null;

  try {
    ai_analysis = await analyzeWebsite({
      url,
      title: titleText,
      metaDescription: metaDesc,
      bodyText,
      navItems: navItems.slice(0, 20),
      headings: headings.slice(0, 10),
    });
  } catch {
    // AI unavailable, will fallback below
  }

  if (ai_analysis && !product_match) {
    // Use AI-determined categories
    product_match = ai_analysis.product_categories.length > 0
      ? ai_analysis.product_categories.join(', ')
      : null;
  }

  // Fallback to keyword matching if AI didn't produce a result
  if (!product_match) {
    product_match = mapCategory([titleText, metaDesc, metaKeywords, bodyText], metaDesc);
  }

  const contact_email = emails[0] || null;
  const ig_only = !!instagram_handle && !contact_email && !contact_linkedin;

  return {
    result: {
      url: rawUrl,
      company_name,
      website: url,
      contact_email,
      instagram_handle,
      contact_linkedin,
      product_match,
      ig_only,
      ai_analysis,
    },
  };
}

export interface SeedEntry {
  website: string;
  source_label?: string;
  product_hint?: string;
  notes?: string;
}

/**
 * Parse a .txt input (one URL per line).
 */
export function parseTxtInput(text: string): SeedEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((website) => ({ website }));
}

/**
 * Parse a .csv input with headers: website, source_label, product_hint, notes
 */
export function parseCsvInput(text: string): SeedEntry[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return []; // need header + at least one row

  const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const websiteIdx = header.indexOf('website');
  if (websiteIdx === -1) return [];

  const sourceIdx = header.indexOf('source_label');
  const hintIdx = header.indexOf('product_hint');
  const notesIdx = header.indexOf('notes');

  const entries: SeedEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const website = cols[websiteIdx]?.trim();
    if (!website) continue;

    entries.push({
      website,
      source_label: sourceIdx >= 0 ? cols[sourceIdx]?.trim() || undefined : undefined,
      product_hint: hintIdx >= 0 ? cols[hintIdx]?.trim() || undefined : undefined,
      notes: notesIdx >= 0 ? cols[notesIdx]?.trim() || undefined : undefined,
    });
  }

  return entries;
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parse input text, auto-detecting format (CSV if first line looks like a header, else TXT).
 */
export function parseInput(text: string, format?: 'txt' | 'csv'): SeedEntry[] {
  if (format === 'csv') return parseCsvInput(text);
  if (format === 'txt') return parseTxtInput(text);

  // Auto-detect
  const firstLine = text.trim().split('\n')[0].toLowerCase();
  if (firstLine.includes('website') && firstLine.includes(',')) {
    return parseCsvInput(text);
  }
  return parseTxtInput(text);
}

const MAX_BATCH_SIZE = 50;
const MAX_CONCURRENCY = 3;

/**
 * Enrich a batch of seed entries.
 * Hard limit: 50 URLs per run.
 */
export async function enrichBatch(
  entries: SeedEntry[],
  onProgress?: (completed: number, total: number) => void
): Promise<EnrichmentOutput> {
  if (entries.length > MAX_BATCH_SIZE) {
    return {
      results: [],
      failures: [{ url: '(batch)', reason: `Batch too large: ${entries.length} URLs (max ${MAX_BATCH_SIZE})` }],
    };
  }

  const results: EnrichmentResult[] = [];
  const failures: EnrichmentFailure[] = [];

  // Process in chunks of MAX_CONCURRENCY
  for (let i = 0; i < entries.length; i += MAX_CONCURRENCY) {
    const chunk = entries.slice(i, i + MAX_CONCURRENCY);
    const promises = chunk.map((entry) => enrichUrl(entry.website, entry.product_hint));
    const outcomes = await Promise.allSettled(promises);

    for (let j = 0; j < outcomes.length; j++) {
      const outcome = outcomes[j];
      if (outcome.status === 'fulfilled') {
        if (outcome.value.result) {
          // Apply source_label override if provided
          const entry = chunk[j];
          if (entry.source_label) {
            (outcome.value.result as any)._source_label = entry.source_label;
          }
          results.push(outcome.value.result);
        }
        if (outcome.value.failure) {
          failures.push(outcome.value.failure);
        }
      } else {
        failures.push({
          url: chunk[j].website,
          reason: outcome.reason?.message || 'Unknown error',
        });
      }
    }

    onProgress?.(Math.min(i + MAX_CONCURRENCY, entries.length), entries.length);
  }

  return { results, failures };
}

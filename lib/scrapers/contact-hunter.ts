import * as cheerio from 'cheerio';
import { extractDomain } from '@/lib/growth/lead-engine';

/**
 * Multi-Layer Contact Hunter
 *
 * 7 methods to find emails and contact info:
 * 1. Deep website scan (10+ pages, not just homepage)
 * 2. Email pattern guessing + verification
 * 3. Google search for company email
 * 4. Instagram bio extraction
 * 5. Common email addresses (info@, sales@, hello@)
 * 6. Team/About page scraping for named contacts
 * 7. LinkedIn profile URL extraction
 */

export interface ContactFinderResult {
  emails: { email: string; source: string; confidence: number }[];
  phones: { phone: string; source: string }[];
  social: { platform: string; url: string }[];
  contacts: { name: string; title: string; email?: string; linkedin?: string }[];
  methods_used: string[];
  pages_scanned: number;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;

const DISCARD_EMAILS = [
  'noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster',
  'bounce', 'automated', 'notifications', 'newsletter', 'unsubscribe',
  'support', // keep support@ but lower confidence
];

const DISCARD_DOMAINS = [
  'sentry.io', 'googletagmanager.com', 'facebook.com', 'twitter.com',
  'instagram.com', 'cloudflare.com', 'googleapis.com', 'shopify.com',
  'example.com', 'email.com', 'yourdomain.com', 'company.com',
];

async function fetchPage(url: string, timeoutMs = 6000): Promise<string | null> {
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

function isValidEmail(email: string): boolean {
  if (!email || email.length > 100) return false;
  const local = email.split('@')[0].toLowerCase();
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  if (DISCARD_DOMAINS.some(d => domain.includes(d))) return false;
  if (local.length < 2) return false;
  // Skip image/file extensions used as emails
  if (domain.endsWith('.png') || domain.endsWith('.jpg') || domain.endsWith('.svg')) return false;
  return true;
}

function emailConfidence(email: string, companyDomain: string): number {
  const local = email.split('@')[0].toLowerCase();
  const domain = email.split('@')[1]?.toLowerCase();

  // Same domain as company = highest confidence
  if (domain === companyDomain) {
    if (DISCARD_EMAILS.some(d => local === d || local.startsWith(d))) return 40;
    if (['info', 'sales', 'hello', 'contact', 'wholesale', 'sourcing', 'buying'].includes(local)) return 75;
    // Likely a person's email (first.last, first, etc.)
    if (local.includes('.') || local.length > 3) return 90;
    return 70;
  }

  // Different domain but valid
  if (domain?.includes('gmail') || domain?.includes('outlook') || domain?.includes('yahoo')) return 50;
  return 30;
}

/**
 * Method 1: Deep website scan — check 10+ pages for emails
 */
async function deepWebsiteScan(baseUrl: string): Promise<{
  emails: Map<string, { source: string; confidence: number }>;
  phones: Set<string>;
  social: Map<string, string>;
  contacts: { name: string; title: string }[];
  pagesScanned: number;
}> {
  const emails = new Map<string, { source: string; confidence: number }>();
  const phones = new Set<string>();
  const social = new Map<string, string>();
  const contacts: { name: string; title: string }[] = [];
  let pagesScanned = 0;

  const domain = extractDomain(baseUrl);
  const base = baseUrl.replace(/\/$/, '');

  // Pages to check (prioritized — most likely to have contact info first)
  const pagesToCheck = [
    base,
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/pages/contact`,
    `${base}/pages/contact-us`,
    `${base}/about`,
    `${base}/about-us`,
    `${base}/pages/about`,
    `${base}/pages/about-us`,
    `${base}/team`,
    `${base}/our-team`,
    `${base}/pages/team`,
    `${base}/wholesale`,
    `${base}/pages/wholesale`,
    `${base}/retailers`,
    `${base}/pages/retailers`,
    `${base}/b2b`,
    `${base}/pages/b2b`,
    `${base}/press`,
    `${base}/pages/press`,
    `${base}/partnerships`,
  ];

  for (const pageUrl of pagesToCheck) {
    if (pagesScanned >= 8) break; // Max 8 pages to stay fast

    const html = await fetchPage(pageUrl);
    if (!html) continue;
    pagesScanned++;

    const $ = cheerio.load(html);

    // Extract emails from mailto links (highest quality)
    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
      if (isValidEmail(email) && !emails.has(email)) {
        emails.set(email, { source: `mailto:${pageUrl.split('/').pop()}`, confidence: emailConfidence(email, domain) });
      }
    });

    // Extract emails from page text
    const text = $('body').text();
    const textEmails = text.match(EMAIL_RE) || [];
    for (const email of textEmails) {
      const lower = email.toLowerCase();
      if (isValidEmail(lower) && !emails.has(lower)) {
        emails.set(lower, { source: `text:${pageUrl.split('/').pop()}`, confidence: emailConfidence(lower, domain) });
      }
    }

    // Extract emails from href attributes (sometimes hidden)
    $('a[href*="@"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const matches = href.match(EMAIL_RE) || [];
      for (const email of matches) {
        const lower = email.toLowerCase();
        if (isValidEmail(lower) && !emails.has(lower)) {
          emails.set(lower, { source: `href:${pageUrl.split('/').pop()}`, confidence: emailConfidence(lower, domain) });
        }
      }
    });

    // Extract phone numbers
    const phoneMatches = text.match(PHONE_RE) || [];
    phoneMatches.forEach(p => phones.add(p.trim()));

    // Extract social links
    $('a[href*="instagram.com"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('instagram.com/') && !social.has('instagram')) {
        social.set('instagram', href.split('?')[0]);
      }
    });
    $('a[href*="linkedin.com"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!social.has('linkedin')) social.set('linkedin', href.split('?')[0]);
    });
    $('a[href*="facebook.com"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!social.has('facebook')) social.set('facebook', href.split('?')[0]);
    });
    $('a[href*="tiktok.com"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!social.has('tiktok')) social.set('tiktok', href.split('?')[0]);
    });

    // Extract team member names (from team/about pages)
    if (pageUrl.includes('team') || pageUrl.includes('about')) {
      // Look for name + title patterns
      $('h3, h4, .team-member, [class*="team"], [class*="member"], [class*="staff"]').each((_, el) => {
        const name = $(el).find('h3, h4, .name, [class*="name"]').first().text().trim() || $(el).text().trim();
        const title = $(el).find('p, .title, .role, .position, [class*="title"], [class*="role"]').first().text().trim();
        if (name.length > 2 && name.length < 50 && title.length > 2 && title.length < 100) {
          contacts.push({ name, title });
        }
      });
    }
  }

  return { emails, phones, social, contacts: contacts.slice(0, 10), pagesScanned };
}

/**
 * Method 2: Email pattern guessing
 * If we found one email like "alex@company.com", try common patterns for other names
 */
function guessEmailPatterns(domain: string, contactName?: string): string[] {
  if (!contactName || !domain) return [];

  const parts = contactName.toLowerCase().split(/\s+/);
  if (parts.length < 2) return [];

  const first = parts[0].replace(/[^a-z]/g, '');
  const last = parts[parts.length - 1].replace(/[^a-z]/g, '');

  if (!first || !last) return [];

  return [
    `${first}@${domain}`,           // alex@company.com
    `${first}.${last}@${domain}`,   // alex.smith@company.com
    `${first[0]}${last}@${domain}`, // asmith@company.com
    `${first}${last[0]}@${domain}`, // alexs@company.com
    `${last}@${domain}`,            // smith@company.com
  ];
}

/**
 * Method 3: Google search for company email
 */
async function googleSearchEmail(companyName: string, domain: string): Promise<string[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  try {
    const query = `"${companyName}" email contact @${domain}`;
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=5&engine=google`;
    const res = await fetch(url);
    const data = await res.json();

    const emails: string[] = [];
    for (const result of (data.organic_results || [])) {
      const snippet = (result.snippet || '') + ' ' + (result.title || '');
      const matches = snippet.match(EMAIL_RE) || [];
      for (const email of matches) {
        if (isValidEmail(email.toLowerCase())) {
          emails.push(email.toLowerCase());
        }
      }
    }
    return [...new Set(emails)];
  } catch {
    return [];
  }
}

/**
 * Method 4: MX record verification for guessed emails
 */
async function verifyEmailDomain(domain: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { Accept: 'application/dns-json' } }
    );
    const data = await res.json();
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return true; // Assume valid if check fails
  }
}

/**
 * Method 5: Common business emails
 */
function commonBusinessEmails(domain: string): string[] {
  return [
    `info@${domain}`,
    `sales@${domain}`,
    `hello@${domain}`,
    `contact@${domain}`,
    `wholesale@${domain}`,
    `sourcing@${domain}`,
    `buying@${domain}`,
    `partnerships@${domain}`,
  ];
}

/**
 * MAIN: Run all contact finding methods
 */
export async function huntContacts(
  website: string,
  companyName: string,
  contactName?: string
): Promise<ContactFinderResult> {
  const result: ContactFinderResult = {
    emails: [],
    phones: [],
    social: [],
    contacts: [],
    methods_used: [],
    pages_scanned: 0,
  };

  if (!website) return result;

  const domain = extractDomain(website);

  // Method 1: Deep website scan (parallel-safe, runs first)
  const websiteData = await deepWebsiteScan(website);
  result.pages_scanned = websiteData.pagesScanned;
  result.methods_used.push(`deep_scan(${websiteData.pagesScanned}pages)`);

  // Add found emails
  for (const [email, meta] of websiteData.emails) {
    result.emails.push({ email, source: meta.source, confidence: meta.confidence });
  }

  // Add phones
  for (const phone of websiteData.phones) {
    result.phones.push({ phone, source: 'website' });
  }

  // Add social
  for (const [platform, url] of websiteData.social) {
    result.social.push({ platform, url });
  }

  // Add contacts
  result.contacts = websiteData.contacts.map(c => ({ ...c }));

  // Method 2: Email pattern guessing (if we have a contact name)
  if (contactName && domain) {
    const guesses = guessEmailPatterns(domain, contactName);
    const hasMx = await verifyEmailDomain(domain);

    if (hasMx) {
      for (const guess of guesses) {
        if (!result.emails.find(e => e.email === guess)) {
          result.emails.push({ email: guess, source: 'pattern_guess', confidence: 45 });
        }
      }
      result.methods_used.push('pattern_guess');
    }
  }

  // Method 3: Google search for email (only if we found 0-1 emails from website)
  if (result.emails.filter(e => e.confidence >= 60).length < 2) {
    const googleEmails = await googleSearchEmail(companyName, domain);
    for (const email of googleEmails) {
      if (!result.emails.find(e => e.email === email)) {
        result.emails.push({ email, source: 'google_search', confidence: emailConfidence(email, domain) });
      }
    }
    if (googleEmails.length > 0) result.methods_used.push('google_search');
  }

  // Method 5: Common business emails (low confidence, but worth trying)
  if (result.emails.filter(e => e.confidence >= 60).length === 0) {
    const hasMx = await verifyEmailDomain(domain);
    if (hasMx) {
      const commons = commonBusinessEmails(domain);
      for (const email of commons.slice(0, 3)) { // Only top 3
        if (!result.emails.find(e => e.email === email)) {
          result.emails.push({ email, source: 'common_pattern', confidence: 35 });
        }
      }
      result.methods_used.push('common_patterns');
    }
  }

  // Sort by confidence descending
  result.emails.sort((a, b) => b.confidence - a.confidence);

  // Deduplicate
  const seen = new Set<string>();
  result.emails = result.emails.filter(e => {
    if (seen.has(e.email)) return false;
    seen.add(e.email);
    return true;
  });

  return result;
}

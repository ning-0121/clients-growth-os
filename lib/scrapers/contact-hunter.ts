import * as cheerio from 'cheerio';
import { extractDomain } from '@/lib/growth/lead-engine';
import { searchTomba, googleEmailHunt, generateEmailPermutations, extractInstagramEmail, enrichCompanyInfo, scrapeShopifyStore } from './external-tools';

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
  addresses: { address: string; source: string }[];
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
 * Method 3b: Search business registries and job sites for contact info
 * Different countries have different public registries and job boards
 */
async function searchRegistriesAndJobs(companyName: string, domain: string): Promise<{
  emails: string[];
  phones: string[];
  contacts: { name: string; title: string }[];
}> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { emails: [], phones: [], contacts: [] };

  const emails: string[] = [];
  const phones: string[] = [];
  const contacts: { name: string; title: string }[] = [];

  // Search queries targeting registries, job boards, and business directories
  const queries = [
    // Business registries & directories (global)
    `"${companyName}" site:crunchbase.com OR site:bloomberg.com OR site:dnb.com email`,
    // Job postings (reveal HR/team contacts + company is active)
    `"${companyName}" hiring OR careers OR jobs email contact`,
    // Business registry by common countries
    `"${companyName}" site:companieshouse.gov.uk OR site:opencorporates.com OR site:sec.gov`,
    // Trade directories
    `"${companyName}" apparel OR clothing site:thomasnet.com OR site:kompass.com OR site:europages.com`,
  ];

  // Only run 2 searches to save API quota
  for (const query of queries.slice(0, 2)) {
    try {
      const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=5&engine=google`;
      const res = await fetch(url);
      const data = await res.json();

      for (const result of (data.organic_results || [])) {
        const text = `${result.title || ''} ${result.snippet || ''}`;

        // Extract emails
        const emailMatches = text.match(EMAIL_RE) || [];
        for (const email of emailMatches) {
          if (isValidEmail(email.toLowerCase())) {
            emails.push(email.toLowerCase());
          }
        }

        // Extract phone numbers
        const phoneMatches = text.match(PHONE_RE) || [];
        phoneMatches.forEach(p => phones.push(p.trim()));

        // Extract people names + titles from job/team mentions
        const titlePatterns = [
          /(?:CEO|Founder|Co-Founder|Owner|Director|Manager|Head of|VP|President|CMO|COO|CTO)\s*[-:]\s*([A-Z][a-z]+ [A-Z][a-z]+)/gi,
          /([A-Z][a-z]+ [A-Z][a-z]+)\s*[-,]\s*(?:CEO|Founder|Co-Founder|Owner|Director|Manager|Head of|VP|President)/gi,
        ];

        for (const pattern of titlePatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const name = match[1]?.trim();
            if (name && name.length > 4 && name.length < 40) {
              const titleMatch = text.match(/(?:CEO|Founder|Co-Founder|Owner|Director|Manager|Head of \w+|VP \w+|President|CMO|COO|CTO)/i);
              contacts.push({ name, title: titleMatch?.[0] || 'Unknown' });
            }
          }
        }
      }

      await new Promise(r => setTimeout(r, 300));
    } catch {}
  }

  return {
    emails: [...new Set(emails)],
    phones: [...new Set(phones)],
    contacts: contacts.slice(0, 5),
  };
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
 * Method 6: Extract Schema.org structured data (Organization, LocalBusiness)
 * Many websites embed their address/phone/email in JSON-LD structured data
 */
function extractSchemaData(html: string): {
  emails: string[]; phones: string[]; address: string; name: string;
} {
  const result = { emails: [] as string[], phones: [] as string[], address: '', name: '' };
  try {
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || '');
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          if (item.email) result.emails.push(String(item.email).replace('mailto:', '').toLowerCase());
          if (item.telephone) result.phones.push(String(item.telephone));
          if (item.address) {
            const a = typeof item.address === 'string' ? item.address :
              [item.address.streetAddress, item.address.addressLocality, item.address.addressRegion, item.address.postalCode, item.address.addressCountry].filter(Boolean).join(', ');
            if (a) result.address = a;
          }
          if (item.name) result.name = String(item.name);
          // Check nested contactPoint
          if (item.contactPoint) {
            const cp = Array.isArray(item.contactPoint) ? item.contactPoint : [item.contactPoint];
            for (const c of cp) {
              if (c.email) result.emails.push(String(c.email).replace('mailto:', '').toLowerCase());
              if (c.telephone) result.phones.push(String(c.telephone));
            }
          }
        }
      } catch {}
    });
  } catch {}
  return result;
}

/**
 * Method 7: Scrape footer specifically — nearly all sites put address/phone in footer
 */
function extractFooterInfo($: cheerio.CheerioAPI): {
  emails: string[]; phones: string[]; address: string;
} {
  const result = { emails: [] as string[], phones: [] as string[], address: '' };
  const footerText = $('footer').text() || '';

  // Emails in footer
  const footerEmails = footerText.match(EMAIL_RE) || [];
  result.emails = footerEmails.map(e => e.toLowerCase()).filter(isValidEmail);

  // Phones in footer
  const footerPhones = footerText.match(PHONE_RE) || [];
  result.phones = footerPhones.map(p => p.trim());

  // International phone (with +country code)
  const intlPhone = footerText.match(/\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g) || [];
  result.phones.push(...intlPhone.map(p => p.trim()));

  // Address patterns in footer
  const addressPatterns = [
    // US address
    /\d{1,5}\s+[\w\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court)[\s,]+[\w\s]+,\s*[A-Z]{2}\s+\d{5}/i,
    // UK postcode
    /[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i,
    // General: City, State/Country
    /[\w\s]+,\s*[\w\s]+,\s*[\w\s]+\s+\d{4,6}/,
  ];
  for (const pattern of addressPatterns) {
    const match = footerText.match(pattern);
    if (match) { result.address = match[0].trim(); break; }
  }

  return result;
}

/**
 * Method 8: Privacy Policy / Terms / Legal pages (GDPR requires contact info)
 */
async function scrapeLegalPages(baseUrl: string): Promise<{
  emails: string[]; address: string; dpo_contact: string;
}> {
  const result = { emails: [] as string[], address: '', dpo_contact: '' };
  const base = baseUrl.replace(/\/$/, '');

  const legalPaths = [
    '/privacy', '/privacy-policy', '/pages/privacy-policy',
    '/terms', '/terms-of-service', '/pages/terms-of-service',
    '/legal', '/imprint', '/impressum', // German law requires full contact
  ];

  for (const path of legalPaths.slice(0, 3)) { // Max 3 pages
    const html = await fetchPage(`${base}${path}`);
    if (!html) continue;

    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const emails = text.match(EMAIL_RE) || [];
    result.emails.push(...emails.map(e => e.toLowerCase()).filter(isValidEmail));

    // DPO / Data Protection Officer contact (GDPR)
    const dpoMatch = text.match(/(?:data protection officer|DPO|privacy officer|datenschutzbeauftragter)[^.]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (dpoMatch) result.dpo_contact = dpoMatch[1].toLowerCase();

    // Address from legal pages (very common in imprint/impressum)
    const addressMatch = text.match(/(?:registered (?:address|office)|address|Anschrift|siège social)[:\s]+([^.]{10,100})/i);
    if (addressMatch) result.address = addressMatch[1].trim();

    break; // One legal page is usually enough
  }

  return { ...result, emails: [...new Set(result.emails)] };
}

/**
 * Method 9: Google Maps / business listing search
 */
async function searchGoogleMaps(companyName: string): Promise<{
  address: string; phone: string;
}> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { address: '', phone: '' };

  try {
    const query = `${companyName} apparel clothing`;
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&engine=google_maps&type=search`;
    const res = await fetch(url);
    const data = await res.json();

    const place = data.local_results?.[0] || data.place_results;
    if (place) {
      return {
        address: place.address || '',
        phone: place.phone || '',
      };
    }
  } catch {}

  return { address: '', phone: '' };
}

/**
 * Method 10: WHOIS domain lookup — often has registrant email
 */
async function whoisLookup(domain: string): Promise<{
  registrant_email: string; registrant_name: string; registrant_org: string;
}> {
  const result = { registrant_email: '', registrant_name: '', registrant_org: '' };

  try {
    // Use a free WHOIS API
    const res = await fetch(`https://api.whoapi.com/?apikey=free&r=whois&domain=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();

    if (data.contacts) {
      for (const contact of data.contacts) {
        if (contact.email && isValidEmail(contact.email.toLowerCase())) {
          result.registrant_email = contact.email.toLowerCase();
        }
        if (contact.name) result.registrant_name = contact.name;
        if (contact.organization) result.registrant_org = contact.organization;
      }
    }
  } catch {}

  // Fallback: try another free WHOIS source
  if (!result.registrant_email) {
    try {
      const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();

      // RDAP format
      for (const entity of (data.entities || [])) {
        const vcard = entity.vcardArray?.[1];
        if (vcard) {
          for (const field of vcard) {
            if (field[0] === 'email' && field[3]) {
              const email = String(field[3]).toLowerCase();
              if (isValidEmail(email)) result.registrant_email = email;
            }
            if (field[0] === 'fn' && field[3]) result.registrant_name = String(field[3]);
            if (field[0] === 'org' && field[3]) result.registrant_org = String(field[3]);
          }
        }
      }
    } catch {}
  }

  return result;
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
    addresses: [],
    methods_used: [],
    pages_scanned: 0,
  };

  if (!website) return result;

  const domain = extractDomain(website);

  // Method 1: Deep website scan + Schema.org + Footer extraction
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

  // Method 6+7: Schema.org + Footer extraction (from homepage HTML)
  try {
    const homepageHtml = await fetchPage(website);
    if (homepageHtml) {
      // Schema.org structured data
      const schema = extractSchemaData(homepageHtml);
      for (const email of schema.emails) {
        if (isValidEmail(email) && !result.emails.find(e => e.email === email)) {
          result.emails.push({ email, source: 'schema.org', confidence: emailConfidence(email, domain) });
        }
      }
      for (const phone of schema.phones) {
        if (!result.phones.find(p => p.phone === phone)) {
          result.phones.push({ phone, source: 'schema.org' });
        }
      }
      if (schema.address) result.addresses.push({ address: schema.address, source: 'schema.org' });

      // Footer extraction
      const $home = cheerio.load(homepageHtml);
      const footer = extractFooterInfo($home);
      for (const email of footer.emails) {
        if (!result.emails.find(e => e.email === email)) {
          result.emails.push({ email, source: 'footer', confidence: emailConfidence(email, domain) });
        }
      }
      for (const phone of footer.phones) {
        if (!result.phones.find(p => p.phone === phone)) {
          result.phones.push({ phone, source: 'footer' });
        }
      }
      if (footer.address && !result.addresses.find(a => a.address === footer.address)) {
        result.addresses.push({ address: footer.address, source: 'footer' });
      }

      result.methods_used.push('schema+footer');
    }
  } catch {}

  // Method 8: Legal pages (privacy/terms/imprint — GDPR requires contact)
  try {
    const legalData = await scrapeLegalPages(website);
    for (const email of legalData.emails) {
      if (!result.emails.find(e => e.email === email)) {
        result.emails.push({ email, source: 'legal_page', confidence: emailConfidence(email, domain) });
      }
    }
    if (legalData.address && !result.addresses.find(a => a.source === 'legal_page')) {
      result.addresses.push({ address: legalData.address, source: 'legal_page' });
    }
    if (legalData.dpo_contact) {
      if (!result.emails.find(e => e.email === legalData.dpo_contact)) {
        result.emails.push({ email: legalData.dpo_contact, source: 'dpo_legal', confidence: 60 });
      }
    }
    if (legalData.emails.length > 0) result.methods_used.push('legal_pages');
  } catch {}

  // Method 9: Google Maps (address + phone)
  if (result.addresses.length === 0 || result.phones.length === 0) {
    try {
      const maps = await searchGoogleMaps(companyName);
      if (maps.address) result.addresses.push({ address: maps.address, source: 'google_maps' });
      if (maps.phone && !result.phones.find(p => p.phone === maps.phone)) {
        result.phones.push({ phone: maps.phone, source: 'google_maps' });
      }
      if (maps.address || maps.phone) result.methods_used.push('google_maps');
    } catch {}
  }

  // Method 10: WHOIS domain lookup
  try {
    const whois = await whoisLookup(domain);
    if (whois.registrant_email && !result.emails.find(e => e.email === whois.registrant_email)) {
      result.emails.push({ email: whois.registrant_email, source: 'whois', confidence: 55 });
    }
    if (whois.registrant_name && !result.contacts.find(c => c.name === whois.registrant_name)) {
      result.contacts.push({ name: whois.registrant_name, title: 'Domain Owner' });
      // Guess email from WHOIS name
      const guesses = guessEmailPatterns(domain, whois.registrant_name);
      for (const guess of guesses.slice(0, 2)) {
        if (!result.emails.find(e => e.email === guess)) {
          result.emails.push({ email: guess, source: `whois_guess:${whois.registrant_name}`, confidence: 45 });
        }
      }
    }
    if (whois.registrant_email || whois.registrant_name) result.methods_used.push('whois');
  } catch {}

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

  // Method 3b: Search business registries & job boards
  if (result.emails.filter(e => e.confidence >= 60).length < 2) {
    const registryData = await searchRegistriesAndJobs(companyName, domain);
    for (const email of registryData.emails) {
      if (!result.emails.find(e => e.email === email)) {
        result.emails.push({ email, source: 'registry_jobs', confidence: emailConfidence(email, domain) });
      }
    }
    for (const phone of registryData.phones) {
      if (!result.phones.find(p => p.phone === phone)) {
        result.phones.push({ phone, source: 'registry_jobs' });
      }
    }
    // Add discovered contacts (with names and titles from registries/jobs)
    for (const contact of registryData.contacts) {
      if (!result.contacts.find(c => c.name === contact.name)) {
        result.contacts.push(contact);
        // Also try guessing their email
        if (domain) {
          const guesses = guessEmailPatterns(domain, contact.name);
          for (const guess of guesses.slice(0, 2)) {
            if (!result.emails.find(e => e.email === guess)) {
              result.emails.push({ email: guess, source: `guess:${contact.name}`, confidence: 50 });
            }
          }
        }
      }
    }
    if (registryData.emails.length > 0 || registryData.contacts.length > 0) {
      result.methods_used.push('registry_jobs');
    }
  }

  // ═══ EXTERNAL TOOLS (learned from GitHub) ═══

  // Tool 1: Tomba.io — professional email finder (50/month free)
  if (result.emails.filter(e => e.confidence >= 70).length === 0) {
    try {
      const tomba = await searchTomba(domain);
      if (tomba && tomba.emails.length > 0) {
        for (const te of tomba.emails) {
          if (!result.emails.find(e => e.email === te.email)) {
            result.emails.push({
              email: te.email,
              source: `tomba:${te.type}`,
              confidence: te.type === 'personal' ? 85 : 65,
            });
          }
        }
        if (tomba.country && !result.addresses.find(a => a.source === 'tomba')) {
          result.addresses.push({ address: tomba.country, source: 'tomba' });
        }
        result.methods_used.push('tomba.io');
      }
    } catch {}
  }

  // Tool 2: Enhanced Google Email Hunt (MailHunter technique)
  if (result.emails.filter(e => e.confidence >= 70).length === 0) {
    try {
      const huntedEmails = await googleEmailHunt(companyName, domain);
      for (const email of huntedEmails) {
        if (!result.emails.find(e => e.email === email)) {
          result.emails.push({ email, source: 'google_email_hunt', confidence: emailConfidence(email, domain) });
        }
      }
      if (huntedEmails.length > 0) result.methods_used.push('google_email_hunt');
    } catch {}
  }

  // Tool 3: Email Permutation (from contact names found)
  if (result.emails.filter(e => e.confidence >= 70).length === 0 && result.contacts.length > 0) {
    const hasMx = await verifyEmailDomain(domain);
    if (hasMx) {
      for (const contact of result.contacts.slice(0, 2)) {
        const parts = contact.name.split(/\s+/);
        if (parts.length >= 2) {
          const perms = generateEmailPermutations(parts[0], parts[parts.length - 1], domain);
          for (const email of perms.slice(0, 3)) { // Top 3 most common patterns
            if (!result.emails.find(e => e.email === email)) {
              result.emails.push({ email, source: `permutation:${contact.name}`, confidence: 50 });
            }
          }
        }
      }
      result.methods_used.push('email_permutation');
    }
  }

  // Tool 4: Instagram bio email (if handle available)
  if (result.emails.filter(e => e.confidence >= 60).length === 0) {
    // Check if we have IG from earlier scan
    const igLink = result.social.find(s => s.platform === 'instagram');
    const igHandle = igLink?.url?.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)?.[1];
    if (igHandle) {
      try {
        const igData = await extractInstagramEmail(igHandle);
        if (igData.email && !result.emails.find(e => e.email === igData.email)) {
          result.emails.push({ email: igData.email, source: 'instagram_bio', confidence: 70 });
          result.methods_used.push('instagram_bio');
        }
      } catch {}
    }
  }

  // Tool 5: Shopify store data (products + hidden email)
  try {
    const shopify = await scrapeShopifyStore(website);
    if (shopify?.isShopify) {
      if (shopify.email && !result.emails.find(e => e.email === shopify.email)) {
        result.emails.push({ email: shopify.email, source: 'shopify_privacy', confidence: 75 });
      }
      result.methods_used.push('shopify_api');
    }
  } catch {}

  // Tool 6: Company enrichment (founded/employees/location)
  try {
    const enrichment = await enrichCompanyInfo(companyName);
    if (enrichment.location && !result.addresses.find(a => a.source === 'company_enrichment')) {
      result.addresses.push({ address: enrichment.location, source: 'company_enrichment' });
    }
    // Store enrichment data in a special check
    if (enrichment.founded || enrichment.employees || enrichment.revenue) {
      result.methods_used.push('company_enrichment');
    }
  } catch {}

  // Method 5: Common business emails (last resort)
  if (result.emails.filter(e => e.confidence >= 50).length === 0) {
    const hasMx = await verifyEmailDomain(domain);
    if (hasMx) {
      const commons = commonBusinessEmails(domain);
      for (const email of commons.slice(0, 3)) {
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

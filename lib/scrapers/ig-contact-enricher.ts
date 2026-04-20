import * as cheerio from 'cheerio';

/**
 * Instagram lead contact enrichment.
 *
 * Given an IG handle (and optional external URL from bio), pulls all
 * reachable contact vectors: Linktree links, WhatsApp numbers, phone
 * numbers, additional emails. The goal is to replace a generic info@
 * email with something the founder actually reads (IG DM, WhatsApp,
 * Linktree-listed personal email).
 */

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
const WHATSAPP_LINK_RE = /(?:wa\.me|api\.whatsapp\.com|whatsapp\.com\/send)(?:\/[^\s"'<>]*)?(?:\?[^"'<>\s]*)?/gi;

const LINKTREE_HOSTS = ['linktr.ee', 'lnk.bio', 'beacons.ai', 'bio.link', 'allmylinks.com', 'tap.bio'];

export interface IgEnrichmentResult {
  handle: string;
  external_url: string | null;
  linktree_url: string | null;
  linktree_links: { label: string; url: string }[];
  emails: string[];
  phones: string[];
  whatsapp_numbers: string[];
  whatsapp_links: string[];
  bio_text: string | null;
}

function randomUA(): string {
  const uas = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ];
  return uas[Math.floor(Math.random() * uas.length)];
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': randomUA() },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractWhatsappFromText(text: string): { numbers: string[]; links: string[] } {
  const links = Array.from(text.matchAll(WHATSAPP_LINK_RE)).map(m => {
    const raw = m[0];
    return raw.startsWith('http') ? raw : `https://${raw}`;
  });
  // Extract digits from wa.me/XXXXXXX links
  const numbers = new Set<string>();
  for (const l of links) {
    const m = l.match(/wa\.me\/(\+?\d{7,15})/i) || l.match(/phone=(\+?\d{7,15})/i);
    if (m) numbers.add(m[1].startsWith('+') ? m[1] : `+${m[1]}`);
  }
  return { numbers: Array.from(numbers), links: Array.from(new Set(links)) };
}

/**
 * Fetch a Linktree-style page and extract all external links with labels.
 */
async function scrapeLinktree(linktreeUrl: string): Promise<{ label: string; url: string }[]> {
  const html = await fetchText(linktreeUrl, 10000);
  if (!html) return [];
  const $ = cheerio.load(html);
  const links: { label: string; url: string }[] = [];

  // Linktree uses <a> with data-testid or specific classes — grab all outbound links
  $('a[href^="http"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const label = $(el).text().trim() || $(el).attr('aria-label') || '';
    if (!href) return;
    // Skip the linktree brand links themselves
    const host = (() => { try { return new URL(href).host; } catch { return ''; } })();
    if (LINKTREE_HOSTS.some(h => host.includes(h))) return;
    if (host.includes('instagram.com') || host.includes('facebook.com')) {
      // still useful, keep them
    }
    links.push({ label: label.slice(0, 80), url: href });
  });

  // Dedup by URL
  const seen = new Set<string>();
  return links.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  }).slice(0, 30);
}

/**
 * Determine if a URL points to a Linktree-like aggregator.
 */
function isLinktreeHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return LINKTREE_HOSTS.some(h => host.includes(h));
  } catch { return false; }
}

/**
 * Main enrichment function. Chains:
 *   IG bio scan → Linktree (if any) → brand website → deep contact extraction
 */
export async function enrichInstagramContact(
  handle: string,
  bioExternalUrl?: string | null
): Promise<IgEnrichmentResult> {
  const result: IgEnrichmentResult = {
    handle,
    external_url: bioExternalUrl || null,
    linktree_url: null,
    linktree_links: [],
    emails: [],
    phones: [],
    whatsapp_numbers: [],
    whatsapp_links: [],
    bio_text: null,
  };

  // Step 1: Fetch IG profile for fresh bio + external URL
  const igHtml = await fetchText(`https://www.instagram.com/${handle}/`);
  if (igHtml) {
    const $ = cheerio.load(igHtml);
    const bio = $('meta[property="og:description"]').attr('content') || '';
    result.bio_text = bio || null;

    // Re-extract external URL from page if not provided
    if (!result.external_url) {
      const urlMatch = bio.match(/https?:\/\/[^\s"']+/);
      if (urlMatch) result.external_url = urlMatch[0];
    }

    // Pull contacts straight from bio
    const bioEmails = bio.match(EMAIL_RE) || [];
    bioEmails.forEach(e => {
      if (!e.includes('instagram.com') && e.length < 80) result.emails.push(e.toLowerCase());
    });
    const wa = extractWhatsappFromText(bio);
    result.whatsapp_numbers.push(...wa.numbers);
    result.whatsapp_links.push(...wa.links);
  }

  // Step 2: If external URL points to a Linktree, scrape it
  if (result.external_url && isLinktreeHost(result.external_url)) {
    result.linktree_url = result.external_url;
    const links = await scrapeLinktree(result.linktree_url);
    result.linktree_links = links;

    // Look for email/whatsapp-flavored labels
    for (const l of links) {
      const url = l.url.toLowerCase();
      const label = l.label.toLowerCase();

      if (url.startsWith('mailto:')) {
        result.emails.push(url.replace('mailto:', '').split('?')[0]);
      }
      if (url.startsWith('tel:')) {
        result.phones.push(url.replace('tel:', ''));
      }
      if (url.includes('wa.me') || url.includes('whatsapp')) {
        const wa = extractWhatsappFromText(l.url);
        result.whatsapp_numbers.push(...wa.numbers);
        result.whatsapp_links.push(l.url);
      }
      // Common labels that hint at contact
      if (/email|contact|dm/.test(label) && url.startsWith('http')) {
        // Could be a contact form — note it as a potential vector but don't treat as email
      }
    }
  }

  // Step 3: If external URL is the brand website (not a Linktree), scrape it for contacts
  const brandWebsite = result.linktree_url
    ? result.linktree_links.find(l => {
        try {
          const h = new URL(l.url).host.toLowerCase();
          return !LINKTREE_HOSTS.some(lh => h.includes(lh))
            && !h.includes('instagram.com')
            && !h.includes('tiktok.com')
            && !h.includes('facebook.com')
            && !h.includes('youtube.com')
            && !h.includes('spotify.com');
        } catch { return false; }
      })?.url
    : result.external_url && !isLinktreeHost(result.external_url) ? result.external_url : null;

  if (brandWebsite) {
    // Scan the root page + /contact page
    const urls = [brandWebsite];
    try {
      const root = new URL(brandWebsite);
      urls.push(`${root.protocol}//${root.host}/contact`);
      urls.push(`${root.protocol}//${root.host}/pages/contact`);
    } catch {}

    for (const url of urls) {
      const html = await fetchText(url, 8000);
      if (!html) continue;
      const $ = cheerio.load(html);
      const text = $('body').text();

      // Emails (filter obvious assets)
      const emailMatches = text.match(EMAIL_RE) || [];
      for (const e of emailMatches.slice(0, 20)) {
        if (!e.endsWith('.png') && !e.endsWith('.jpg') && e.length < 80 && !e.includes('sentry.io')) {
          result.emails.push(e.toLowerCase());
        }
      }

      // Phones
      const phoneMatches = text.match(PHONE_RE) || [];
      phoneMatches.slice(0, 10).forEach(p => {
        const clean = p.trim();
        if (clean.replace(/\D/g, '').length >= 7) result.phones.push(clean);
      });

      // WhatsApp links
      const wa = extractWhatsappFromText(html);
      result.whatsapp_numbers.push(...wa.numbers);
      result.whatsapp_links.push(...wa.links);

      // Also scan <a href="tel:"> and <a href="mailto:">
      $('a[href^="mailto:"]').each((_, el) => {
        const m = ($(el).attr('href') || '').replace('mailto:', '').split('?')[0];
        if (m && m.includes('@')) result.emails.push(m.toLowerCase());
      });
      $('a[href^="tel:"]').each((_, el) => {
        const p = ($(el).attr('href') || '').replace('tel:', '').trim();
        if (p) result.phones.push(p);
      });
    }
  }

  // Dedup everything
  result.emails = Array.from(new Set(result.emails));
  result.phones = Array.from(new Set(result.phones));
  result.whatsapp_numbers = Array.from(new Set(result.whatsapp_numbers));
  result.whatsapp_links = Array.from(new Set(result.whatsapp_links));

  return result;
}

/**
 * Stealth fetch — tries normal fetch first, falls back to ScrapingBee
 * unblocker for protected sites (Cloudflare, Akamai, bot walls).
 *
 * Only use this for URLs where plain fetch fails. It's expensive
 * (~$0.003/request on ScrapingBee) so we don't use it everywhere.
 *
 * Typical targets:
 * - Amazon seller profiles (Cloudflare)
 * - LinkedIn public pages (heavy bot detection)
 * - Some Shopify stores with bot protection apps
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

export interface StealthFetchResult {
  html: string | null;
  status: number;
  usedUnblocker: boolean;
  error?: string;
}

/**
 * Plain fetch with realistic headers. Fast path for most sites.
 */
async function plainFetch(url: string, timeoutMs = 10000): Promise<StealthFetchResult> {
  try {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });

    // 403 / 429 / 503 are likely bot blocks
    if ([403, 429, 503].includes(res.status)) {
      return { html: null, status: res.status, usedUnblocker: false, error: 'likely_bot_block' };
    }

    if (!res.ok) {
      return { html: null, status: res.status, usedUnblocker: false, error: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { html: null, status: res.status, usedUnblocker: false, error: 'not_html' };
    }

    const html = await res.text();
    return { html, status: res.status, usedUnblocker: false };
  } catch (err: any) {
    return {
      html: null,
      status: 0,
      usedUnblocker: false,
      error: err.message || 'fetch_error',
    };
  }
}

/**
 * ScrapingBee unblocker — rotates residential proxies, handles Cloudflare.
 * Cost: ~$0.003/request on Starter plan ($29/mo for 150k credits).
 * Each JS-rendered request = 5 credits, HTML-only = 1 credit.
 */
async function scrapingBeeFetch(url: string, renderJs = false): Promise<StealthFetchResult> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    return { html: null, status: 0, usedUnblocker: true, error: 'SCRAPINGBEE_API_KEY not configured' };
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      url,
      render_js: renderJs ? 'true' : 'false',
      premium_proxy: 'true', // residential — survives Cloudflare
      country_code: 'us',
    });

    const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
      signal: AbortSignal.timeout(30000), // unblocker can be slow
    });

    if (!res.ok) {
      return {
        html: null,
        status: res.status,
        usedUnblocker: true,
        error: `ScrapingBee HTTP ${res.status}`,
      };
    }

    const html = await res.text();
    return { html, status: 200, usedUnblocker: true };
  } catch (err: any) {
    return {
      html: null,
      status: 0,
      usedUnblocker: true,
      error: err.message || 'scrapingbee_error',
    };
  }
}

/**
 * Smart fetch: plain first, unblocker on failure.
 * Use this for any URL that might be protected (Amazon, LinkedIn, etc.)
 */
export async function stealthFetch(
  url: string,
  opts: { forceUnblocker?: boolean; renderJs?: boolean } = {}
): Promise<StealthFetchResult> {
  // Force unblocker for known-protected domains (saves a wasted plain attempt)
  const alwaysProtected = ['amazon.com', 'linkedin.com', 'glassdoor.com'];
  const shouldForce = opts.forceUnblocker || alwaysProtected.some(d => url.includes(d));

  if (!shouldForce) {
    const plain = await plainFetch(url);
    if (plain.html) return plain;
    // Only fall back to unblocker on likely-block errors (save cost)
    if (plain.error !== 'likely_bot_block' && plain.error !== 'not_html') {
      return plain;
    }
  }

  // Use unblocker
  return scrapingBeeFetch(url, opts.renderJs);
}

/**
 * Check if ScrapingBee is configured (for diagnostics).
 */
export function isStealthAvailable(): boolean {
  return !!process.env.SCRAPINGBEE_API_KEY;
}

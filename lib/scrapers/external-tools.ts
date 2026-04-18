/**
 * External Tools Integration — 整合 GitHub 开源工具的技术到我们系统
 *
 * 来源:
 * 1. Shopify products.json trick (omkarcloud/shopify-scraper)
 * 2. Tomba.io API (tomba-io/tomba) — 50次/月免费
 * 3. Google email hunt (chirag127/MailHunter)
 * 4. Email permutation (Bulk Email Finder gist)
 * 5. Instagram bio email (All-in-One-Social-Email-Scraper)
 * 6. Firecrawl enrichment pattern (firecrawl/fire-enrich)
 */

import { extractDomain } from '@/lib/growth/lead-engine';

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// ══════════════════════════════════════
// Tool 1: Shopify products.json — 免费发现 Shopify 店铺产品数据
// 来源: omkarcloud/shopify-scraper
// ══════════════════════════════════════

export interface ShopifyStoreData {
  isShopify: boolean;
  storeName: string;
  products: { title: string; type: string; vendor: string; price: string }[];
  email: string | null;
}

export async function scrapeShopifyStore(url: string): Promise<ShopifyStoreData | null> {
  const domain = url.replace(/\/$/, '');
  try {
    // Shopify stores expose a JSON API at /products.json
    const res = await fetch(`${domain}/products.json?limit=10`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.products) return null;

    const products = data.products.slice(0, 10).map((p: any) => ({
      title: p.title || '',
      type: p.product_type || '',
      vendor: p.vendor || '',
      price: p.variants?.[0]?.price || '',
    }));

    // Also try /meta.json for store info
    let email: string | null = null;
    let storeName = '';
    try {
      const metaRes = await fetch(`${domain}/meta.json`, { signal: AbortSignal.timeout(3000) });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        storeName = meta.name || '';
      }
    } catch {}

    // Try /policies/privacy-policy for email
    try {
      const privRes = await fetch(`${domain}/policies/privacy-policy`, { signal: AbortSignal.timeout(3000) });
      if (privRes.ok) {
        const html = await privRes.text();
        const emails = html.match(EMAIL_RE) || [];
        email = emails.find(e => !e.includes('shopify') && !e.includes('example')) || null;
      }
    } catch {}

    return { isShopify: true, storeName, products, email };
  } catch {
    return null;
  }
}

// ══════════════════════════════════════
// Tool 2: Tomba.io API — 邮箱查找 (50次/月免费)
// 来源: tomba-io/tomba
// ══════════════════════════════════════

export interface TombaResult {
  emails: { email: string; type: string; confidence: number }[];
  organization: string;
  country: string;
}

export async function searchTomba(domain: string): Promise<TombaResult | null> {
  const apiKey = process.env.TOMBA_API_KEY;
  const apiSecret = process.env.TOMBA_SECRET;
  if (!apiKey || !apiSecret) return null;

  try {
    const res = await fetch(`https://api.tomba.io/v1/domain-search?domain=${encodeURIComponent(domain)}`, {
      headers: { 'X-Tomba-Key': apiKey, 'X-Tomba-Secret': apiSecret },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    return {
      emails: (data.data?.emails || []).slice(0, 5).map((e: any) => ({
        email: e.email,
        type: e.type || 'unknown', // personal or generic
        confidence: e.confidence || 0,
      })),
      organization: data.data?.organization?.name || '',
      country: data.data?.organization?.country || '',
    };
  } catch {
    return null;
  }
}

// ══════════════════════════════════════
// Tomba Email Verifier — validate a specific email before sending
// Reduces bounce rate from ~15% (unverified) to <2% (verified)
// https://tomba.io/email-verifier/
// ══════════════════════════════════════

export interface TombaVerifyResult {
  email: string;
  deliverable: boolean;      // True if server accepts the email
  disposable: boolean;       // True for throwaway emails (mailinator etc.)
  webmail: boolean;          // True for gmail/yahoo/outlook
  mx_records: boolean;       // True if domain has MX records
  smtp_valid: boolean;       // True if SMTP handshake succeeded
  score: number;             // 0-100 overall confidence
  status: 'valid' | 'invalid' | 'risky' | 'unknown';
}

export async function verifyEmailTomba(email: string): Promise<TombaVerifyResult | null> {
  const apiKey = process.env.TOMBA_API_KEY;
  const apiSecret = process.env.TOMBA_SECRET;
  if (!apiKey || !apiSecret) return null;
  if (!email || !email.includes('@')) return null;

  try {
    const res = await fetch(`https://api.tomba.io/v1/email-verifier/${encodeURIComponent(email)}`, {
      headers: { 'X-Tomba-Key': apiKey, 'X-Tomba-Secret': apiSecret },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const d = data.data || {};

    // Derive overall status from signals
    const deliverable = !!d.deliverable;
    const disposable = !!d.disposable;
    const mxRecords = !!d.mx_records;
    const smtpValid = !!d.smtp_server;
    let status: 'valid' | 'invalid' | 'risky' | 'unknown' = 'unknown';
    if (disposable || !mxRecords) status = 'invalid';
    else if (deliverable && smtpValid) status = 'valid';
    else if (deliverable || smtpValid) status = 'risky';
    else status = 'invalid';

    return {
      email,
      deliverable,
      disposable,
      webmail: !!d.webmail,
      mx_records: mxRecords,
      smtp_valid: smtpValid,
      score: d.score || 0,
      status,
    };
  } catch {
    return null;
  }
}

// ══════════════════════════════════════
// Tool 3: Enhanced Google Email Hunter
// 来源: chirag127/MailHunter technique
// ══════════════════════════════════════

export async function googleEmailHunt(companyName: string, domain: string): Promise<string[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  const emails: string[] = [];

  // Multiple targeted searches (MailHunter technique)
  const queries = [
    `"@${domain}" email`,
    `"${companyName}" email contact "@${domain}"`,
    `"${companyName}" "reach us" OR "contact us" OR "get in touch" email`,
    `site:linkedin.com "${companyName}" email "@${domain}"`,
  ];

  // Only run 2 queries to save API calls
  for (const query of queries.slice(0, 2)) {
    try {
      const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=5&engine=google`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();

      for (const r of (data.organic_results || [])) {
        const text = `${r.title || ''} ${r.snippet || ''}`;
        const found = text.match(EMAIL_RE) || [];
        for (const e of found) {
          const lower = e.toLowerCase();
          if (lower.includes(domain) || (!lower.includes('example.com') && !lower.includes('email.com'))) {
            emails.push(lower);
          }
        }
      }

      await new Promise(r => setTimeout(r, 300));
    } catch {}
  }

  return [...new Set(emails)];
}

// ══════════════════════════════════════
// Tool 4: Email Permutation Generator
// 来源: Bulk Email Finder gist (irazasyed)
// ══════════════════════════════════════

export function generateEmailPermutations(firstName: string, lastName: string, domain: string): string[] {
  if (!firstName || !lastName || !domain) return [];

  const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '');
  if (!f || !l) return [];

  const fi = f[0]; // first initial
  const li = l[0]; // last initial

  return [
    `${f}@${domain}`,           // alex@company.com
    `${l}@${domain}`,           // smith@company.com
    `${f}.${l}@${domain}`,      // alex.smith@company.com
    `${f}${l}@${domain}`,       // alexsmith@company.com
    `${fi}${l}@${domain}`,      // asmith@company.com
    `${f}${li}@${domain}`,      // alexs@company.com
    `${fi}.${l}@${domain}`,     // a.smith@company.com
    `${f}_${l}@${domain}`,      // alex_smith@company.com
    `${l}.${f}@${domain}`,      // smith.alex@company.com
    `${l}${f}@${domain}`,       // smithalex@company.com
    `${l}${fi}@${domain}`,      // smitha@company.com
    `${fi}${li}@${domain}`,     // as@company.com
  ];
}

// ══════════════════════════════════════
// Tool 5: Instagram Bio Email Extractor
// 来源: All-in-One-Social-Email-Scraper technique
// ══════════════════════════════════════

export async function extractInstagramEmail(handle: string): Promise<{
  email: string | null;
  bio: string;
  website: string | null;
}> {
  // Can't scrape IG directly, but can search Google for the profile bio
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { email: null, bio: '', website: null };

  try {
    const query = `site:instagram.com "${handle}" email`;
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=3&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { email: null, bio: '', website: null };
    const data = await res.json();

    let email: string | null = null;
    let bio = '';
    let website: string | null = null;

    for (const r of (data.organic_results || [])) {
      const text = `${r.title || ''} ${r.snippet || ''}`;
      bio = r.snippet || '';

      // Extract email from bio/snippet
      const emails = text.match(EMAIL_RE) || [];
      if (emails.length > 0) {
        email = emails.find(e => !e.includes('instagram') && !e.includes('example')) || null;
      }

      // Extract website from snippet
      const urlMatch = text.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
      if (urlMatch && !urlMatch[0].includes('instagram')) {
        website = urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`;
      }
    }

    return { email, bio, website };
  } catch {
    return { email: null, bio: '', website: null };
  }
}

// ══════════════════════════════════════
// Tool 6: Company Enrichment via Firecrawl pattern
// 来源: firecrawl/fire-enrich technique (不需要 Firecrawl API)
// 用 Google 搜索实现类似的公司信息enrichment
// ══════════════════════════════════════

export interface CompanyEnrichment {
  founded: string;
  employees: string;
  revenue: string;
  location: string;
  description: string;
  industry: string;
  funding: string;
}

export async function enrichCompanyInfo(companyName: string): Promise<CompanyEnrichment> {
  const result: CompanyEnrichment = {
    founded: '', employees: '', revenue: '', location: '',
    description: '', industry: '', funding: '',
  };

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return result;

  try {
    // Google Knowledge Panel often has company info
    const query = `${companyName} company founded employees`;
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=3&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return result;
    const data = await res.json();

    // Extract from Knowledge Graph
    const kg = data.knowledge_graph;
    if (kg) {
      result.description = kg.description || '';
      result.founded = kg.founded || '';
      result.location = kg.headquarters || '';
      result.employees = kg.number_of_employees || '';
    }

    // Extract from snippets
    for (const r of (data.organic_results || []).slice(0, 3)) {
      const snippet = (r.snippet || '').toLowerCase();

      if (!result.founded) {
        const foundedMatch = snippet.match(/founded\s*(?:in\s*)?(\d{4})/);
        if (foundedMatch) result.founded = foundedMatch[1];
      }
      if (!result.employees) {
        const empMatch = snippet.match(/(\d[\d,]*)\s*(?:employees|staff|team members)/);
        if (empMatch) result.employees = empMatch[1];
      }
      if (!result.revenue) {
        const revMatch = snippet.match(/\$[\d.]+\s*(?:million|billion|M|B)/i);
        if (revMatch) result.revenue = revMatch[0];
      }
      if (!result.location) {
        const locMatch = snippet.match(/(?:based in|headquartered in|located in)\s*([^.]+)/i);
        if (locMatch) result.location = locMatch[1].trim();
      }
    }
  } catch {}

  return result;
}

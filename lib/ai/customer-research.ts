import * as cheerio from 'cheerio';
import { analyzeStructured } from './ai-service';
import { COMPANY } from '@/lib/config/company';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deep customer research engine.
 * Before generating any strategy, we RESEARCH the customer from multiple sources:
 * 1. Website deep scan (multiple pages, not just homepage)
 * 2. Google search for company news/reviews/mentions
 * 3. LinkedIn company data (size, employees, job openings)
 * 4. Customs/trade data cross-reference
 * 5. Product & pricing analysis from their website
 */

export interface CustomerResearch {
  // Website intelligence
  website_pages_scanned: number;
  products_found: string[];
  price_range: string;
  about_info: string;
  team_size_clue: string;
  shipping_markets: string[];
  tech_stack: string[];
  social_links: Record<string, string>;

  // Google intelligence
  google_mentions: string[];
  reviews_summary: string;
  news_mentions: string[];
  competitors_mentioned: string[];

  // LinkedIn intelligence
  linkedin_summary: string;
  employee_count_estimate: string;
  job_openings: string[];
  key_people: string[];

  // Customs intelligence
  customs_summary: string;
  import_volume: string;
  origin_countries: string[];
  hs_codes: string[];

  // Raw data for AI
  raw_website_text: string;
  raw_google_results: string;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Step 1: Deep website scan — scan homepage + about + products + contact pages
 */
async function scanWebsite(website: string): Promise<{
  products: string[];
  priceRange: string;
  aboutInfo: string;
  teamClue: string;
  markets: string[];
  socialLinks: Record<string, string>;
  rawText: string;
  pagesScanned: number;
}> {
  const result = {
    products: [] as string[],
    priceRange: '',
    aboutInfo: '',
    teamClue: '',
    markets: [] as string[],
    socialLinks: {} as Record<string, string>,
    rawText: '',
    pagesScanned: 0,
  };

  if (!website) return result;

  // Pages to scan
  const baseUrl = website.replace(/\/$/, '');
  const pagesToScan = [
    baseUrl,
    `${baseUrl}/about`,
    `${baseUrl}/about-us`,
    `${baseUrl}/pages/about`,
    `${baseUrl}/pages/about-us`,
    `${baseUrl}/collections`,
    `${baseUrl}/collections/all`,
    `${baseUrl}/products`,
    `${baseUrl}/shop`,
    `${baseUrl}/contact`,
  ];

  const allText: string[] = [];

  for (const pageUrl of pagesToScan.slice(0, 5)) { // Max 5 pages
    const html = await fetchPage(pageUrl);
    if (!html) continue;

    result.pagesScanned++;
    const $ = cheerio.load(html);

    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header').remove();
    const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);
    allText.push(pageText);

    // Extract products (from collection/shop pages)
    if (pageUrl.includes('collection') || pageUrl.includes('product') || pageUrl.includes('shop')) {
      $('h2, h3, .product-title, .product-name, [class*="product"]').each((_, el) => {
        const name = $(el).text().trim();
        if (name.length > 3 && name.length < 100) result.products.push(name);
      });
    }

    // Extract prices
    $('[class*="price"], .price, .money').each((_, el) => {
      const text = $(el).text().trim();
      if (text.match(/\$[\d,.]+/)) {
        if (!result.priceRange) result.priceRange = text;
      }
    });

    // Extract about info
    if (pageUrl.includes('about')) {
      const aboutText = $('main, .content, article, [class*="about"]').text().trim().slice(0, 1000);
      if (aboutText.length > 50) result.aboutInfo = aboutText;
    }

    // Social links
    $('a[href*="instagram.com"]').each((_, el) => { result.socialLinks.instagram = $(el).attr('href') || ''; });
    $('a[href*="linkedin.com"]').each((_, el) => { result.socialLinks.linkedin = $(el).attr('href') || ''; });
    $('a[href*="facebook.com"]').each((_, el) => { result.socialLinks.facebook = $(el).attr('href') || ''; });
    $('a[href*="tiktok.com"]').each((_, el) => { result.socialLinks.tiktok = $(el).attr('href') || ''; });

    // Shipping markets clue
    const bodyLower = pageText.toLowerCase();
    if (bodyLower.includes('free shipping') || bodyLower.includes('ship to')) {
      if (bodyLower.includes('usa') || bodyLower.includes('united states')) result.markets.push('USA');
      if (bodyLower.includes('europe') || bodyLower.includes('eu') || bodyLower.includes('uk')) result.markets.push('Europe');
      if (bodyLower.includes('australia')) result.markets.push('Australia');
      if (bodyLower.includes('worldwide') || bodyLower.includes('international')) result.markets.push('Global');
    }

    // Team size clue
    if (bodyLower.includes('our team') || bodyLower.includes('employees') || bodyLower.includes('founded')) {
      const teamMatch = pageText.match(/(\d+)\s*(team members|employees|people)/i);
      if (teamMatch) result.teamClue = `约${teamMatch[1]}人团队`;
      const foundedMatch = pageText.match(/founded\s*(?:in\s*)?(\d{4})/i);
      if (foundedMatch) result.teamClue += ` 成立于${foundedMatch[1]}年`;
    }
  }

  result.rawText = allText.join('\n\n').slice(0, 8000);
  result.products = [...new Set(result.products)].slice(0, 20);
  result.markets = [...new Set(result.markets)];

  return result;
}

/**
 * Step 2: Google search for company intelligence
 */
async function searchCompanyInfo(companyName: string): Promise<{
  mentions: string[];
  news: string[];
  competitors: string[];
  rawResults: string;
}> {
  const result = { mentions: [] as string[], news: [] as string[], competitors: [] as string[], rawResults: '' };

  const serpApiKey = process.env.SERPAPI_KEY;
  if (!serpApiKey) return result;

  try {
    // Search for company reviews/mentions
    const query = `"${companyName}" apparel OR clothing OR activewear`;
    const url = `https://serpapi.com/search.json?api_key=${serpApiKey}&q=${encodeURIComponent(query)}&num=5&engine=google`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.organic_results) {
      for (const r of data.organic_results.slice(0, 5)) {
        const snippet = `${r.title}: ${r.snippet || ''}`;
        result.mentions.push(snippet);

        // Detect competitors
        if (r.snippet?.toLowerCase().includes('vs') || r.snippet?.toLowerCase().includes('alternative')) {
          result.competitors.push(r.title);
        }
      }
      result.rawResults = data.organic_results.map((r: any) => `${r.title}\n${r.snippet}`).join('\n\n');
    }
  } catch {
    // Non-critical
  }

  return result;
}

/**
 * Step 3: LinkedIn company intelligence (from website links)
 */
async function getLinkedInIntel(linkedinUrl: string | undefined): Promise<{
  summary: string;
  employeeEstimate: string;
  jobOpenings: string[];
  keyPeople: string[];
}> {
  const result = { summary: '', employeeEstimate: '', jobOpenings: [] as string[], keyPeople: [] as string[] };

  if (!linkedinUrl) return result;

  // We can't scrape LinkedIn directly, but we can search for company info
  const serpApiKey = process.env.SERPAPI_KEY;
  if (!serpApiKey) return result;

  try {
    const companySlug = linkedinUrl.match(/linkedin\.com\/company\/([^\/]+)/)?.[1];
    if (!companySlug) return result;

    // Search for LinkedIn company info
    const query = `site:linkedin.com/company/${companySlug}`;
    const url = `https://serpapi.com/search.json?api_key=${serpApiKey}&q=${encodeURIComponent(query)}&num=3&engine=google`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.organic_results?.[0]) {
      result.summary = data.organic_results[0].snippet || '';
      // Extract employee count from snippet
      const empMatch = result.summary.match(/(\d[\d,]*)\s*(employees|followers)/i);
      if (empMatch) result.employeeEstimate = empMatch[0];
    }

    // Search for job openings
    const jobQuery = `site:linkedin.com "${companySlug}" jobs hiring`;
    const jobUrl = `https://serpapi.com/search.json?api_key=${serpApiKey}&q=${encodeURIComponent(jobQuery)}&num=3&engine=google`;
    const jobRes = await fetch(jobUrl);
    const jobData = await jobRes.json();

    if (jobData.organic_results) {
      for (const r of jobData.organic_results.slice(0, 3)) {
        if (r.title.toLowerCase().includes('job') || r.title.toLowerCase().includes('hiring')) {
          result.jobOpenings.push(r.title);
        }
      }
    }
  } catch {
    // Non-critical
  }

  return result;
}

/**
 * Step 4: Customs data analysis
 */
async function getCustomsIntel(leadId: string, supabase: SupabaseClient): Promise<{
  summary: string;
  volume: string;
  origins: string[];
  hsCodes: string[];
}> {
  const result = { summary: '', volume: '', origins: [] as string[], hsCodes: [] as string[] };

  const { data: matches } = await supabase
    .from('growth_customs_matches')
    .select('customs_record_id')
    .eq('lead_id', leadId)
    .limit(50);

  if (!matches || matches.length === 0) return result;

  const { data: records } = await supabase
    .from('growth_customs_records')
    .select('*')
    .in('id', matches.map((m: any) => m.customs_record_id));

  if (!records || records.length === 0) return result;

  const totalValue = records.reduce((sum: number, r: any) => sum + (Number(r.value_usd) || 0), 0);
  result.volume = `${records.length}条记录，总金额$${totalValue.toLocaleString()}`;
  result.origins = [...new Set(records.map((r: any) => r.origin_country).filter(Boolean))];
  result.hsCodes = [...new Set(records.map((r: any) => r.hs_code).filter(Boolean))].slice(0, 5);

  result.summary = `该客户有${records.length}条进口记录，总金额$${totalValue.toLocaleString()}。主要从${result.origins.join('、')}进口。HS编码：${result.hsCodes.join(', ')}`;

  return result;
}

/**
 * Full research pipeline: website + google + linkedin + customs
 */
export async function deepResearchCustomer(
  lead: Record<string, any>,
  supabase: SupabaseClient
): Promise<CustomerResearch> {
  // Run all research in parallel
  const [websiteData, googleData, linkedinData, customsData] = await Promise.all([
    scanWebsite(lead.website),
    searchCompanyInfo(lead.company_name),
    getLinkedInIntel(lead.contact_linkedin || lead.ai_analysis?.key_evidence?.find((e: string) => e.includes('linkedin'))),
    getCustomsIntel(lead.id, supabase),
  ]);

  return {
    website_pages_scanned: websiteData.pagesScanned,
    products_found: websiteData.products,
    price_range: websiteData.priceRange,
    about_info: websiteData.aboutInfo,
    team_size_clue: websiteData.teamClue,
    shipping_markets: websiteData.markets,
    tech_stack: [],
    social_links: websiteData.socialLinks,
    google_mentions: googleData.mentions,
    reviews_summary: googleData.mentions.slice(0, 3).join(' | '),
    news_mentions: googleData.news,
    competitors_mentioned: googleData.competitors,
    linkedin_summary: linkedinData.summary,
    employee_count_estimate: linkedinData.employeeEstimate,
    job_openings: linkedinData.jobOpenings,
    key_people: linkedinData.keyPeople,
    customs_summary: customsData.summary,
    import_volume: customsData.volume,
    origin_countries: customsData.origins,
    hs_codes: customsData.hsCodes,
    raw_website_text: websiteData.rawText,
    raw_google_results: googleData.rawResults,
  };
}

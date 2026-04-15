import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { extractDomain } from '@/lib/growth/lead-engine';
import { enqueueUrls } from '@/lib/scrapers/source-queue';

/**
 * POST /api/discover/custom
 * User-triggered discovery with custom keywords/markets.
 * Auth: user session (not cron)
 *
 * Body: { keywords: string[], markets: string[], customer_types: string[] }
 */
export async function POST(request: Request) {
  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let keywords: string[] = [];
  let markets: string[] = [];
  let customerTypes: string[] = [];

  try {
    const body = await request.json();
    keywords = body.keywords || [];
    markets = body.markets || [];
    customerTypes = body.customer_types || [];
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (keywords.length === 0) {
    return NextResponse.json({ error: '请至少选择一个关键词' }, { status: 400 });
  }

  const serpApiKey = process.env.SERPAPI_KEY;
  if (!serpApiKey) {
    return NextResponse.json({ error: 'SERPAPI_KEY not configured' }, { status: 500 });
  }

  const serviceSupabase = createServiceClient();

  // Build search queries from user selections
  const queries: string[] = [];
  for (const kw of keywords.slice(0, 5)) { // Max 5 keywords
    for (const market of (markets.length > 0 ? markets.slice(0, 3) : [''])) { // Max 3 markets
      const typeFilter = customerTypes.length > 0
        ? customerTypes.map(t => {
            if (t === 'brand') return 'brand';
            if (t === 'retailer') return 'retailer store';
            if (t === 'ecommerce') return 'online shop';
            if (t === 'wholesale') return 'wholesale';
            if (t === 'dtc') return 'DTC direct';
            return '';
          }).filter(Boolean)[0] || ''
        : '';
      queries.push(`"${kw}" ${typeFilter} ${market} official website shop`.trim());
    }
  }

  // Cap total queries to 10
  const finalQueries = queries.slice(0, 10);

  let totalFound = 0;
  let totalNew = 0;
  const details: { query: string; found: number; new: number }[] = [];

  // Load existing domains for dedup
  const { data: existingLeads } = await serviceSupabase
    .from('growth_leads')
    .select('website')
    .not('website', 'is', null);

  const { data: existingQueue } = await serviceSupabase
    .from('lead_source_queue')
    .select('target_url')
    .not('target_url', 'is', null);

  const existingDomains = new Set([
    ...(existingLeads || []).map((l: any) => extractDomain(l.website)),
    ...(existingQueue || []).map((q: any) => extractDomain(q.target_url)),
  ]);

  // Skip domains
  const SKIP_DOMAINS = [
    'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'pinterest.com',
    'instagram.com', 'tiktok.com', 'linkedin.com', 'reddit.com',
    'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com',
    'alibaba.com', 'aliexpress.com', 'trustpilot.com', 'yelp.com',
    'wikipedia.org', 'google.com', 'bing.com', 'forbes.com', 'vogue.com',
    'nike.com', 'adidas.com', 'lululemon.com', 'gymshark.com',
    'shopify.com', 'squarespace.com', 'wix.com', 'github.com',
  ];

  for (const query of finalQueries) {
    try {
      // Try Google first
      const googleUrl = `https://serpapi.com/search.json?api_key=${serpApiKey}&q=${encodeURIComponent(query)}&num=10&engine=google`;
      const res = await fetch(googleUrl);
      const data = await res.json();

      const urls = (data.organic_results || [])
        .map((r: any) => {
          let link = r.link as string;
          if (!link) return '';
          try {
            const u = new URL(link);
            ['srsltid', 'utm_source', 'utm_medium', 'gclid', 'fbclid'].forEach(p => u.searchParams.delete(p));
            if (['/pages/', '/collections/', '/products/', '/about'].some(p => u.pathname.startsWith(p))) {
              return `${u.protocol}//${u.host}`;
            }
            return u.toString().replace(/\/$/, '');
          } catch { return link; }
        })
        .filter((link: string) => {
          if (!link) return false;
          const domain = extractDomain(link);
          if (SKIP_DOMAINS.some(s => domain.includes(s))) return false;
          if (existingDomains.has(domain)) return false;
          if (link.endsWith('.pdf')) return false;
          return true;
        });

      // Enqueue new URLs
      if (urls.length > 0) {
        const { queued } = await enqueueUrls(
          urls.map((url: string) => ({ url, source: 'google', priority: 25, data: { query } })),
          serviceSupabase
        );
        totalFound += urls.length;
        totalNew += queued;
        details.push({ query, found: urls.length, new: queued });

        // Add to existing set to dedup within batch
        urls.forEach((url: string) => existingDomains.add(extractDomain(url)));
      } else {
        details.push({ query, found: 0, new: 0 });
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 300));
    } catch {
      details.push({ query, found: 0, new: 0 });
    }
  }

  // Log discovery run
  await serviceSupabase.from('discovery_runs').insert({
    source: 'custom_search',
    query_used: finalQueries.join(' | '),
    urls_found: totalFound,
    urls_new: totalNew,
    metadata: { keywords, markets, customerTypes, details },
  });

  return NextResponse.json({
    success: true,
    queries_run: finalQueries.length,
    total_found: totalFound,
    total_new: totalNew,
    details,
  });
}

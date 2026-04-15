import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { discoverLeads } from '@/lib/scrapers/google-discovery';
import { discoverFromBing } from '@/lib/scrapers/duckduckgo-discovery';
import { discoverFromSocialAndEcom } from '@/lib/scrapers/social-ecom-discovery';
import { learnFromWonDeals, expandSearchScope } from '@/lib/scrapers/search-intelligence';
import { enqueueUrls } from '@/lib/scrapers/source-queue';
import { extractDomain } from '@/lib/growth/lead-engine';

/**
 * POST /api/cron/discover
 * Cron (every 2 hours): discovers new leads from 4 channels + self-learning:
 * 1. Google Search — brand websites
 * 2. Bing Search — broader coverage
 * 3. Social + E-commerce — IG brands + Shopify stores
 * 4. Self-Learning — queries generated from won deals + expanded scope
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const results: Record<string, any> = {};

    const serpApiKey = process.env.SERPAPI_KEY;
    if (!serpApiKey) {
      return NextResponse.json({ success: true, message: 'SERPAPI_KEY not configured', total_new: 0 });
    }

    // Phase 1: Run 3 preset channels in parallel
    const [googleResult, bingResult, socialResult] = await Promise.allSettled([
      discoverLeads(supabase, 4),
      discoverFromBing(supabase, 3),
      discoverFromSocialAndEcom(supabase, 4),
    ]);

    results.google = googleResult.status === 'fulfilled' ? googleResult.value : { error: (googleResult as any).reason?.message };
    results.bing = bingResult.status === 'fulfilled' ? bingResult.value : { error: (bingResult as any).reason?.message };
    results.social_ecom = socialResult.status === 'fulfilled' ? socialResult.value : { error: (socialResult as any).reason?.message };

    // Phase 2: Self-learning — generate new queries from historical data
    let learnedNew = 0;
    try {
      // Learn from won deals: "what do our best customers look like?"
      const wonQueries = await learnFromWonDeals(supabase);

      // Expand scope: "if X works in USA, try Canada/UK/Germany"
      const expandedQueries = await expandSearchScope(supabase);

      const allLearnedQueries = [...wonQueries, ...expandedQueries].slice(0, 5);

      if (allLearnedQueries.length > 0) {
        // Load existing domains for dedup
        const { data: existingLeads } = await supabase
          .from('growth_leads').select('website').not('website', 'is', null);
        const { data: existingQueue } = await supabase
          .from('lead_source_queue').select('target_url').not('target_url', 'is', null);
        const existing = new Set([
          ...(existingLeads || []).map((l: any) => extractDomain(l.website)),
          ...(existingQueue || []).map((q: any) => extractDomain(q.target_url)),
        ]);

        const SKIP = ['youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
          'amazon.com', 'ebay.com', 'wikipedia.org', 'google.com', 'linkedin.com',
          'trustpilot.com', 'nike.com', 'adidas.com', 'lululemon.com', 'gymshark.com',
          'shopify.com', 'wix.com', 'squarespace.com'];

        for (const query of allLearnedQueries) {
          try {
            const url = `https://serpapi.com/search.json?api_key=${serpApiKey}&q=${encodeURIComponent(query)}&num=5&engine=google`;
            const res = await fetch(url);
            const data = await res.json();

            const urls = (data.organic_results || [])
              .map((r: any) => r.link as string)
              .filter((link: string) => {
                if (!link) return false;
                const d = extractDomain(link);
                return !SKIP.some(s => d.includes(s)) && !existing.has(d);
              });

            if (urls.length > 0) {
              const { queued } = await enqueueUrls(
                urls.map((u: string) => ({ url: u, source: 'google', priority: 20, data: { from_learning: true, query } })),
                supabase
              );
              learnedNew += queued;
              urls.forEach((u: string) => existing.add(extractDomain(u)));
            }

            await new Promise(r => setTimeout(r, 500));
          } catch {}
        }

        // Log learned discovery
        if (learnedNew > 0) {
          await supabase.from('discovery_runs').insert({
            source: 'self_learning',
            query_used: allLearnedQueries.join(' | '),
            urls_found: learnedNew,
            urls_new: learnedNew,
            metadata: { won_deal_queries: wonQueries.length, expanded_queries: expandedQueries.length },
          });
        }
      }

      results.self_learning = {
        queries_generated: allLearnedQueries.length,
        urls_new: learnedNew,
        from_won_deals: wonQueries.length,
        from_expansion: expandedQueries.length,
      };
    } catch (err: any) {
      results.self_learning = { error: err.message };
    }

    const totalNew = (results.google?.urls_new || 0) + (results.bing?.urls_new || 0) +
      (results.social_ecom?.urls_new || 0) + learnedNew;
    const totalFound = (results.google?.urls_found || 0) + (results.bing?.urls_found || 0) +
      (results.social_ecom?.urls_found || 0) + learnedNew;

    return NextResponse.json({
      success: true,
      total_found: totalFound,
      total_new: totalNew,
      sources: results,
    });
  } catch (err: any) {
    console.error('[Discover Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

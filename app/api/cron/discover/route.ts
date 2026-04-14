import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { discoverLeads } from '@/lib/scrapers/google-discovery';
import { discoverFromBing } from '@/lib/scrapers/duckduckgo-discovery';

/**
 * POST /api/cron/discover
 * Cron (every 2 hours): discovers new lead URLs from multiple search engines.
 * - DuckDuckGo: FREE, unlimited, runs every time (10 queries = ~100 URLs)
 * - SerpAPI: paid, higher quality, runs 2x/day max to conserve quota
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

    // Run Google and Bing in parallel via SerpAPI (different results from same API)
    const [googleResult, bingResult] = await Promise.allSettled([
      discoverLeads(supabase, 5),      // 5 Google queries
      discoverFromBing(supabase, 5),   // 5 Bing queries
    ]);

    results.google = googleResult.status === 'fulfilled' ? googleResult.value : { error: (googleResult as any).reason?.message };
    results.bing = bingResult.status === 'fulfilled' ? bingResult.value : { error: (bingResult as any).reason?.message };

    const totalNew = (results.google?.urls_new || 0) + (results.bing?.urls_new || 0);
    const totalFound = (results.google?.urls_found || 0) + (results.bing?.urls_found || 0);

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

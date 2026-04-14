import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { discoverLeads } from '@/lib/scrapers/google-discovery';
import { discoverFromDDG } from '@/lib/scrapers/duckduckgo-discovery';

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

    // Always run DuckDuckGo (free, unlimited)
    try {
      results.duckduckgo = await discoverFromDDG(supabase, 10);
    } catch (err: any) {
      results.duckduckgo = { error: err.message };
    }

    // Run SerpAPI only if configured, and only at hours 8 and 20 (2x/day to save quota)
    const hour = new Date().getUTCHours();
    const serpApiKey = process.env.SERPAPI_KEY;
    if (serpApiKey && (hour === 8 || hour === 20)) {
      try {
        results.serpapi = await discoverLeads(supabase, 5); // 5 queries to conserve
      } catch (err: any) {
        results.serpapi = { error: err.message };
      }
    }

    const totalNew = (results.duckduckgo?.urls_new || 0) + (results.serpapi?.urls_new || 0);
    const totalFound = (results.duckduckgo?.urls_found || 0) + (results.serpapi?.urls_found || 0);

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

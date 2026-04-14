import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { discoverLeads } from '@/lib/scrapers/google-discovery';

/**
 * POST /api/cron/discover
 * Cron (every 2 hours): discovers new lead URLs from Google Search.
 * Enqueues them into lead_source_queue for enrichment.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.SERPAPI_KEY) {
    return NextResponse.json({
      success: true,
      message: 'SERPAPI_KEY not configured. Sign up at https://serpapi.com/',
      urls_new: 0,
    });
  }

  try {
    const supabase = createServiceClient();

    const result = await discoverLeads(supabase, 8);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[Discover Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

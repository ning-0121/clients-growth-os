import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { discoverFromGoogle } from '@/lib/scrapers/google-discovery';

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

  const googleKey = process.env.GOOGLE_CUSTOM_SEARCH_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!googleKey || !searchEngineId) {
    return NextResponse.json({
      success: true,
      message: 'Google Custom Search not configured. Set GOOGLE_CUSTOM_SEARCH_KEY and GOOGLE_SEARCH_ENGINE_ID.',
      urls_new: 0,
    });
  }

  try {
    const supabase = createServiceClient();

    const result = await discoverFromGoogle(googleKey, searchEngineId, supabase, 8);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[Discover Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

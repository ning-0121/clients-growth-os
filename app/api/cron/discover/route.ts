import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { discoverLeads } from '@/lib/scrapers/google-discovery';
import { discoverFromBing } from '@/lib/scrapers/duckduckgo-discovery';
import { discoverFromSocialAndEcom } from '@/lib/scrapers/social-ecom-discovery';

/**
 * POST /api/cron/discover
 * Cron (every 2 hours): discovers new leads from 3 channels in parallel:
 * 1. Google Search — activewear/sportswear brand websites
 * 2. Bing Search — different results, broader coverage
 * 3. Social + E-commerce — Instagram brands + Shopify stores
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

    // Run all 3 discovery channels in parallel
    const [googleResult, bingResult, socialResult] = await Promise.allSettled([
      discoverLeads(supabase, 4),               // 4 Google queries
      discoverFromBing(supabase, 3),             // 3 Bing queries
      discoverFromSocialAndEcom(supabase, 4),    // 4 Social/Ecom queries (IG + Shopify)
    ]);

    results.google = googleResult.status === 'fulfilled' ? googleResult.value : { error: (googleResult as any).reason?.message };
    results.bing = bingResult.status === 'fulfilled' ? bingResult.value : { error: (bingResult as any).reason?.message };
    results.social_ecom = socialResult.status === 'fulfilled' ? socialResult.value : { error: (socialResult as any).reason?.message };

    const totalNew = (results.google?.urls_new || 0) + (results.bing?.urls_new || 0) + (results.social_ecom?.urls_new || 0);
    const totalFound = (results.google?.urls_found || 0) + (results.bing?.urls_found || 0) + (results.social_ecom?.urls_found || 0);

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

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runOutboundPipeline } from '@/lib/agents';
import { generateDailySearchPlans } from '@/lib/config/search-keywords';

export const maxDuration = 300;

/**
 * GET /api/agents/outbound
 * Vercel Cron trigger — 按每日搜索计划轮换品类和地区搜索。
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const dayOfWeek = new Date().getDay();
    const plans = generateDailySearchPlans(dayOfWeek);

    const results = [];
    for (const plan of plans) {
      const result = await runOutboundPipeline(supabase, {
        keywords: plan.keywords,
        platforms: plan.platforms,
        region: plan.region,
        maxResults: plan.maxResults,
        excludeKeywords: plan.excludeKeywords,
      });
      results.push({ plan: plan.name, ...result });
    }

    return NextResponse.json({ success: true, plansExecuted: results.length, results });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Outbound Cron] Error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

/**
 * POST /api/agents/outbound
 * Manual trigger with custom search criteria.
 *
 * Body: {
 *   keywords: string[],
 *   platforms: string[],
 *   region?: string,
 *   productCategories?: string[],
 *   maxResults?: number
 * }
 *
 * Auth: CRON_SECRET for automated triggers, or user session for manual.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.keywords?.length) {
      return NextResponse.json({ error: '缺少搜索关键词 (keywords)' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const result = await runOutboundPipeline(supabase, {
      keywords: body.keywords,
      platforms: body.platforms || ['google', 'instagram'],
      region: body.region,
      productCategories: body.productCategories,
      maxResults: body.maxResults || 10,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Outbound Pipeline] Error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

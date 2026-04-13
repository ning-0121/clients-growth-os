import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runOutboundPipeline } from '@/lib/agents';
import { COMPANY } from '@/lib/config/company';

/**
 * GET /api/agents/outbound
 * Vercel Cron trigger — runs outbound pipeline with default keywords.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    const result = await runOutboundPipeline(supabase, {
      keywords: COMPANY.products.slice(0, 5),
      platforms: ['google', 'instagram'],
      maxResults: 10,
    });

    return NextResponse.json({ success: true, ...result });
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

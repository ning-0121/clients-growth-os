import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { discoverFromFaire } from '@/lib/scrapers/channels/faire';
import { startJobLog, finishJobLog } from '@/lib/supervisor/job-logger';

/**
 * POST /api/discovery/faire
 * Admin/manual trigger — discover brands from Faire.com
 * Body: { maxBrandsPerCategory?: number, categoryUrl?: string }
 * Auth: admin user session OR CRON_SECRET (for cron jobs)
 */
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }

async function handle(request: Request) {
  // Allow cron calls with bearer token, else require admin
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get('x-vercel-cron');
  const isCron = vercelCron || (cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isCron) {
    await requireAuth();
    const profile = await getCurrentProfile();
    if (profile?.role !== '管理员') {
      return NextResponse.json({ error: '仅管理员' }, { status: 403 });
    }
  }

  const supabase = createServiceClient();
  const logId = await startJobLog(supabase, 'discover', 'faire');

  try {
    let opts: any = { maxBrandsPerCategory: 50 };
    try {
      const body = await request.json();
      if (body.maxBrandsPerCategory) opts.maxBrandsPerCategory = body.maxBrandsPerCategory;
      if (body.categoryUrl) opts.categoryUrl = body.categoryUrl;
    } catch {}

    const result = await discoverFromFaire(supabase, opts);

    await finishJobLog(supabase, logId, {
      status: result.error ? 'error' : 'success',
      outputCount: result.urls_queued,
      successCount: result.urls_queued,
      errorCount: result.error ? 1 : 0,
      errorMessage: result.error,
      metadata: {
        total_found: result.total_found,
        duplicates: result.duplicates,
        brands_with_email: result.brands_with_email,
        brands_with_ig: result.brands_with_ig,
      },
      apiCalls: 1,
    });

    return NextResponse.json({ success: !result.error, ...result });
  } catch (err: any) {
    await finishJobLog(supabase, logId, { status: 'error', errorMessage: err.message, errorCount: 1 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

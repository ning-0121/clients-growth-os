import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { discoverFromAmazon } from '@/lib/scrapers/channels/amazon';
import { startJobLog, finishJobLog } from '@/lib/supervisor/job-logger';

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }

async function handle(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isCron) {
    await requireAuth();
    const profile = await getCurrentProfile();
    if (profile?.role !== '管理员') {
      return NextResponse.json({ error: '仅管理员' }, { status: 403 });
    }
  }

  const supabase = createServiceClient();
  const logId = await startJobLog(supabase, 'discover', 'amazon');

  try {
    let opts: any = { maxSellers: 50 };
    try {
      const body = await request.json();
      if (body.maxSellers) opts.maxSellers = body.maxSellers;
      if (body.bestsellerUrl) opts.bestsellerUrl = body.bestsellerUrl;
      if (body.keyword) opts.keyword = body.keyword;
    } catch {}

    const result = await discoverFromAmazon(supabase, opts);

    await finishJobLog(supabase, logId, {
      status: result.error ? 'error' : 'success',
      outputCount: result.urls_queued,
      successCount: result.urls_queued,
      errorCount: result.error ? 1 : 0,
      errorMessage: result.error,
      metadata: {
        total_found: result.total_found,
        duplicates: result.duplicates,
        brands_with_business_name: result.brands_with_business_name,
      },
      apiCalls: 1,
    });

    return NextResponse.json({ success: !result.error, ...result });
  } catch (err: any) {
    await finishJobLog(supabase, logId, { status: 'error', errorMessage: err.message, errorCount: 1 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { discoverFromTikTokShop } from '@/lib/scrapers/channels/tiktok-shop';
import { startJobLog, finishJobLog } from '@/lib/supervisor/job-logger';

// TikTok profile fetches + search queries can be slow
export const maxDuration = 120;

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
  const logId = await startJobLog(supabase, 'discover', 'tiktok_shop');

  try {
    let opts: any = { maxQueries: 4, perQueryResults: 8 };
    try {
      const body = await request.json();
      if (body.maxQueries) opts.maxQueries = body.maxQueries;
      if (body.perQueryResults) opts.perQueryResults = body.perQueryResults;
    } catch {}

    const result = await discoverFromTikTokShop(supabase, opts);

    await finishJobLog(supabase, logId, {
      status: result.error ? 'error' : 'success',
      outputCount: result.urls_queued,
      successCount: result.urls_queued,
      errorCount: result.error ? 1 : 0,
      errorMessage: result.error,
      metadata: {
        queries_run: result.queries_run,
        profiles_found: result.profiles_found,
        duplicates: result.duplicates,
      },
      apiCalls: result.queries_run,
    });

    return NextResponse.json({ success: !result.error, ...result });
  } catch (err: any) {
    await finishJobLog(supabase, logId, { status: 'error', errorMessage: err.message, errorCount: 1 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

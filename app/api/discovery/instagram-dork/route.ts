import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { discoverFromInstagramDork } from '@/lib/scrapers/channels/instagram-dork';
import { startJobLog, finishJobLog } from '@/lib/supervisor/job-logger';

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }

async function handle(request: Request) {
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
  const logId = await startJobLog(supabase, 'discover', 'instagram_dork');

  try {
    let opts: any = { maxQueries: 3, perQueryResults: 10 };
    try {
      const body = await request.json();
      if (body.maxQueries) opts.maxQueries = body.maxQueries;
      if (body.perQueryResults) opts.perQueryResults = body.perQueryResults;
    } catch {}

    const result = await discoverFromInstagramDork(supabase, opts);

    await finishJobLog(supabase, logId, {
      status: result.error ? 'error' : 'success',
      outputCount: result.urls_queued,
      successCount: result.urls_queued,
      errorCount: result.error ? 1 : 0,
      errorMessage: result.error,
      metadata: {
        queries_run: result.queries_run,
        profiles_found: result.profiles_found,
        emails_extracted: result.emails_extracted,
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

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { discoverFromTradeShow, TRADE_SHOWS } from '@/lib/scrapers/channels/exhibitor';
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

  let showKey: keyof typeof TRADE_SHOWS = 'sourcing-at-magic';
  try {
    const body = await request.json();
    if (body.show && body.show in TRADE_SHOWS) showKey = body.show;
  } catch {}

  const supabase = createServiceClient();
  const logId = await startJobLog(supabase, 'discover', `exhibitor:${showKey}`);

  try {
    const result = await discoverFromTradeShow(supabase, showKey);

    await finishJobLog(supabase, logId, {
      status: result.error ? 'error' : 'success',
      outputCount: result.urls_queued,
      successCount: result.urls_queued,
      errorCount: result.error ? 1 : 0,
      errorMessage: result.error,
      metadata: {
        show: result.show_name,
        total_found: result.total_found,
        duplicates: result.duplicates,
      },
    });

    return NextResponse.json({ success: !result.error, ...result });
  } catch (err: any) {
    await finishJobLog(supabase, logId, { status: 'error', errorMessage: err.message, errorCount: 1 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

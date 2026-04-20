import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { discoverFundedBrands } from '@/lib/scrapers/channels/funding-monitor';
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
    if (profile?.role !== '管理员') return NextResponse.json({ error: '仅管理员' }, { status: 403 });
  }

  const supabase = createServiceClient();
  const logId = await startJobLog(supabase, 'discover', 'funding_monitor');

  try {
    const result = await discoverFundedBrands(supabase);
    await finishJobLog(supabase, logId, {
      status: result.error ? 'error' : 'success',
      outputCount: result.total_queued,
      successCount: result.total_queued,
      errorCount: result.error ? 1 : 0,
      errorMessage: result.error,
      metadata: {
        kickstarter_found: result.kickstarter_found,
        producthunt_found: result.producthunt_found,
        duplicates: result.duplicates,
      },
    });
    return NextResponse.json({ success: !result.error, ...result });
  } catch (err: any) {
    await finishJobLog(supabase, logId, { status: 'error', errorMessage: err.message, errorCount: 1 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

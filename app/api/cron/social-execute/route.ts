import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { executeSocialEngagements } from '@/lib/social/phantombuster-executor';

/**
 * POST /api/cron/social-execute
 * Drains the queued social_engagements table by launching PhantomBuster
 * phantoms. Runs every hour; batches of 10 per run so we stay comfortably
 * under PB's launch rate limits and leave headroom for manual re-triggers.
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const summary = await executeSocialEngagements(supabase, { batchSize: 10 });
    return NextResponse.json({ success: true, ...summary });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { executeSocialEngagements } from '@/lib/social/phantombuster-executor';
import { getWarmupCaps } from '@/lib/social/warmup';

// PhantomBuster launches with 800ms spacing between calls
export const maxDuration = 120;

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
    // Cron runs 3x/day, so per-run cap = daily cap / 3 (rounded up).
    // Safety net in case planner was bypassed / manually seeded.
    const caps = getWarmupCaps();
    const dailyMax = Math.max(caps.ig_comments, caps.ig_dms, caps.linkedin_connects);
    const batchSize = Math.max(1, Math.ceil(dailyMax / 3));

    const summary = await executeSocialEngagements(supabase, { batchSize });
    return NextResponse.json({ success: true, warmup: caps, batch_size: batchSize, ...summary });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

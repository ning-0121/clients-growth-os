import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { recalculateAllProbabilities } from '@/lib/growth/deal-probability';

/**
 * POST /api/cron/probability
 * Cron (every hour): recalculates deal probability for all active leads.
 * Processes 50 leads per run, prioritizing those not updated recently.
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  const vercelCron = request.headers.get("x-vercel-cron"); if (!vercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const result = await recalculateAllProbabilities(supabase, 50);

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Probability Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

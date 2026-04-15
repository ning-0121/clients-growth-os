import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runSelfEvolution } from '@/lib/scrapers/self-evolution';
import { runWeeklyUpgrade } from '@/lib/scrapers/auto-upgrade';

/**
 * POST /api/cron/evolve
 * Daily: GitHub scan for new tools
 * Weekly (Sunday): full upgrade — analyze + discover + auto-apply new skills
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get('x-vercel-cron');

  if (!vercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Daily: GitHub + tech search
    const dailyResult = await runSelfEvolution(supabase);

    // Weekly (Sunday): full upgrade with AI analysis
    let weeklyResult = null;
    const isSunday = new Date().getDay() === 0;
    if (isSunday) {
      weeklyResult = await runWeeklyUpgrade(supabase);
    }

    return NextResponse.json({
      success: true,
      daily: dailyResult,
      weekly: weeklyResult,
      is_upgrade_day: isSunday,
    });
  } catch (err: any) {
    console.error('[Self-Evolution] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

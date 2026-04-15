import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runSelfEvolution } from '@/lib/scrapers/self-evolution';

/**
 * POST /api/cron/evolve
 * Daily cron: searches GitHub and tech communities for new tools/techniques
 * to improve the system's customer finding capabilities.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const result = await runSelfEvolution(supabase);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[Self-Evolution] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

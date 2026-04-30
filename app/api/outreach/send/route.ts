import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { processOutreachQueue } from '@/lib/outreach/sequence-engine';

// AI email generation + Resend API calls for batch of 10
export const maxDuration = 120;

/**
 * POST /api/outreach/send
 * Cron endpoint: processes the outreach queue — generates AI emails and sends them.
 * Called every 15 minutes by Vercel Cron.
 *
 * Auth: CRON_SECRET header (not user session).
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  // Validate cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    let batchSize = 10;
    try {
      const body = await request.json();
      if (body.batch_size) batchSize = Math.min(body.batch_size, 20);
    } catch {
      // No body — use defaults
    }

    const result = await processOutreachQueue(supabase, batchSize);

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Outreach Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

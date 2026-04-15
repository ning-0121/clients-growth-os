import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runVerificationPipeline } from '@/lib/growth/verification-pipeline';

/**
 * POST /api/leads/verify
 * Trigger the multi-round verification pipeline.
 * Supports two auth modes:
 * - CRON_SECRET Bearer token (for Vercel Cron)
 * - User session (admin role)
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  let supabase: any;

  // Auth mode 1: Cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    supabase = createServiceClient();
  } else {
    // Auth mode 2: User session (admin)
    supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!profile || profile.role !== '管理员') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
  }

  let batchSize = 20;
  try {
    const body = await request.json();
    if (body.batch_size && typeof body.batch_size === 'number') {
      batchSize = Math.min(body.batch_size, 50);
    }
  } catch {
    // No body — use defaults
  }

  const result = await runVerificationPipeline(supabase, batchSize);

  return NextResponse.json({ success: true, ...result });
}

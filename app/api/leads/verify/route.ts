import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runVerificationPipeline } from '@/lib/growth/verification-pipeline';

/**
 * POST /api/leads/verify
 * Trigger the multi-round verification pipeline.
 * Designed to be called by Vercel Cron (every 15 min) or manually by admin.
 *
 * Optional body: { batch_size?: number }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // Verify auth
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check admin role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (!profile || profile.role !== '管理员') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  let batchSize = 20;
  try {
    const body = await request.json();
    if (body.batch_size && typeof body.batch_size === 'number') {
      batchSize = Math.min(body.batch_size, 50);
    }
  } catch {
    // No body or invalid JSON — use defaults
  }

  const result = await runVerificationPipeline(supabase, batchSize);

  return NextResponse.json({
    success: true,
    ...result,
  });
}

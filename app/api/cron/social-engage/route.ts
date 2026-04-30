import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { planEngagements } from '@/lib/social/engagement-planner';
import { getWarmupCaps } from '@/lib/social/warmup';

// AI content generation for up to 30 engagements/day
export const maxDuration = 120;

/**
 * POST /api/cron/social-engage
 * Cron endpoint (daily): selects leads for social engagement,
 * generates personalized content, stores as queued engagements.
 * PhantomBuster agents pick these up for execution.
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Apply warm-up caps for new phantom accounts (ramps 20% → 100% over 14 days)
    const caps = getWarmupCaps();
    const planned = await planEngagements(supabase, caps.ig_comments, caps.linkedin_connects);

    // Store as queued engagements
    if (planned.length > 0) {
      const { error } = await supabase.from('social_engagements').insert(
        planned.map((p) => ({
          lead_id: p.lead_id,
          platform: p.platform,
          engagement_type: p.engagement_type,
          target_url: p.target_url,
          content: p.content,
          status: 'queued',
        }))
      );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      planned: planned.length,
      instagram: planned.filter((p) => p.platform === 'instagram').length,
      linkedin: planned.filter((p) => p.platform === 'linkedin').length,
      warmup: caps,
    });
  } catch (err: any) {
    console.error('[Social Engage Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

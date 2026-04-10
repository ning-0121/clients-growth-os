import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { planEngagements } from '@/lib/social/engagement-planner';

/**
 * POST /api/cron/social-engage
 * Cron endpoint (daily): selects leads for social engagement,
 * generates personalized content, stores as queued engagements.
 * PhantomBuster agents pick these up for execution.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Plan engagements (max 10 IG comments, 20 LinkedIn connections per day)
    const planned = await planEngagements(supabase, 10, 20);

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
    });
  } catch (err: any) {
    console.error('[Social Engage Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

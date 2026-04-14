import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { resetStuckItems, retryFailedItems, getQueueStats } from '@/lib/scrapers/source-queue';
import { enrollLeadInSequence } from '@/lib/outreach/sequence-engine';

/**
 * POST /api/cron/orchestrate
 * Master orchestrator (every 30 min): ensures no leads get stuck between pipeline stages.
 *
 * 1. Reset stuck queue items (processing > 30 min)
 * 2. Retry failed items with backoff
 * 3. Auto-enroll verified leads that missed outreach
 * 4. Mark timed-out verifications as failed
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    // 1. Reset stuck queue items
    const stuckReset = await resetStuckItems(supabase);

    // 2. Retry failed queue items
    const retried = await retryFailedItems(supabase);

    // 3. Find verified leads that should be in outreach but aren't
    const { data: missedLeads } = await supabase
      .from('growth_leads')
      .select('id, contact_email')
      .eq('verification_status', 'completed')
      .eq('ai_recommendation', 'pursue')
      .eq('outreach_status', 'none')
      .not('contact_email', 'is', null)
      .limit(20);

    let outreachEnrolled = 0;

    if (missedLeads && missedLeads.length > 0) {
      // Find default active sequence
      const { data: defaultSeq } = await supabase
        .from('outreach_sequences')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      const seqId = defaultSeq?.[0]?.id;

      if (seqId) {
        for (const lead of missedLeads) {
          try {
            const result = await enrollLeadInSequence(lead.id, seqId, supabase);
            if (result.success) outreachEnrolled++;
          } catch {
            // Non-critical
          }
        }
      }
    }

    // 4. Mark timed-out verifications as failed (>24h stuck)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: timedOut } = await supabase
      .from('growth_leads')
      .update({ verification_status: 'failed' })
      .in('verification_status', ['pending', 'round_1', 'round_2', 'round_3'])
      .lt('updated_at', oneDayAgo)
      .select('id');

    const verificationsTimedOut = timedOut?.length || 0;

    // 5. Get queue stats for monitoring
    const queueStats = await getQueueStats(supabase);

    return NextResponse.json({
      success: true,
      orchestration: {
        stuck_queue_reset: stuckReset,
        failed_retried: retried,
        outreach_enrolled: outreachEnrolled,
        verifications_timed_out: verificationsTimedOut,
      },
      queue: queueStats,
    });
  } catch (err: any) {
    console.error('[Orchestrate Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

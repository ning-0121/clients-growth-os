import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { transformPhantomBusterOutput } from '@/lib/growth/phantombuster-transformer';
import { runIntakePipeline } from '@/lib/growth/intake-pipeline';

/**
 * POST /api/webhooks/phantombuster
 * Receives PhantomBuster agent completion webhook.
 * Transforms scraped data into leads and runs through intake pipeline.
 *
 * Expected body: {
 *   source_type: 'ig' | 'linkedin',
 *   results: any[],          // PhantomBuster output rows
 *   agent_id?: string,
 *   webhook_secret?: string   // for auth validation
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate webhook secret if configured
    const expectedSecret = process.env.PHANTOMBUSTER_WEBHOOK_SECRET;
    if (expectedSecret && body.webhook_secret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
    }

    const sourceType = body.source_type;
    const results = body.results;

    if (!sourceType || !Array.isArray(results)) {
      return NextResponse.json(
        { error: 'Missing source_type or results array' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Log automation run
    const { data: run } = await supabase
      .from('automation_runs')
      .insert({
        source: sourceType === 'ig' ? 'phantombuster_ig' : 'phantombuster_linkedin',
        status: 'running',
        leads_found: results.length,
        metadata: { agent_id: body.agent_id },
      })
      .select('id')
      .single();

    // Transform PB output to RawLeadInput
    const leads = transformPhantomBusterOutput(results, sourceType);

    if (leads.length === 0) {
      if (run) {
        await supabase
          .from('automation_runs')
          .update({ status: 'completed', leads_ingested: 0, completed_at: new Date().toISOString() })
          .eq('id', run.id);
      }
      return NextResponse.json({ success: true, total: 0, message: 'No valid leads found' });
    }

    // Run through intake pipeline
    const systemUserId = process.env.SYSTEM_USER_ID || '';
    const triggerType = 'auto_scrape' as const;

    const pipelineResult = await runIntakePipeline(leads, triggerType, systemUserId, supabase as any);

    // Update automation run
    if (run) {
      await supabase
        .from('automation_runs')
        .update({
          status: 'completed',
          leads_ingested: pipelineResult.qualified,
          completed_at: new Date().toISOString(),
        })
        .eq('id', run.id);
    }

    return NextResponse.json({
      success: true,
      ...pipelineResult,
    });
  } catch (err: any) {
    console.error('[PhantomBuster Webhook] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

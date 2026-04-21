import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runInboundPipeline } from '@/lib/agents';
import { getAgent } from '@/lib/agents';

export const maxDuration = 300;

/**
 * GET /api/agents/inbound
 * Vercel Cron trigger — runs weekly social media content planning.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const socialAgent = getAgent('social-publisher');

    if (!socialAgent) {
      return NextResponse.json({ error: 'Social agent not registered' }, { status: 500 });
    }

    // Auto-generate weekly social content for Instagram + LinkedIn
    const results = [];
    for (const platform of ['instagram', 'linkedin']) {
      const result = await socialAgent.execute({
        supabase,
        taskId: '',
        pipeline: 'inbound',
        previousResults: { action: 'plan', platform },
      });
      results.push({ platform, ...result.data });
    }

    return NextResponse.json({ success: true, results });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Inbound Cron] Error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

/**
 * POST /api/agents/inbound
 * Manual trigger for specific inbound agent actions.
 *
 * Body: {
 *   action: "respond" | "seo_audit" | "seo_content" | "social_plan" | "social_reply",
 *   ...action-specific params
 * }
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = body.action as string;
    const supabase = createServiceClient();

    // Route to appropriate agent
    if (action === 'respond') {
      // Auto-respond to an inbound inquiry → full inbound pipeline
      const result = await runInboundPipeline(supabase, {
        channel: body.channel,
        contactId: body.contactId,
        contactName: body.contactName,
        messageText: body.messageText,
      }, body.leadId);

      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'seo_audit' || action === 'seo_content') {
      const seoAgent = getAgent('seo-optimizer');
      if (!seoAgent) {
        return NextResponse.json({ error: 'SEO agent not available' }, { status: 500 });
      }

      const result = await seoAgent.execute({
        supabase,
        taskId: '',
        pipeline: 'inbound',
        previousResults: {
          action: action === 'seo_audit' ? 'audit' : 'generate_content',
          url: body.url,
          topic: body.topic,
          keywords: body.keywords,
        },
      });

      return NextResponse.json({ success: result.success, ...result.data, error: result.error });
    }

    if (action === 'social_plan' || action === 'social_reply') {
      const socialAgent = getAgent('social-publisher');
      if (!socialAgent) {
        return NextResponse.json({ error: 'Social agent not available' }, { status: 500 });
      }

      const result = await socialAgent.execute({
        supabase,
        taskId: '',
        pipeline: 'inbound',
        previousResults: {
          action: action === 'social_plan' ? 'plan' : 'reply',
          platform: body.platform || 'instagram',
          comment: body.comment,
          postContext: body.postContext,
          commenterName: body.commenterName,
        },
      });

      return NextResponse.json({ success: result.success, ...result.data, error: result.error });
    }

    return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Inbound Pipeline] Error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

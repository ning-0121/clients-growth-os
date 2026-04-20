import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Executes queued social_engagements by launching the corresponding
 * PhantomBuster phantom. Keeps launches small (1 target per call) so each
 * queued row maps cleanly to a containerId and failures don't cascade.
 *
 * Environment contract:
 *   PHANTOMBUSTER_API_KEY                         — account key
 *   PHANTOMBUSTER_IG_COMMENTER_AGENT_ID           — IG Auto Commenter phantom
 *   PHANTOMBUSTER_LINKEDIN_CONNECT_AGENT_ID       — LinkedIn Auto Connect phantom
 *   PHANTOMBUSTER_IG_DM_AGENT_ID                  — (optional) IG Message Sender
 *
 * Phantom session cookies are configured inside PhantomBuster itself; we
 * only override per-launch arguments here.
 */

const PB_API = 'https://api.phantombuster.com/api/v2';

interface LaunchResult {
  containerId: string | null;
  error?: string;
}

async function launchPhantom(
  agentId: string,
  apiKey: string,
  argument: Record<string, any>
): Promise<LaunchResult> {
  try {
    const res = await fetch(`${PB_API}/agents/launch`, {
      method: 'POST',
      headers: {
        'X-Phantombuster-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: agentId,
        // PB expects argument as a JSON string or object merged into the saved argument
        argument: JSON.stringify(argument),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { containerId: null, error: `PB ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return { containerId: data.containerId || data.data?.containerId || null };
  } catch (err: any) {
    return { containerId: null, error: err.message || 'launch failed' };
  }
}

function getAgentIdFor(platform: string, engagementType: string): string | null {
  if (platform === 'instagram' && engagementType === 'comment') {
    return process.env.PHANTOMBUSTER_IG_COMMENTER_AGENT_ID || null;
  }
  if (platform === 'instagram' && engagementType === 'dm') {
    return process.env.PHANTOMBUSTER_IG_DM_AGENT_ID || null;
  }
  if (platform === 'linkedin' && engagementType === 'connection_request') {
    return process.env.PHANTOMBUSTER_LINKEDIN_CONNECT_AGENT_ID || null;
  }
  return null;
}

function buildArgument(engagement: any): Record<string, any> {
  // Different phantoms use different argument shapes. We include the commonly
  // expected fields; PB ignores ones its phantom doesn't consume.
  return {
    // IG Auto Commenter expects spreadsheetUrl OR inline posts
    posts: [{ url: engagement.target_url, comment: engagement.content }],
    // IG Message / LinkedIn Connect expect profiles + message
    profileUrls: [engagement.target_url],
    profilesToProcess: 1,
    message: engagement.content,
    note: engagement.content,
    // Safety
    numberOfLinesPerLaunch: 1,
    commentsPerLaunch: 1,
  };
}

export interface ExecutionSummary {
  total_queued: number;
  sent: number;
  failed: number;
  skipped_no_agent: number;
  errors: string[];
}

export async function executeSocialEngagements(
  supabase: SupabaseClient,
  options: { batchSize?: number } = {}
): Promise<ExecutionSummary> {
  const { batchSize = 10 } = options;
  const apiKey = process.env.PHANTOMBUSTER_API_KEY;
  const summary: ExecutionSummary = {
    total_queued: 0, sent: 0, failed: 0, skipped_no_agent: 0, errors: [],
  };

  if (!apiKey) {
    summary.errors.push('PHANTOMBUSTER_API_KEY not configured');
    return summary;
  }

  const { data: queued, error } = await supabase
    .from('social_engagements')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (error) {
    summary.errors.push(`Query failed: ${error.message}`);
    return summary;
  }
  if (!queued || queued.length === 0) return summary;

  summary.total_queued = queued.length;

  for (const eng of queued) {
    const agentId = getAgentIdFor(eng.platform, eng.engagement_type);
    if (!agentId) {
      summary.skipped_no_agent++;
      await supabase.from('social_engagements')
        .update({ status: 'failed' })
        .eq('id', eng.id);
      summary.errors.push(`No agent configured for ${eng.platform}/${eng.engagement_type}`);
      continue;
    }

    const result = await launchPhantom(agentId, apiKey, buildArgument(eng));

    if (result.containerId) {
      await supabase.from('social_engagements')
        .update({ status: 'sent', phantombuster_run_id: result.containerId })
        .eq('id', eng.id);
      summary.sent++;
    } else {
      await supabase.from('social_engagements')
        .update({ status: 'failed' })
        .eq('id', eng.id);
      summary.failed++;
      if (result.error) summary.errors.push(`${eng.id}: ${result.error}`);
    }

    // Space out launches to respect PB rate limits
    await new Promise(r => setTimeout(r, 800));
  }

  return summary;
}

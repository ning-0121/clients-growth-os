import { NextResponse } from 'next/server';

/**
 * POST /api/cron/auto-source
 * Cron endpoint (every 6 hours): launches PhantomBuster agents.
 * The agents will call back to /api/webhooks/phantombuster when done.
 */
export async function POST(request: Request) {
  // Validate cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const pbApiKey = process.env.PHANTOMBUSTER_API_KEY;
  if (!pbApiKey) {
    return NextResponse.json({ error: 'PHANTOMBUSTER_API_KEY not configured' }, { status: 500 });
  }

  const agentIds = (process.env.PHANTOMBUSTER_AGENT_IDS || '').split(',').filter(Boolean);

  if (agentIds.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No PhantomBuster agents configured. Set PHANTOMBUSTER_AGENT_IDS env var.',
      launched: 0,
    });
  }

  const results: { agentId: string; status: string }[] = [];

  for (const agentId of agentIds) {
    try {
      const res = await fetch(`https://api.phantombuster.com/api/v2/agents/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Phantombuster-Key': pbApiKey,
        },
        body: JSON.stringify({ id: agentId.trim() }),
      });

      if (res.ok) {
        results.push({ agentId: agentId.trim(), status: 'launched' });
      } else {
        const errText = await res.text();
        results.push({ agentId: agentId.trim(), status: `failed: ${errText}` });
      }
    } catch (err: any) {
      results.push({ agentId: agentId.trim(), status: `error: ${err.message}` });
    }
  }

  return NextResponse.json({
    success: true,
    launched: results.filter((r) => r.status === 'launched').length,
    results,
  });
}

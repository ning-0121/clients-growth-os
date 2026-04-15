import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runIntakePipeline } from '@/lib/growth/intake-pipeline';
import { RawLeadInput } from '@/lib/types';

/**
 * POST /api/phantombuster/pull
 * Pull latest results from PhantomBuster agent and import into system.
 * Can be called by user (button click) or by cron.
 *
 * Body: { agent_id?: string }
 */
export async function POST(request: Request) {
  // Support both user auth and cron secret
  let isAuthed = false;

  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    isAuthed = true;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) isAuthed = true;
  }

  if (!isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pbApiKey = process.env.PHANTOMBUSTER_API_KEY;
  if (!pbApiKey) {
    return NextResponse.json({ error: 'PHANTOMBUSTER_API_KEY not configured' }, { status: 500 });
  }

  let agentId: string | undefined;
  try {
    const body = await request.json();
    agentId = body.agent_id;
  } catch {}

  // If no agent_id provided, get from env
  if (!agentId) {
    const agentIds = (process.env.PHANTOMBUSTER_AGENT_IDS || '').split(',').filter(Boolean);
    agentId = agentIds[0];
  }

  if (!agentId) {
    return NextResponse.json({ error: 'No agent_id provided and PHANTOMBUSTER_AGENT_IDS not set' }, { status: 400 });
  }

  try {
    // Fetch latest results from PhantomBuster
    const pbRes = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch-output?id=${agentId}`, {
      headers: { 'X-Phantombuster-Key': pbApiKey },
    });

    if (!pbRes.ok) {
      const errText = await pbRes.text();
      return NextResponse.json({ error: `PB API error: ${errText}` }, { status: 500 });
    }

    const pbData = await pbRes.json();
    let results: any[] = [];

    // PB returns output as JSON string or object
    if (pbData.output) {
      try {
        results = typeof pbData.output === 'string' ? JSON.parse(pbData.output) : pbData.output;
      } catch {
        // Try parsing as CSV-like JSON lines
        try {
          results = pbData.output.split('\n').filter(Boolean).map((line: string) => JSON.parse(line));
        } catch {
          return NextResponse.json({ error: 'Cannot parse PB output', raw: pbData.output?.slice(0, 500) }, { status: 500 });
        }
      }
    }

    // Also try resultObject if output is empty
    if (results.length === 0 && pbData.resultObject) {
      results = Array.isArray(pbData.resultObject) ? pbData.resultObject : [pbData.resultObject];
    }

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ success: true, message: 'No results from PB agent', total: 0 });
    }

    // Transform PB LinkedIn results to RawLeadInput
    const leads: RawLeadInput[] = results
      .filter((r: any) => r.query || r.fullName || r.companyName || r.company)
      .map((r: any) => {
        const companyName = r.companyName || r.company || r.associatedCompany || r.currentCompany || '';
        const contactName = r.fullName || r.name || r.firstName ? `${r.firstName || ''} ${r.lastName || ''}`.trim() : '';
        const email = r.email || r.mailFromHunter || r.dropcontactEmail || '';
        const linkedinUrl = r.linkedInUrl || r.profileUrl || r.url || '';
        const website = r.companyUrl || r.websiteUrl || r.website || '';

        return {
          company_name: companyName || contactName || 'Unknown',
          contact_name: contactName || undefined,
          source: 'linkedin' as const,
          website: website || undefined,
          contact_email: email || undefined,
          contact_linkedin: linkedinUrl || undefined,
          product_match: r.headline || r.title || r.occupation || undefined,
        };
      })
      .filter((l: RawLeadInput) => l.company_name && l.company_name !== 'Unknown');

    if (leads.length === 0) {
      return NextResponse.json({ success: true, message: 'No valid leads in PB results', total: results.length, valid: 0 });
    }

    // Run through intake pipeline
    const serviceSupabase = createServiceClient();
    const systemUserId = process.env.SYSTEM_USER_ID || '';

    const pipelineResult = await runIntakePipeline(leads, 'auto_scrape', systemUserId, serviceSupabase as any);

    // Log automation run
    await serviceSupabase.from('automation_runs').insert({
      source: 'phantombuster_linkedin',
      status: 'completed',
      leads_found: results.length,
      leads_ingested: pipelineResult.qualified,
      metadata: { agent_id: agentId, valid_leads: leads.length },
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      pb_results: results.length,
      valid_leads: leads.length,
      ...pipelineResult,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

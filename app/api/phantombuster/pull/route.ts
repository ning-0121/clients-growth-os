import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runIntakePipeline } from '@/lib/growth/intake-pipeline';
import { enqueueUrls } from '@/lib/scrapers/source-queue';
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

    const serviceSupabase = createServiceClient();
    const systemUserId = process.env.SYSTEM_USER_ID || '';
    const serpApiKey = process.env.SERPAPI_KEY;

    // Split: leads WITH website go to pipeline, WITHOUT website get searched first
    const withWebsite = leads.filter(l => l.website);
    const withoutWebsite = leads.filter(l => !l.website && l.company_name);

    let pipelineQualified = 0;
    let pipelineDisqualified = 0;
    let pipelineDuplicates = 0;
    let enqueuedForSearch = 0;

    // Direct intake for leads with website
    if (withWebsite.length > 0) {
      const pipelineResult = await runIntakePipeline(withWebsite, 'auto_scrape', systemUserId, serviceSupabase as any);
      pipelineQualified = pipelineResult.qualified;
      pipelineDisqualified = pipelineResult.disqualified;
      pipelineDuplicates = pipelineResult.duplicates;
    }

    // For leads without website: Google search to find their website, then enqueue for enrichment
    if (withoutWebsite.length > 0 && serpApiKey) {
      const urlsToEnqueue: { url: string; source: string; priority: number; data: any }[] = [];

      for (const lead of withoutWebsite.slice(0, 10)) { // Max 10 searches
        try {
          const query = `"${lead.company_name}" official website`;
          const searchUrl = `https://serpapi.com/search.json?api_key=${serpApiKey}&q=${encodeURIComponent(query)}&num=3&engine=google`;
          const res = await fetch(searchUrl);
          const data = await res.json();

          const firstResult = data.organic_results?.[0];
          if (firstResult?.link) {
            let url = firstResult.link;
            // Clean URL
            try {
              const u = new URL(url);
              ['srsltid', 'utm_source', 'gclid'].forEach(p => u.searchParams.delete(p));
              if (['/pages/', '/collections/'].some(p => u.pathname.startsWith(p))) {
                url = `${u.protocol}//${u.host}`;
              }
              url = u.toString().replace(/\/$/, '');
            } catch {}

            urlsToEnqueue.push({
              url,
              source: 'google',
              priority: 20, // High priority — from LinkedIn
              data: {
                from_phantombuster: true,
                contact_name: lead.contact_name,
                contact_linkedin: lead.contact_linkedin,
                original_company: lead.company_name,
              },
            });
          }

          await new Promise(r => setTimeout(r, 300));
        } catch {}
      }

      if (urlsToEnqueue.length > 0) {
        const { queued } = await enqueueUrls(urlsToEnqueue, serviceSupabase);
        enqueuedForSearch = queued;
      }
    }

    // Also directly insert leads without website but with LinkedIn/email (still valuable)
    const linkedinOnlyLeads = withoutWebsite.filter(l => l.contact_linkedin || l.contact_email);
    if (linkedinOnlyLeads.length > 0) {
      // These will likely get disqualified (no website) but we still record them
      await runIntakePipeline(linkedinOnlyLeads, 'auto_scrape', systemUserId, serviceSupabase as any);
    }

    // Log automation run
    await serviceSupabase.from('automation_runs').insert({
      source: 'phantombuster_linkedin',
      status: 'completed',
      leads_found: results.length,
      leads_ingested: pipelineQualified,
      metadata: {
        agent_id: agentId,
        valid_leads: leads.length,
        with_website: withWebsite.length,
        searched_for_website: withoutWebsite.length,
        enqueued_for_enrichment: enqueuedForSearch,
      },
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      pb_results: results.length,
      valid_leads: leads.length,
      with_website: withWebsite.length,
      qualified: pipelineQualified,
      disqualified: pipelineDisqualified,
      duplicates: pipelineDuplicates,
      enqueued_for_enrichment: enqueuedForSearch,
      message: enqueuedForSearch > 0
        ? `${enqueuedForSearch} 个无网站的线索已通过Google搜索找到网站，进入富化队列`
        : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

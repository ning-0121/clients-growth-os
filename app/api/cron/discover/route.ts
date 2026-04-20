import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { discoverLeads } from '@/lib/scrapers/google-discovery';
import { discoverFromBing } from '@/lib/scrapers/duckduckgo-discovery';
import { discoverFromSocialAndEcom } from '@/lib/scrapers/social-ecom-discovery';
import { learnFromWonDeals, expandSearchScope } from '@/lib/scrapers/search-intelligence';
import { planDailyMission, getRecentlyUsedQueries, deduplicateQueries, getLeadsForReEnrichment } from '@/lib/scrapers/daily-mission-planner';
import { getLearnedSearchQueries } from '@/lib/scrapers/auto-upgrade';
import { huntContacts } from '@/lib/scrapers/contact-hunter';
import { enqueueUrls } from '@/lib/scrapers/source-queue';
import { extractDomain } from '@/lib/growth/lead-engine';
import { startJobLog, finishJobLog } from '@/lib/supervisor/job-logger';

/**
 * POST /api/cron/discover
 * Cron (every 2 hours): discovers new leads from 4 channels + self-learning:
 * 1. Google Search — brand websites
 * 2. Bing Search — broader coverage
 * 3. Social + E-commerce — IG brands + Shopify stores
 * 4. Self-Learning — queries generated from won deals + expanded scope
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const logId = await startJobLog(supabase, 'discover', 'global_discovery', 0);

  try {
    const results: Record<string, any> = {};

    const serpApiKey = process.env.SERPAPI_KEY;
    if (!serpApiKey) {
      await finishJobLog(supabase, logId, { status: 'error', errorMessage: 'SERPAPI_KEY not configured' });
      return NextResponse.json({ success: true, message: 'SERPAPI_KEY not configured', total_new: 0 });
    }

    // Phase 1: Run 3 preset channels in parallel — SCALED UP for global reach
    // Previous: 4+3+4=11 queries/run. New: 15+10+12=37 queries/run (3.4x volume)
    const [googleResult, bingResult, socialResult] = await Promise.allSettled([
      discoverLeads(supabase, 15),
      discoverFromBing(supabase, 10),
      discoverFromSocialAndEcom(supabase, 12),
    ]);

    results.google = googleResult.status === 'fulfilled' ? googleResult.value : { error: (googleResult as any).reason?.message };
    results.bing = bingResult.status === 'fulfilled' ? bingResult.value : { error: (bingResult as any).reason?.message };
    results.social_ecom = socialResult.status === 'fulfilled' ? socialResult.value : { error: (socialResult as any).reason?.message };

    // Phase 2: Self-learning — generate new queries from historical data
    let learnedNew = 0;
    try {
      // Learn from won deals: "what do our best customers look like?"
      const wonQueries = await learnFromWonDeals(supabase);

      // Expand scope: "if X works in USA, try Canada/UK/Germany"
      const expandedQueries = await expandSearchScope(supabase);

      const allLearnedQueries = [...wonQueries, ...expandedQueries].slice(0, 5);

      if (allLearnedQueries.length > 0) {
        // Load existing domains for dedup
        const { data: existingLeads } = await supabase
          .from('growth_leads').select('website').not('website', 'is', null);
        const { data: existingQueue } = await supabase
          .from('lead_source_queue').select('target_url').not('target_url', 'is', null);
        const existing = new Set([
          ...(existingLeads || []).map((l: any) => extractDomain(l.website)),
          ...(existingQueue || []).map((q: any) => extractDomain(q.target_url)),
        ]);

        const SKIP = ['youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
          'amazon.com', 'ebay.com', 'wikipedia.org', 'google.com', 'linkedin.com',
          'trustpilot.com', 'nike.com', 'adidas.com', 'lululemon.com', 'gymshark.com',
          'shopify.com', 'wix.com', 'squarespace.com'];

        for (const query of allLearnedQueries) {
          try {
            const url = `https://serpapi.com/search.json?api_key=${serpApiKey}&q=${encodeURIComponent(query)}&num=5&engine=google`;
            const res = await fetch(url);
            const data = await res.json();

            const urls = (data.organic_results || [])
              .map((r: any) => r.link as string)
              .filter((link: string) => {
                if (!link) return false;
                const d = extractDomain(link);
                return !SKIP.some(s => d.includes(s)) && !existing.has(d);
              });

            if (urls.length > 0) {
              const { queued } = await enqueueUrls(
                urls.map((u: string) => ({ url: u, source: 'google', priority: 20, data: { from_learning: true, query } })),
                supabase
              );
              learnedNew += queued;
              urls.forEach((u: string) => existing.add(extractDomain(u)));
            }

            await new Promise(r => setTimeout(r, 500));
          } catch {}
        }

        // Log learned discovery
        if (learnedNew > 0) {
          await supabase.from('discovery_runs').insert({
            source: 'self_learning',
            query_used: allLearnedQueries.join(' | '),
            urls_found: learnedNew,
            urls_new: learnedNew,
            metadata: { won_deal_queries: wonQueries.length, expanded_queries: expandedQueries.length },
          });
        }
      }

      results.self_learning = {
        queries_generated: allLearnedQueries.length,
        urls_new: learnedNew,
        from_won_deals: wonQueries.length,
        from_expansion: expandedQueries.length,
      };
    } catch (err: any) {
      results.self_learning = { error: err.message };
    }

    // Phase 3: Daily mission — today's unique focus direction
    const mission = planDailyMission();
    results.daily_mission = {
      theme: mission.theme,
      day_of_cycle: mission.day_of_cycle,
      product_focus: mission.product_focus,
      market_focus: mission.market_focus,
    };

    // Phase 4: Re-enrich old leads that are missing contact info
    let reEnriched = 0;
    try {
      const leadsToReEnrich = await getLeadsForReEnrichment(supabase, mission.re_enrich_count);
      for (const lead of leadsToReEnrich) {
        try {
          const contacts = await huntContacts(lead.website, lead.company_name, lead.contact_name);
          const bestEmail = contacts.emails.find(e => e.confidence >= 50);
          if (bestEmail) {
            await supabase.from('growth_leads')
              .update({
                contact_email: bestEmail.email,
                probability_updated_at: new Date().toISOString(),
              })
              .eq('id', lead.id)
              .is('contact_email', null); // Only update if still null
            reEnriched++;
          }
          // Also update LinkedIn if found
          if (!lead.contact_linkedin) {
            const li = contacts.social.find(s => s.platform === 'linkedin');
            if (li) {
              await supabase.from('growth_leads')
                .update({ contact_linkedin: li.url })
                .eq('id', lead.id);
            }
          }
        } catch {}
      }
      results.re_enrichment = { attempted: leadsToReEnrich.length, found_email: reEnriched };
    } catch (err: any) {
      results.re_enrichment = { error: err.message };
    }

    const totalNew = (results.google?.urls_new || 0) + (results.bing?.urls_new || 0) +
      (results.social_ecom?.urls_new || 0) + learnedNew;
    const totalFound = (results.google?.urls_found || 0) + (results.bing?.urls_found || 0) +
      (results.social_ecom?.urls_found || 0) + learnedNew;

    await finishJobLog(supabase, logId, {
      status: 'success',
      outputCount: totalNew,
      successCount: totalNew,
      metadata: { total_found: totalFound, re_enriched: reEnriched, sources: Object.keys(results) },
      apiCalls: 37, // roughly, based on new scale (15+10+12)
    });

    return NextResponse.json({
      success: true,
      total_found: totalFound,
      total_new: totalNew,
      re_enriched: reEnriched,
      sources: results,
    });
  } catch (err: any) {
    console.error('[Discover Cron] Error:', err);
    await finishJobLog(supabase, logId, { status: 'error', errorMessage: err.message, errorCount: 1 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

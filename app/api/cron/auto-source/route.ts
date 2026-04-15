import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { dequeueItems, markCompleted, markFailed } from '@/lib/scrapers/source-queue';
import { enrichBatch } from '@/lib/growth/website-enricher';
import { huntContacts } from '@/lib/scrapers/contact-hunter';
import { runIntakePipeline } from '@/lib/growth/intake-pipeline';
import { RawLeadInput, LeadSource } from '@/lib/types';

const VALID_LEAD_SOURCES: LeadSource[] = ['google', 'apollo', 'directory', 'website', 'ig', 'linkedin'];

/**
 * Clean URL: strip tracking params, normalize to homepage.
 */
function cleanTargetUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    // Remove tracking params
    ['srsltid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
     'gclid', 'fbclid', 'ref', 'mc_cid', 'mc_eid', 'msockid'].forEach(p => u.searchParams.delete(p));
    // Normalize subpages to homepage
    const subPages = ['/pages/', '/blogs/', '/collections/', '/products/', '/about', '/contact'];
    if (subPages.some(p => u.pathname.startsWith(p))) {
      return `${u.protocol}//${u.host}`;
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

/**
 * POST /api/cron/auto-source
 * Cron (every hour): dequeues URLs from lead_source_queue,
 * enriches them (website scrape + AI), and feeds through intake pipeline.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const systemUserId = process.env.SYSTEM_USER_ID || '';

    // Dequeue items from the source queue (20 per hour)
    // 5 items per run to stay within Vercel 60s timeout
    // With Pro plan cron every 10min = 30 items/hour = 720/day
    const items = await dequeueItems(5, supabase);

    if (items.length === 0) {
      return NextResponse.json({ success: true, message: 'Queue empty', processed: 0 });
    }

    let enriched = 0;
    let ingested = 0;
    let failed = 0;

    // Process each queue item
    for (const item of items) {
      if (!item.target_url) {
        await markFailed(item.id, 'No target URL', item.retry_count, item.max_retries, supabase);
        failed++;
        continue;
      }

      try {
        // Clean URL before enriching
        const cleanedUrl = cleanTargetUrl(item.target_url);

        // Enrich the URL using existing website enricher
        const { results, failures } = await enrichBatch(
          [{ website: cleanedUrl }]
        );

        if (results.length === 0) {
          const reason = failures[0]?.reason || 'Enrichment failed';
          await markFailed(item.id, reason, item.retry_count, item.max_retries, supabase);
          failed++;
          continue;
        }

        const result = results[0];

        // Skip if AI says not apparel (high confidence)
        if (result.ai_analysis && !result.ai_analysis.is_apparel_company && result.ai_analysis.confidence >= 70) {
          await markCompleted(item.id, {
            skipped: true,
            reason: `AI: not apparel (confidence ${result.ai_analysis.confidence}%)`,
            company_name: result.company_name,
          }, supabase);
          continue;
        }

        // Use enricher results directly (deep hunting moved to re-enrichment cron for speed)
        let contactEmail = result.contact_email;
        let contactLinkedin = result.contact_linkedin;
        let igHandle = result.instagram_handle;

        // Convert to RawLeadInput
        const source: LeadSource = (VALID_LEAD_SOURCES.includes(item.source as LeadSource))
          ? item.source as LeadSource
          : 'website';

        const lead: RawLeadInput = {
          company_name: result.company_name,
          source,
          website: cleanTargetUrl(result.website),
          contact_email: contactEmail || undefined,
          instagram_handle: igHandle || undefined,
          contact_linkedin: contactLinkedin || undefined,
          product_match: result.product_match || undefined,
          ai_analysis: result.ai_analysis || undefined,
        };

        // Feed through intake pipeline
        const pipelineResult = await runIntakePipeline(
          [lead],
          'auto_scrape',
          systemUserId,
          supabase as any
        );

        await markCompleted(item.id, {
          company_name: result.company_name,
          qualified: pipelineResult.qualified,
          disqualified: pipelineResult.disqualified,
          duplicates: pipelineResult.duplicates,
        }, supabase);

        enriched++;
        if (pipelineResult.qualified > 0) ingested++;
      } catch (err: any) {
        await markFailed(item.id, err.message || 'Unknown error', item.retry_count, item.max_retries, supabase);
        failed++;
      }
    }

    // Log automation run
    await supabase.from('automation_runs').insert({
      source: 'website_scrape',
      status: 'completed',
      leads_found: items.length,
      leads_ingested: ingested,
      metadata: { enriched, failed, queue_batch: true },
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      processed: items.length,
      enriched,
      ingested,
      failed,
    });
  } catch (err: any) {
    console.error('[Auto-Source Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

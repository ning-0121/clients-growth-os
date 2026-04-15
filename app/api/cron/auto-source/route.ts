import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { dequeueItems, markCompleted, markFailed } from '@/lib/scrapers/source-queue';
import { runIntakePipeline } from '@/lib/growth/intake-pipeline';
import { RawLeadInput, LeadSource } from '@/lib/types';
import * as cheerio from 'cheerio';

const VALID_LEAD_SOURCES: LeadSource[] = ['google', 'apollo', 'directory', 'website', 'ig', 'linkedin'];

// ── 大品牌黑名单 — 这些公司太大，不是我们的目标客户 ──
const BIG_BRAND_DOMAINS = [
  'nike.com', 'adidas.com', 'puma.com', 'reebok.com', 'newbalance.com',
  'underarmour.com', 'lululemon.com', 'gymshark.com', 'fabletics.com',
  'vuoriclothing.com', 'vuori.com', 'alo.com', 'aloyoga.com',
  'gap.com', 'oldnavy.com', 'athleta.com', 'bananarepublic.com',
  'hm.com', 'zara.com', 'uniqlo.com', 'forever21.com',
  'nordstrom.com', 'macys.com', 'target.com', 'walmart.com',
  'amazon.com', 'dickssportinggoods.com', 'rei.com',
  'patagonia.com', 'thenorthface.com', 'columbia.com',
  'champion.com', 'fila.com', 'asics.com', 'mizuno.com',
  'onrunning.com', 'hoka.com', 'brooksrunning.com',
  'skims.com', 'aritzia.com', 'revolve.com',
];

const BIG_BRAND_NAMES = [
  'nike', 'adidas', 'puma', 'reebok', 'new balance', 'under armour',
  'lululemon', 'gymshark', 'fabletics', 'vuori', 'alo yoga',
  'gap', 'h&m', 'zara', 'uniqlo', 'forever 21',
  'patagonia', 'north face', 'columbia', 'champion',
  'walmart', 'target', 'amazon', 'nordstrom',
];

function isBigBrand(url: string, companyName: string): boolean {
  const domain = url.toLowerCase();
  if (BIG_BRAND_DOMAINS.some(d => domain.includes(d))) return true;
  const name = companyName.toLowerCase();
  if (BIG_BRAND_NAMES.some(b => name.includes(b))) return true;
  return false;
}

function cleanTargetUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    ['srsltid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
     'gclid', 'fbclid', 'ref', 'mc_cid', 'mc_eid', 'msockid'].forEach(p => u.searchParams.delete(p));
    const subPages = ['/pages/', '/blogs/', '/collections/', '/products/', '/about', '/contact'];
    if (subPages.some(p => u.pathname.startsWith(p))) {
      return `${u.protocol}//${u.host}`;
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const DISCARD_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'bounce', 'automated', 'postmaster'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

/**
 * FAST enrichment — just scrape, no AI analysis (2-3 seconds per URL vs 15 seconds)
 * AI analysis happens later in verification pipeline
 */
async function fastEnrich(url: string): Promise<{
  company_name: string;
  website: string;
  contact_email: string | null;
  instagram_handle: string | null;
  contact_linkedin: string | null;
  product_match: string | null;
} | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Company name
    const ogName = $('meta[property="og:site_name"]').attr('content');
    const titleText = $('title').text().trim();
    const company_name = ogName?.trim() || titleText.replace(/[-–|·•:].*/,'').trim() || new URL(url).hostname.replace('www.','').split('.')[0];

    // Emails
    const emails = new Set<string>();
    $('a[href^="mailto:"]').each((_,el) => {
      const e = ($(el).attr('href')||'').replace('mailto:','').split('?')[0].trim().toLowerCase();
      if (e && EMAIL_RE.test(e)) emails.add(e);
    });
    const bodyText = $('body').text().slice(0, 8000);
    (bodyText.match(EMAIL_RE) || []).forEach(e => emails.add(e.toLowerCase()));

    // Filter emails
    const validEmails = [...emails].filter(e => {
      const local = e.split('@')[0];
      return !DISCARD_PREFIXES.some(p => local === p || local.startsWith(p + '+'));
    });

    // Instagram
    let ig: string | null = null;
    $('a[href*="instagram.com"]').each((_,el) => {
      if (ig) return;
      const m = ($(el).attr('href')||'').match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
      if (m && !['p','reel','stories','explore','accounts'].includes(m[1].toLowerCase())) ig = m[1].toLowerCase();
    });

    // LinkedIn
    let li: string | null = null;
    $('a[href*="linkedin.com"]').each((_,el) => {
      if (li) return;
      const href = ($(el).attr('href')||'').split('?')[0];
      if (href.match(/linkedin\.com\/(company|in)\//)) li = href;
    });

    // Product match from meta/title
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const keywords = $('meta[name="keywords"]').attr('content') || '';
    const allText = [titleText, metaDesc, keywords].join(' ').toLowerCase();
    const categories = ['activewear','sportswear','yoga','athletic','fitness','gym','compression','athleisure','tennis','golf','running','cycling','outdoor','swimwear'];
    const matched = categories.filter(c => allText.includes(c));
    const product_match = matched.length > 0 ? matched.join(', ') : (metaDesc.slice(0, 150) || null);

    return {
      company_name,
      website: url,
      contact_email: validEmails[0] || null,
      instagram_handle: ig,
      contact_linkedin: li,
      product_match,
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/cron/auto-source
 * FAST mode: 10 items per run × every 10 min = 60/hour = 1,440/day
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const systemUserId = process.env.SYSTEM_USER_ID || '';

    // 10 items per run — fast enrichment ~3s each = ~30s total (safe for 60s timeout)
    const items = await dequeueItems(10, supabase);

    if (items.length === 0) {
      return NextResponse.json({ success: true, message: 'Queue empty', processed: 0 });
    }

    let enriched = 0;
    let ingested = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of items) {
      if (!item.target_url) {
        await markFailed(item.id, 'No target URL', item.retry_count, item.max_retries, supabase);
        failed++;
        continue;
      }

      try {
        const cleanedUrl = cleanTargetUrl(item.target_url);

        // Fast enrich (no AI, just scrape — 2-3 seconds)
        const result = await fastEnrich(cleanedUrl);

        if (!result) {
          await markFailed(item.id, 'Fetch failed', item.retry_count, item.max_retries, supabase);
          failed++;
          continue;
        }

        // Skip big brands
        if (isBigBrand(cleanedUrl, result.company_name)) {
          await markCompleted(item.id, { skipped: true, reason: '大品牌跳过: ' + result.company_name }, supabase);
          skipped++;
          continue;
        }

        const source: LeadSource = (VALID_LEAD_SOURCES.includes(item.source as LeadSource))
          ? item.source as LeadSource : 'website';

        const lead: RawLeadInput = {
          company_name: result.company_name,
          source,
          website: cleanedUrl,
          contact_email: result.contact_email || undefined,
          instagram_handle: result.instagram_handle || undefined,
          contact_linkedin: result.contact_linkedin || undefined,
          product_match: result.product_match || undefined,
        };

        const pipelineResult = await runIntakePipeline([lead], 'auto_scrape', systemUserId, supabase as any);

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

    await supabase.from('automation_runs').insert({
      source: 'website_scrape',
      status: 'completed',
      leads_found: items.length,
      leads_ingested: ingested,
      metadata: { enriched, failed, skipped, fast_mode: true },
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, processed: items.length, enriched, ingested, failed, skipped });
  } catch (err: any) {
    console.error('[Auto-Source Cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

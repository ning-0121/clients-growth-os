import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { discoverShopifyStores, resolveWebsiteFromBrandName } from '@/lib/scrapers/channels/shopify-finder';
import { startJobLog, finishJobLog } from '@/lib/supervisor/job-logger';

/**
 * POST /api/discovery/shopify
 * Dual mode:
 * - Discovery (no body or { mode: "discovery" }): find new Shopify stores by keyword
 * - Resolver ({ mode: "resolve", brand_name: "XYZ LLC" }): find the Shopify store
 *   for a known business name — used for Amazon seller pipeline
 */
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }

async function handle(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isCron) {
    await requireAuth();
    const profile = await getCurrentProfile();
    if (profile?.role !== '管理员') {
      return NextResponse.json({ error: '仅管理员' }, { status: 403 });
    }
  }

  let body: any = {};
  try { body = await request.json(); } catch {}

  const mode = body.mode === 'resolve' ? 'resolve' : 'discovery';
  const supabase = createServiceClient();
  const logId = await startJobLog(supabase, 'discover', `shopify:${mode}`);

  try {
    if (mode === 'resolve') {
      const brandName = String(body.brand_name || '').trim();
      if (!brandName) {
        await finishJobLog(supabase, logId, { status: 'error', errorMessage: 'brand_name required' });
        return NextResponse.json({ error: 'brand_name required' }, { status: 400 });
      }

      const result = await resolveWebsiteFromBrandName(brandName);

      await finishJobLog(supabase, logId, {
        status: result ? 'success' : 'partial',
        outputCount: result ? 1 : 0,
        successCount: result?.is_shopify ? 1 : 0,
        metadata: { brand_name: brandName, resolved: !!result, confidence: result?.confidence },
        apiCalls: 1,
      });

      return NextResponse.json({ success: !!result, brand_name: brandName, result });
    }

    // Discovery mode
    const opts: any = {};
    if (body.keywords && Array.isArray(body.keywords)) opts.keywords = body.keywords;
    if (body.maxPerKeyword) opts.maxPerKeyword = body.maxPerKeyword;

    const result = await discoverShopifyStores(supabase, opts);

    await finishJobLog(supabase, logId, {
      status: result.error ? 'error' : 'success',
      outputCount: result.urls_queued,
      successCount: result.shopify_confirmed,
      errorCount: result.error ? 1 : 0,
      errorMessage: result.error,
      metadata: {
        total_found: result.total_found,
        shopify_confirmed: result.shopify_confirmed,
        duplicates: result.duplicates,
      },
    });

    return NextResponse.json({ success: !result.error, ...result });
  } catch (err: any) {
    await finishJobLog(supabase, logId, { status: 'error', errorMessage: err.message, errorCount: 1 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runFullProductScan } from '@/lib/product-intel/trend-scanner';

/**
 * POST /api/cron/product-intel
 * Daily cron: scans product trends across all categories
 * Finds supply-demand gaps and recommends new products
 */
export async function GET(request: Request) { return handleCron(request); }
export async function POST(request: Request) { return handleCron(request); }

async function handleCron(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get('x-vercel-cron');

  if (!vercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const result = await runFullProductScan(supabase);

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Product Intel] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

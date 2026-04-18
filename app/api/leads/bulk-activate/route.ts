import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';

/**
 * POST /api/leads/bulk-activate
 *
 * Bulk-reactivate untouched or stale leads so they re-enter the pipeline:
 * - Resets verification_status back to "pending" → verify cron will pick them up
 * - Resets outreach_status from 'none' to null so they can be processed
 * - Only activates leads with contact info (email/phone/linkedin)
 *
 * Body (optional): {
 *   dry_run?: boolean          // default true — just counts, doesn't modify
 *   max_leads?: number          // default 50 per call (keep Vercel timeout safe)
 *   target?: 'untouched' | 'stale_over_7d'  // which subset to activate
 * }
 */
export async function POST(request: Request) {
  await requireAuth();
  const profile = await getCurrentProfile();
  if (profile?.role !== '管理员') {
    return NextResponse.json({ error: '仅管理员' }, { status: 403 });
  }

  let dryRun = true;
  let maxLeads = 50;
  let target: 'untouched' | 'stale_over_7d' = 'untouched';

  try {
    const body = await request.json();
    if (body.dry_run === false) dryRun = false;
    if (typeof body.max_leads === 'number') maxLeads = Math.min(Math.max(body.max_leads, 1), 200);
    if (body.target === 'stale_over_7d') target = 'stale_over_7d';
  } catch {}

  const supabase = createServiceClient();
  const now = new Date();

  // Build candidate query: leads that have contact info but haven't been worked
  let query = supabase
    .from('growth_leads')
    .select('id, company_name, contact_email, contact_phone, contact_linkedin, verification_status, outreach_status, updated_at, created_at')
    .neq('status', 'disqualified')
    .or('contact_email.not.is.null,contact_phone.not.is.null,contact_linkedin.not.is.null');

  if (target === 'untouched') {
    // Never been through outreach AND verification not complete
    query = query.or('outreach_status.is.null,outreach_status.eq.none');
    query = query.in('verification_status', ['pending', 'failed']);
  } else {
    // Stale — updated > 7 days ago
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query.lt('updated_at', sevenDaysAgo);
  }

  const { data: candidates, error } = await query.limit(maxLeads);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const candidateCount = candidates?.length || 0;

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dry_run: true,
      would_activate: candidateCount,
      sample: (candidates || []).slice(0, 10).map((l: any) => ({
        id: l.id,
        company: l.company_name,
        has_email: !!l.contact_email,
        has_phone: !!l.contact_phone,
        has_linkedin: !!l.contact_linkedin,
        verification: l.verification_status,
        outreach: l.outreach_status,
      })),
    });
  }

  // Actual activation: reset verification_status to pending, clear outreach_status
  if (candidateCount === 0) {
    return NextResponse.json({ success: true, activated: 0, message: '没有可激活的线索' });
  }

  const ids = (candidates || []).map((l: any) => l.id);
  const { error: updateErr } = await supabase
    .from('growth_leads')
    .update({
      verification_status: 'pending',
      outreach_status: null,
      updated_at: now.toISOString(),
    })
    .in('id', ids);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    activated: ids.length,
    message: `已激活 ${ids.length} 条线索，15分钟内 verify cron 会开始处理`,
  });
}

export async function GET() {
  return NextResponse.json({
    usage: 'POST with optional body: { dry_run: true|false, max_leads: 50, target: "untouched"|"stale_over_7d" }',
  });
}

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { requireEnum } from '@/lib/validation';

/**
 * POST /api/leads/bulk-triage
 *
 * Admin-only bulk action for C/D grade leads that have been sitting.
 * Actions:
 *   - archive: mark as disqualified with reason "低质量归档"
 *   - nurture: flag for quarterly re-check (outreach_status='nurture_pool')
 *   - reclassify: trigger re-analysis via re-enrich (max 20 per call)
 *
 * Body: { action: 'archive' | 'nurture' | 'reclassify', grade: 'C' | 'D', max?: 100 }
 */
export async function POST(request: Request) {
  await requireAuth();
  const profile = await getCurrentProfile();
  if (profile?.role !== '管理员') {
    return NextResponse.json({ error: '仅管理员' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const action = requireEnum(body.action, 'action', ['archive', 'nurture', 'reclassify'] as const);
    const grade = requireEnum(body.grade, 'grade', ['C', 'D'] as const);
    const max = Math.min(Math.max(Number(body.max || 50), 1), 200);

    const supabase = createServiceClient();
    const now = new Date().toISOString();

    // Find candidates: grade=C/D, status=new or qualified, never had a reply
    const { data: candidates } = await supabase
      .from('growth_leads')
      .select('id, company_name, contact_email, grade, outreach_status')
      .eq('grade', grade)
      .neq('status', 'disqualified')
      .neq('outreach_status', 'replied')
      .limit(max);

    if (!candidates?.length) {
      return NextResponse.json({ success: true, processed: 0, message: '没有符合条件的线索' });
    }

    const ids = candidates.map((c: any) => c.id);

    if (action === 'archive') {
      const { error } = await supabase
        .from('growth_leads')
        .update({
          status: 'disqualified',
          disqualified_reason: `${grade}级批量归档：长期低价值，转入冷藏`,
          outreach_status: null,
          assigned_to: null,
          updated_at: now,
        })
        .in('id', ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, processed: ids.length, message: `已归档 ${ids.length} 条 ${grade}级 线索` });
    }

    if (action === 'nurture') {
      const { error } = await supabase
        .from('growth_leads')
        .update({
          outreach_status: 'nurture_pool',
          updated_at: now,
        })
        .in('id', ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, processed: ids.length, message: `${ids.length} 条 ${grade}级 转入培育池（每季度检查一次）` });
    }

    if (action === 'reclassify') {
      // Mark as needing re-verification — cron will pick up
      const { error } = await supabase
        .from('growth_leads')
        .update({
          verification_status: 'pending',
          updated_at: now,
        })
        .in('id', ids.slice(0, 20)); // Limit reclassify to avoid AI cost explosion
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({
        success: true,
        processed: Math.min(20, ids.length),
        message: `${Math.min(20, ids.length)} 条 ${grade}级 已标记重新验证，cron 15分钟内处理`,
      });
    }

    return NextResponse.json({ error: 'unreachable' }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    usage: 'POST { action: "archive"|"nurture"|"reclassify", grade: "C"|"D", max: 50 }',
  });
}

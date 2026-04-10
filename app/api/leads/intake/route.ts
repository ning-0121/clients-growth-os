import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runIntakePipeline } from '@/lib/growth/intake-pipeline';
import { RawLeadInput } from '@/lib/types';

/**
 * POST /api/leads/intake
 * Accepts a single lead or an array of leads.
 * Routes through the shared intake pipeline: dedup → score → assign → insert.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: RawLeadInput | RawLeadInput[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '无效的 JSON' }, { status: 400 });
  }

  const leads = Array.isArray(body) ? body : [body];

  if (leads.length === 0) {
    return NextResponse.json({ error: '至少需要一条线索' }, { status: 400 });
  }
  if (leads.length > 200) {
    return NextResponse.json({ error: '单次最多 200 条线索' }, { status: 400 });
  }

  for (const lead of leads) {
    if (!lead.company_name?.trim()) {
      return NextResponse.json(
        { error: `缺少 company_name: ${JSON.stringify(lead)}` },
        { status: 400 }
      );
    }
  }

  const result = await runIntakePipeline(leads, 'api', user.id, supabase);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    total: result.total,
    qualified: result.qualified,
    disqualified: result.disqualified,
    duplicates: result.duplicates,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { processLead } from '@/lib/growth/lead-engine';
import { assignLeadByTier } from '@/lib/growth/lead-assignment';
import { buildDedupIndex, isDuplicate, registerInIndex } from '@/lib/growth/lead-dedup';
import { RawLeadInput, SalesTier } from '@/lib/types';

/**
 * POST /api/leads/intake
 * Accepts a single lead or an array of leads.
 * Deduplicates, filters, scores, grades, and assigns each lead.
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

  // Load existing leads for dedup (only active ones)
  const { data: existingLeads } = await supabase
    .from('growth_leads')
    .select('id, company_name, website, instagram_handle')
    .in('status', ['new', 'qualified', 'converted']);

  const dedupIndex = buildDedupIndex(existingLeads || []);

  // Load eligible sales staff (role=销售, sales_tier not null)
  const { data: salesStaff } = await supabase
    .from('profiles')
    .select('user_id, name, sales_tier')
    .eq('role', '销售')
    .not('sales_tier', 'is', null);

  // Current load per staff
  const { data: loadCounts } = await supabase
    .from('growth_leads')
    .select('assigned_to')
    .in('status', ['new', 'qualified']);

  const loadMap = new Map<string, number>();
  (salesStaff || []).forEach((s: any) => loadMap.set(s.user_id, 0));
  (loadCounts || []).forEach((l: any) => {
    if (l.assigned_to && loadMap.has(l.assigned_to)) {
      loadMap.set(l.assigned_to, (loadMap.get(l.assigned_to) || 0) + 1);
    }
  });

  const staffList = (salesStaff || []).map((s: any) => ({
    user_id: s.user_id as string,
    sales_tier: s.sales_tier as SalesTier,
    load: loadMap.get(s.user_id) || 0,
  }));

  const now = new Date();
  const nowIso = now.toISOString();
  const firstActionDue = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();

  const results = { qualified: 0, disqualified: 0, duplicates: 0 };
  const rowsToInsert: any[] = [];

  for (const lead of leads) {
    // Dedup check
    const dupReason = isDuplicate(lead, dedupIndex);
    if (dupReason) {
      results.duplicates++;
      continue;
    }

    const processed = processLead(lead);

    let assignedTo: string | null = null;
    let assignedAt: string | null = null;
    let nextActionDue: string | null = null;

    if (processed.status === 'new') {
      assignedTo = assignLeadByTier(staffList, processed.tier);
      if (assignedTo) {
        assignedAt = nowIso;
        nextActionDue = firstActionDue; // 4 hours for first touch
        // Update in-memory load
        const staff = staffList.find((s) => s.user_id === assignedTo);
        if (staff) staff.load++;
      }
      results.qualified++;
    } else {
      results.disqualified++;
    }

    rowsToInsert.push({
      company_name: lead.company_name.trim(),
      contact_name: lead.contact_name?.trim() || null,
      source: lead.source || null,
      website: lead.website?.trim() || null,
      product_match: lead.product_match?.trim() || null,
      contact_email: lead.contact_email?.trim() || null,
      contact_linkedin: lead.contact_linkedin?.trim() || null,
      instagram_handle: lead.instagram_handle?.trim() || null,
      quality_score: processed.quality_score,
      opportunity_score: processed.opportunity_score,
      reachability_score: processed.reachability_score,
      final_score: processed.final_score,
      grade: processed.grade,
      status: processed.status,
      disqualified_reason: processed.disqualified_reason,
      assigned_to: assignedTo,
      assigned_at: assignedAt,
      next_action_due: nextActionDue,
      created_by: user.id,
    });

    // Register in dedup index for intra-batch dedup
    registerInIndex(lead, dedupIndex);
  }

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('growth_leads')
      .insert(rowsToInsert);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    total: leads.length,
    qualified: results.qualified,
    disqualified: results.disqualified,
    duplicates: results.duplicates,
  });
}

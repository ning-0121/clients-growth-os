import { createClient } from '@/lib/supabase/server';
import { processLead, processLeadWithAI } from '@/lib/growth/lead-engine';
import { assignLeadByTier } from '@/lib/growth/lead-assignment';
import { buildDedupIndex, isDuplicate, registerInIndex } from '@/lib/growth/lead-dedup';
import { RawLeadInput, SalesTier, IntakeTriggerType } from '@/lib/types';
import { revalidatePath } from 'next/cache';

export interface IntakeResult {
  success?: boolean;
  error?: string;
  total: number;
  qualified: number;
  disqualified: number;
  duplicates: number;
}

/**
 * Shared intake pipeline: dedup → score → assign → insert → log run.
 * All intake entry points funnel through this.
 */
export async function runIntakePipeline(
  leads: RawLeadInput[],
  triggerType: IntakeTriggerType,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<IntakeResult> {
  // Load existing for dedup (include disqualified to prevent re-importing rejected leads)
  const { data: existingLeads } = await supabase
    .from('growth_leads')
    .select('id, company_name, website, instagram_handle')
    .in('status', ['new', 'qualified', 'converted', 'disqualified']);

  const dedupIndex = buildDedupIndex(existingLeads || []);

  // Load eligible staff
  const { data: salesStaff } = await supabase
    .from('profiles')
    .select('user_id, name, sales_tier')
    .eq('role', '销售')
    .not('sales_tier', 'is', null);

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

  let qualified = 0;
  let disqualified = 0;
  let duplicates = 0;
  const rowsToInsert: any[] = [];

  for (const lead of leads) {
    const dupReason = isDuplicate(lead, dedupIndex);
    if (dupReason) {
      duplicates++;
      continue;
    }

    const processed = lead.ai_analysis
      ? processLeadWithAI(lead, lead.ai_analysis as any)
      : processLead(lead);
    let assignedTo: string | null = null;
    let assignedAt: string | null = null;
    let nextActionDue: string | null = null;

    if (processed.status === 'new') {
      assignedTo = assignLeadByTier(staffList, processed.tier);
      if (assignedTo) {
        assignedAt = nowIso;
        nextActionDue = firstActionDue;
        const staff = staffList.find((s) => s.user_id === assignedTo);
        if (staff) staff.load++;
      }
      qualified++;
    } else {
      disqualified++;
    }

    rowsToInsert.push({
      company_name: lead.company_name,
      contact_name: lead.contact_name || null,
      source: lead.source || null,
      website: lead.website || null,
      product_match: lead.product_match || null,
      contact_email: lead.contact_email || null,
      contact_linkedin: lead.contact_linkedin || null,
      instagram_handle: lead.instagram_handle || null,
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
      created_by: userId,
      ai_analysis: lead.ai_analysis || null,
      verification_status: processed.status === 'new' ? 'pending' : 'none',
    });

    registerInIndex(lead, dedupIndex);
  }

  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from('growth_leads').insert(rowsToInsert);
    if (error) {
      return { error: error.message, total: leads.length, qualified: 0, disqualified: 0, duplicates: 0 };
    }
  }

  // Log the intake run
  await supabase.from('growth_intake_runs').insert({
    trigger_type: triggerType,
    created_by: userId,
    total: leads.length,
    qualified,
    disqualified,
    duplicates,
  });

  revalidatePath('/growth/intake');
  return { success: true, total: leads.length, qualified, disqualified, duplicates };
}

/**
 * Preview-only dedup check: loads existing leads and checks each input for duplicates.
 * Returns the set of indices that are likely duplicates.
 */
export async function previewDedupCheck(
  leads: RawLeadInput[],
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Set<number>> {
  const { data: existingLeads } = await supabase
    .from('growth_leads')
    .select('id, company_name, website, instagram_handle')
    .in('status', ['new', 'qualified', 'converted']);

  const dedupIndex = buildDedupIndex(existingLeads || []);
  const dupIndices = new Set<number>();

  for (let i = 0; i < leads.length; i++) {
    if (isDuplicate(leads[i], dedupIndex)) {
      dupIndices.add(i);
    }
  }

  return dupIndices;
}

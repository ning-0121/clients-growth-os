'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { processLead } from '@/lib/growth/lead-engine';
import { assignLeadByTier } from '@/lib/growth/lead-assignment';
import { buildDedupIndex, isDuplicate, registerInIndex } from '@/lib/growth/lead-dedup';
import { RawLeadInput, SalesTier, IntakeTriggerType } from '@/lib/types';
import { revalidatePath } from 'next/cache';

/**
 * Shared intake pipeline: dedup → score → assign → insert → log run.
 * All intake entry points funnel through this.
 */
async function runIntakePipeline(
  leads: RawLeadInput[],
  triggerType: IntakeTriggerType,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  // Load existing for dedup
  const { data: existingLeads } = await supabase
    .from('growth_leads')
    .select('id, company_name, website, instagram_handle')
    .in('status', ['new', 'qualified', 'converted']);

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

    const processed = processLead(lead);
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
    });

    registerInIndex(lead, dedupIndex);
  }

  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from('growth_leads').insert(rowsToInsert);
    if (error) {
      return { error: error.message };
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

const SAMPLE_COMPANIES = [
  { name: 'Zara Home EU', product: 'T恤、卫衣', web: true, email: true, li: true, ig: 'zarahome' },
  { name: 'Urban Outfitters', product: 'hoodie, jacket', web: true, email: true, li: false, ig: '' },
  { name: 'H&M Group', product: '衬衫、裤', web: true, email: false, li: true, ig: 'hm' },
  { name: 'Primark Ltd', product: 'dress, polo', web: true, email: true, li: true, ig: 'primark' },
  { name: 'Boohoo Group', product: 'T恤', web: true, email: true, li: false, ig: '' },
  { name: 'ASOS plc', product: '外套、卫衣、裤', web: true, email: true, li: true, ig: 'asos' },
  { name: 'Shein Trading', product: 'shirt, pants', web: true, email: false, li: true, ig: 'shein' },
  { name: 'Next PLC', product: 'jacket', web: true, email: true, li: false, ig: '' },
  { name: 'Mango Fashion', product: '衬衫', web: true, email: true, li: true, ig: 'mango' },
  { name: 'Pull&Bear', product: 'hoodie', web: true, email: false, li: false, ig: '' },
  { name: 'Bershka SL', product: '', web: true, email: true, li: false, ig: '' },
  { name: 'River Island', product: 'T恤、polo', web: false, email: true, li: true, ig: '' },
  { name: 'Topshop Ltd', product: 'dress', web: true, email: true, li: true, ig: 'topshop' },
  { name: 'New Look', product: '外套', web: true, email: true, li: false, ig: '' },
  { name: 'Superdry Inc', product: 'jacket, hoodie', web: true, email: false, li: true, ig: '' },
  { name: 'Ted Baker', product: '衬衫、裤', web: true, email: true, li: true, ig: 'tedbaker' },
  { name: 'Jack & Jones', product: 'T恤', web: true, email: true, li: false, ig: '' },
  { name: 'Uniqlo GU', product: 'shirt, pants, jacket', web: true, email: true, li: true, ig: 'uniqlo' },
  { name: 'Gap Inc', product: 'hoodie, T恤', web: true, email: true, li: false, ig: 'gap' },
  { name: 'Levi Strauss', product: '裤', web: true, email: false, li: true, ig: '' },
  { name: 'Tommy Hilfiger', product: 'polo, 衬衫', web: true, email: true, li: true, ig: 'tommyhilfiger' },
  { name: 'Calvin Klein', product: 'T恤, 外套', web: true, email: true, li: true, ig: 'calvinklein' },
  { name: 'Ralph Lauren', product: 'polo, shirt', web: true, email: false, li: true, ig: '' },
  { name: 'Abercrombie', product: 'hoodie', web: true, email: true, li: false, ig: '' },
  { name: 'Hollister Co', product: 'T恤', web: true, email: true, li: true, ig: 'hollister' },
  { name: 'Forever 21', product: 'dress, T恤', web: true, email: false, li: false, ig: '' },
  { name: 'Missguided', product: '', web: false, email: true, li: false, ig: '' },
  { name: 'PrettyLittle', product: 'dress', web: true, email: true, li: true, ig: 'prettylittlething' },
  { name: 'Nasty Gal', product: '外套', web: true, email: true, li: false, ig: '' },
  { name: 'Fashion Nova', product: 'pants, dress', web: true, email: false, li: true, ig: 'fashionnova' },
  { name: 'Revolve Group', product: '衬衫、外套', web: true, email: true, li: true, ig: 'revolve' },
  { name: 'Anthropologie', product: 'dress', web: true, email: true, li: false, ig: '' },
  { name: 'Free People', product: 'hoodie, jacket', web: true, email: true, li: true, ig: '' },
  { name: 'J.Crew Group', product: '衬衫、polo', web: true, email: false, li: true, ig: '' },
  { name: 'Banana Republic', product: 'shirt, pants', web: true, email: true, li: false, ig: '' },
  { name: 'Old Navy', product: 'T恤', web: true, email: true, li: true, ig: '' },
  { name: 'Esprit Holdings', product: '卫衣、外套', web: true, email: true, li: true, ig: 'esprit' },
  { name: 'C&A Fashion', product: 'T恤、裤', web: true, email: false, li: true, ig: '' },
  { name: 'Zalando SE', product: 'hoodie', web: true, email: true, li: false, ig: '' },
  { name: 'About You', product: 'jacket, shirt', web: true, email: true, li: true, ig: '' },
  { name: 'Farfetch Ltd', product: '外套', web: true, email: false, li: false, ig: '' },
  { name: 'SSENSE', product: 'hoodie, T恤', web: true, email: true, li: true, ig: '' },
  { name: 'Net-a-Porter', product: 'dress, 衬衫', web: true, email: true, li: true, ig: '' },
  { name: 'Matchesfashion', product: '', web: true, email: true, li: false, ig: '' },
  { name: 'Selfridges', product: 'jacket', web: true, email: false, li: true, ig: '' },
  { name: 'Harrods Ltd', product: 'polo, 衬衫', web: true, email: true, li: true, ig: '' },
  { name: 'John Lewis', product: 'shirt, hoodie', web: true, email: true, li: false, ig: '' },
  { name: 'M&S Fashion', product: 'T恤、裤', web: true, email: true, li: true, ig: '' },
  { name: 'Debenhams', product: 'dress', web: false, email: true, li: true, ig: '' },
  { name: 'TK Maxx', product: '外套、卫衣', web: true, email: true, li: true, ig: '' },
];

const SOURCES: Array<RawLeadInput['source']> = ['ig', 'linkedin', 'website', 'customs', 'referral'];

function generateTestLeads(count: number): RawLeadInput[] {
  const leads: RawLeadInput[] = [];
  for (let i = 0; i < count; i++) {
    const sample = SAMPLE_COMPANIES[i % SAMPLE_COMPANIES.length];
    const suffix = count > SAMPLE_COMPANIES.length ? ` #${Math.floor(i / SAMPLE_COMPANIES.length) + 1}` : '';
    leads.push({
      company_name: sample.name + suffix,
      contact_name: `Contact ${i + 1}`,
      source: SOURCES[i % SOURCES.length],
      website: sample.web ? `https://${sample.name.toLowerCase().replace(/[^a-z]/g, '')}.com` : undefined,
      product_match: sample.product || undefined,
      contact_email: sample.email ? `buyer@${sample.name.toLowerCase().replace(/[^a-z]/g, '')}.com` : undefined,
      contact_linkedin: sample.li ? `linkedin.com/in/contact-${i + 1}` : undefined,
      instagram_handle: sample.ig || undefined,
    });
  }
  return leads;
}

export async function runBatchIntake() {
  const user = await requireAuth();
  const supabase = await createClient();
  const testLeads = generateTestLeads(50);
  return runIntakePipeline(testLeads, 'test_batch', user.id, supabase);
}

/**
 * Run auto-scrape: ingest 20 realistic mock brand leads through the full pipeline.
 */
export async function runAutoScrape() {
  const user = await requireAuth();
  const supabase = await createClient();
  const { getMockLeads } = await import('@/scripts/lead-scraper');
  return runIntakePipeline(getMockLeads(), 'auto_scrape', user.id, supabase);
}

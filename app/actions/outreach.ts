'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { enrollLeadInSequence } from '@/lib/outreach/sequence-engine';
import { revalidatePath } from 'next/cache';

/**
 * Manually enroll a lead into the default outreach sequence.
 * Will fail if lead has a generic email (quality gate).
 */
export async function enrollLeadInOutreach(leadId: string) {
  await requireAuth();
  const supabase = await createClient();

  // Find the default active sequence
  const { data: sequence } = await supabase
    .from('outreach_sequences')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .single();

  if (!sequence) return { error: '没有可用的邮件序列模板' };

  const result = await enrollLeadInSequence(leadId, sequence.id, supabase);

  revalidatePath('/growth/outreach');
  return result;
}

/**
 * Pause an active outreach campaign.
 */
export async function pauseCampaign(campaignId: string) {
  await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase
    .from('outreach_campaigns')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('status', 'active');

  if (error) return { error: error.message };

  revalidatePath('/growth/outreach');
  return { success: true };
}

/**
 * Resume a paused campaign.
 */
export async function resumeCampaign(campaignId: string) {
  await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase
    .from('outreach_campaigns')
    .update({
      status: 'active',
      next_send_at: new Date().toISOString(), // send ASAP
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId)
    .eq('status', 'paused');

  if (error) return { error: error.message };

  revalidatePath('/growth/outreach');
  return { success: true };
}

/**
 * Pause ALL campaigns that have generic/role-based emails.
 * Use this to bulk-clean the queue before DNS is verified.
 */
export async function pauseAllGenericEmailCampaigns() {
  await requireAuth();
  const supabase = await createClient();

  const GENERIC_PREFIXES = ['info', 'hello', 'contact', 'sales', 'support', 'help', 'admin', 'office', 'mail', 'team'];

  // Fetch all active campaigns with their email
  const { data: campaigns } = await supabase
    .from('outreach_campaigns')
    .select('id, growth_leads!inner(contact_email)')
    .eq('status', 'active');

  if (!campaigns?.length) return { success: true, paused: 0 };

  const genericIds = campaigns.filter((c: any) => {
    const email = c.growth_leads?.contact_email || '';
    const local = email.split('@')[0].toLowerCase();
    return GENERIC_PREFIXES.some(p => local === p);
  }).map((c: any) => c.id);

  if (genericIds.length === 0) return { success: true, paused: 0 };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('outreach_campaigns')
    .update({ status: 'paused', updated_at: now })
    .in('id', genericIds);

  if (error) return { error: error.message };

  revalidatePath('/growth/outreach');
  return { success: true, paused: genericIds.length };
}

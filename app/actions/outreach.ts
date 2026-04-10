'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { enrollLeadInSequence } from '@/lib/outreach/sequence-engine';
import { revalidatePath } from 'next/cache';

/**
 * Manually enroll a lead into the default outreach sequence.
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

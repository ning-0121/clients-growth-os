'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { LeadActionType, GrowthLead } from '@/lib/types';

// V1 next_action_due rules (hours from now)
const NEXT_ACTION_HOURS: Record<LeadActionType, number | null> = {
  email: 48,           // allow 2 days for reply
  social_outreach: 48, // allow 2 days for reply
  call: 24,            // follow up next day
  reply: 4,            // hot lead, respond fast
  promote: null,       // lead exits execution queue
  reject: null,        // exits queue
  return: null,        // exits queue
};

/**
 * Record an evidence-based action on a lead.
 * Updates lead execution state (first_touch, last_action, next_action_due, action_count).
 */
export async function recordLeadAction(
  leadId: string,
  actionType: LeadActionType,
  note: string | null,
  evidenceJson: Record<string, any>
) {
  const user = await requireAuth();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  // Verify lead exists and is assigned to this user (or user is admin)
  const { data: lead, error: fetchError } = await supabase
    .from('growth_leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (fetchError || !lead) {
    return { error: '找不到该线索' };
  }

  const d = lead as GrowthLead;

  if (d.assigned_to !== user.id && profile?.role !== '管理员') {
    return { error: '只能操作分配给自己的线索' };
  }

  if (d.status === 'disqualified') {
    return { error: '已淘汰的线索不能执行操作' };
  }

  if (d.status === 'converted') {
    return { error: '已转化的线索不能执行操作' };
  }

  // Validate evidence_json is not empty for touch actions
  if (['email', 'social_outreach', 'call'].includes(actionType)) {
    if (!evidenceJson || Object.keys(evidenceJson).length === 0) {
      return { error: '触达操作必须提供证据' };
    }
  }

  // Reply must have a summary
  if (actionType === 'reply') {
    if (!evidenceJson?.summary?.trim()) {
      return { error: '回复必须填写回复内容摘要' };
    }
  }

  // Reject/return must have a reason
  if (['reject', 'return'].includes(actionType)) {
    if (!evidenceJson?.reason) {
      return { error: '拒绝/退回必须填写原因' };
    }
  }

  // Insert action record
  const { error: actionError } = await supabase.from('growth_lead_actions').insert({
    lead_id: leadId,
    action_type: actionType,
    note: note?.trim() || null,
    evidence_json: evidenceJson,
    created_by: user.id,
  });

  if (actionError) {
    return { error: actionError.message };
  }

  // Compute lead updates
  const now = new Date();
  const nowIso = now.toISOString();
  const updates: Record<string, any> = {
    last_action_at: nowIso,
    action_count: (d.action_count || 0) + 1,
    updated_at: nowIso,
  };

  // First touch tracking
  const isTouchAction = ['email', 'social_outreach', 'call'].includes(actionType);
  if (isTouchAction && !d.first_touch_at) {
    updates.first_touch_at = nowIso;
  }

  // Reply upgrades lead to qualified
  if (actionType === 'reply') {
    updates.status = 'qualified';
  }

  // next_action_due
  const hoursUntilNext = NEXT_ACTION_HOURS[actionType];
  if (hoursUntilNext === null) {
    updates.next_action_due = null;
  } else {
    updates.next_action_due = new Date(now.getTime() + hoursUntilNext * 60 * 60 * 1000).toISOString();
  }

  // Status changes for reject/return
  if (actionType === 'reject') {
    updates.status = 'disqualified';
    updates.disqualified_reason = evidenceJson.reason;
    updates.assigned_to = null;
    updates.next_action_due = null;
  }

  if (actionType === 'return') {
    updates.status = 'new';
    updates.assigned_to = null;
    updates.assigned_at = null;
    updates.next_action_due = null;
  }

  const { error: updateError } = await supabase
    .from('growth_leads')
    .update(updates)
    .eq('id', leadId);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath('/growth/my-today');
  revalidatePath('/growth/intake');
  revalidatePath(`/growth/leads/${leadId}`);
  return { success: true };
}

/**
 * Mark a lead as having received a meaningful reply.
 * Uses action_type = 'reply'. Requires summary evidence.
 * Upgrades lead status to 'qualified'. Sets next_action_due to 4 hours.
 */
export async function markMeaningfulReply(leadId: string, summary: string) {
  if (!summary?.trim()) {
    return { error: '请填写回复内容摘要' };
  }

  return recordLeadAction(leadId, 'reply', null, {
    summary: summary.trim(),
  });
}

/**
 * Promote a lead into a deal (Growth → Deal step).
 * Creates a growth_deals row and marks the lead as 'converted'.
 * Duplicate protection: blocks if lead already has an active deal.
 */
export async function promoteLeadToDeal(
  leadId: string,
  data: {
    estimated_order_value?: number;
    product_category?: string;
    notes?: string;
  }
) {
  const user = await requireAuth();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  // Read lead
  const { data: lead, error: fetchError } = await supabase
    .from('growth_leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (fetchError || !lead) {
    return { error: '找不到该线索' };
  }

  const d = lead as GrowthLead;

  if (d.assigned_to !== user.id && profile?.role !== '管理员') {
    return { error: '只能操作分配给自己的线索' };
  }

  if (d.status !== 'new' && d.status !== 'qualified') {
    return { error: `线索状态为"${d.status}"，无法转为商机` };
  }

  // Duplicate promote protection: check for existing active deal
  const { data: existingDeal } = await supabase
    .from('growth_deals')
    .select('id')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .maybeSingle();

  if (existingDeal) {
    return { error: '该线索已有活跃商机，不能重复转化' };
  }

  // Create deal
  const { data: deal, error: dealError } = await supabase
    .from('growth_deals')
    .insert({
      lead_id: leadId,
      customer_name: d.company_name,
      deal_stage: '报价',
      status: 'active',
      owner_id: user.id,
      estimated_order_value: data.estimated_order_value || null,
      product_category: data.product_category || d.product_match || null,
      notes: data.notes || null,
    })
    .select('id')
    .single();

  if (dealError) {
    return { error: dealError.message };
  }

  // Update lead status to converted
  const now = new Date().toISOString();
  await supabase
    .from('growth_leads')
    .update({
      status: 'converted',
      next_action_due: null,
      updated_at: now,
    })
    .eq('id', leadId);

  // Log promote action with evidence
  await supabase.from('growth_lead_actions').insert({
    lead_id: leadId,
    action_type: 'promote',
    note: '转为商机',
    evidence_json: {
      deal_id: deal.id,
      estimated_order_value: data.estimated_order_value || null,
      product_category: data.product_category || null,
    },
    created_by: user.id,
  });

  revalidatePath('/growth/my-today');
  revalidatePath('/growth/intake');
  revalidatePath(`/growth/leads/${leadId}`);
  return { success: true, deal_id: deal.id };
}

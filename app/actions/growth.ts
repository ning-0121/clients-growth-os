'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { GrowthDeal, DealStage } from '@/lib/types';

const STAGE_SEQUENCE: DealStage[] = ['报价', '样品', '试单', '大货'];

/**
 * Advance a deal to the next stage.
 * Only forward movement: 报价 → 样品 → 试单 → 大货.
 */
export async function advanceDealStage(dealId: string) {
  const user = await requireAuth();
  const supabase = await createClient();

  const { data: deal, error: fetchError } = await supabase
    .from('growth_deals')
    .select('*')
    .eq('id', dealId)
    .single();

  if (fetchError || !deal) {
    return { error: fetchError?.message || '找不到该商机' };
  }

  const d = deal as GrowthDeal;

  if (d.status !== 'active') {
    return { error: '只有活跃商机才能推进阶段' };
  }

  const currentIdx = STAGE_SEQUENCE.indexOf(d.deal_stage);
  if (currentIdx === -1 || currentIdx >= STAGE_SEQUENCE.length - 1) {
    return { error: `商机已在最终阶段"${d.deal_stage}"，无法继续推进` };
  }

  const fromStage = d.deal_stage;
  const toStage = STAGE_SEQUENCE[currentIdx + 1];
  const now = new Date().toISOString();

  // Update deal stage
  const { error: updateError } = await supabase
    .from('growth_deals')
    .update({ deal_stage: toStage, updated_at: now })
    .eq('id', dealId);

  if (updateError) {
    return { error: updateError.message };
  }

  // Log action
  if (d.lead_id) {
    await supabase.from('growth_lead_actions').insert({
      lead_id: d.lead_id,
      action_type: 'deal_stage_advance',
      note: `商机阶段推进: ${fromStage} → ${toStage}`,
      evidence_json: {
        deal_id: dealId,
        from_stage: fromStage,
        to_stage: toStage,
        type: 'deal_stage_advance',
      },
      created_by: user.id,
    });
  }

  revalidatePath('/growth/deals');
  if (d.lead_id) {
    revalidatePath(`/growth/leads/${d.lead_id}`);
  }
  return { success: true, from_stage: fromStage, to_stage: toStage };
}

/**
 * Mark a deal as lost. Requires a reason.
 */
export async function markDealLost(dealId: string, reason: string) {
  const user = await requireAuth();
  const supabase = await createClient();

  if (!reason?.trim()) {
    return { error: '请填写丢单原因' };
  }

  const { data: deal, error: fetchError } = await supabase
    .from('growth_deals')
    .select('*')
    .eq('id', dealId)
    .single();

  if (fetchError || !deal) {
    return { error: fetchError?.message || '找不到该商机' };
  }

  const d = deal as GrowthDeal;

  if (d.status !== 'active') {
    return { error: '只有活跃商机才能标记为丢单' };
  }

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('growth_deals')
    .update({ status: 'lost', updated_at: now })
    .eq('id', dealId);

  if (updateError) {
    return { error: updateError.message };
  }

  // Log action
  if (d.lead_id) {
    await supabase.from('growth_lead_actions').insert({
      lead_id: d.lead_id,
      action_type: 'deal_lost',
      note: `商机丢单: ${reason.trim()}`,
      evidence_json: {
        deal_id: dealId,
        stage: d.deal_stage,
        reason: reason.trim(),
        type: 'deal_lost',
      },
      created_by: user.id,
    });
  }

  revalidatePath('/growth/deals');
  if (d.lead_id) {
    revalidatePath(`/growth/leads/${d.lead_id}`);
  }
  return { success: true };
}

/**
 * Mark a deal as won.
 * Only allowed when deal_stage = '大货' and status = 'active'.
 * Emits a DEAL_WON integration event with duplicate protection.
 */
export async function markDealWon(dealId: string) {
  const user = await requireAuth();
  const supabase = await createClient();

  // 1. Read deal
  const { data: deal, error: fetchError } = await supabase
    .from('growth_deals')
    .select('*')
    .eq('id', dealId)
    .single();

  if (fetchError || !deal) {
    return { error: fetchError?.message || '找不到该商机' };
  }

  const d = deal as GrowthDeal;

  if (d.status !== 'active') {
    return { error: '只有活跃商机才能标记为赢单' };
  }

  if (d.deal_stage !== '大货') {
    return { error: '商机必须处于"大货"阶段才能标记赢单' };
  }

  const now = new Date().toISOString();

  // 2. Emit DEAL_WON event FIRST (before updating deal status)
  const idempotencyKey = `deal_won_${dealId}`;

  const payload = {
    deal_id: d.id,
    lead_id: d.lead_id,
    customer_name: d.customer_name,
    deal_stage: d.deal_stage,
    owner_id: d.owner_id,
    estimated_order_value: d.estimated_order_value,
    product_category: d.product_category,
    style_no: d.style_no,
    notes: d.notes,
    won_at: now,
    triggered_by: user.id,
  };

  const { error: eventError } = await supabase
    .from('integration_events')
    .insert({
      event_type: 'DEAL_WON',
      source_module: 'growth_os',
      target_module: 'order_os',
      payload,
      idempotency_key: idempotencyKey,
    });

  if (eventError) {
    if ((eventError as any).code === '23505') {
      return { error: '该商机已经触发过赢单事件，无法重复触发' };
    }
    return { error: `事件发送失败：${eventError.message}` };
  }

  // 3. Update deal status AFTER event is safely persisted
  const { error: updateError } = await supabase
    .from('growth_deals')
    .update({ status: 'won', won_at: now, updated_at: now })
    .eq('id', dealId);

  if (updateError) {
    console.error('Deal status update failed after event emission', updateError);
  }

  // 4. Log deal_won action
  if (d.lead_id) {
    await supabase.from('growth_lead_actions').insert({
      lead_id: d.lead_id,
      action_type: 'deal_won',
      note: '商机赢单',
      evidence_json: {
        deal_id: dealId,
        stage: d.deal_stage,
        estimated_order_value: d.estimated_order_value,
        type: 'deal_won',
      },
      created_by: user.id,
    });
  }

  revalidatePath('/growth/deals');
  if (d.lead_id) {
    revalidatePath(`/growth/leads/${d.lead_id}`);
  }
  return { success: true };
}

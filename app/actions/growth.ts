'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { GrowthDeal } from '@/lib/types';

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
  //    If event fails, deal stays 'active' — no orphan state.
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
    // Event exists but deal update failed — log but don't block.
    // The event will still create a draft. Deal can be retried.
    console.error('Deal status update failed after event emission', updateError);
  }

  revalidatePath('/growth/deals');
  return { success: true };
}

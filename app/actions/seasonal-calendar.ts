'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { Market, CustomerType, SeasonCode } from '@/lib/types';
import { calculateDeadlines, deadlinesToTasks, MARKET_SEASONS } from '@/lib/growth/seasonal-calendar';

const REVALIDATE_PATH = '/growth/calendar';

// ── Customer Profile CRUD ──

export async function createCustomerProfile(data: {
  customer_name: string;
  market: Market;
  customer_type: CustomerType;
  product_preferences?: string;
  notes?: string;
  lead_id?: string;
}) {
  const user = await requireAuth();
  const supabase = await createClient();

  const { data: profile, error } = await supabase
    .from('customer_profiles')
    .insert({
      customer_name: data.customer_name,
      market: data.market,
      customer_type: data.customer_type,
      product_preferences: data.product_preferences || null,
      notes: data.notes || null,
      lead_id: data.lead_id || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath(REVALIDATE_PATH);
  return { success: true, profile };
}

export async function updateCustomerProfile(
  id: string,
  data: Partial<{
    customer_name: string;
    market: Market;
    customer_type: CustomerType;
    product_preferences: string | null;
    notes: string | null;
  }>
) {
  await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase
    .from('customer_profiles')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}

// ── Seasonal Config CRUD ──

export async function upsertSeasonalConfig(
  customerId: string,
  season: SeasonCode,
  configData: {
    is_active: boolean;
    shelf_month_start?: number | null;
    shelf_month_end?: number | null;
    custom_prep_offset?: number | null;
    custom_meeting_offset?: number | null;
    custom_order_offset?: number | null;
    product_categories?: string | null;
    typical_order_value?: number | null;
    notes?: string | null;
  }
) {
  await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase
    .from('customer_seasonal_configs')
    .upsert(
      {
        customer_id: customerId,
        season,
        ...configData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id,season' }
    );

  if (error) return { error: error.message };

  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}

// ── Task Generation ──

/**
 * Generate seasonal tasks for a customer for a target year.
 * Reads all active seasonal configs, calculates deadlines, upserts tasks.
 */
export async function generateSeasonalTasks(
  customerId: string,
  targetYear: number,
  assignTo?: string
) {
  await requireAuth();
  const supabase = await createClient();

  // Get customer profile for market
  const { data: profile } = await supabase
    .from('customer_profiles')
    .select('market')
    .eq('id', customerId)
    .single();

  if (!profile) return { error: '客户不存在' };

  // Get active seasonal configs
  const { data: configs } = await supabase
    .from('customer_seasonal_configs')
    .select('*')
    .eq('customer_id', customerId)
    .eq('is_active', true);

  if (!configs || configs.length === 0) {
    return { error: '该客户没有启用的季节配置' };
  }

  const market = profile.market as Market;
  let totalTasks = 0;

  for (const config of configs) {
    const season = config.season as SeasonCode;
    const deadlines = calculateDeadlines(market, season, targetYear, {
      shelfMonthStart: config.shelf_month_start,
      customPrepOffset: config.custom_prep_offset,
      customMeetingOffset: config.custom_meeting_offset,
      customOrderOffset: config.custom_order_offset,
    });

    const tasks = deadlinesToTasks(deadlines);

    for (const task of tasks) {
      const { error } = await supabase
        .from('seasonal_tasks')
        .upsert(
          {
            customer_id: customerId,
            season,
            target_year: targetYear,
            task_type: task.taskType,
            due_date: task.dueDate,
            assigned_to: assignTo || null,
          },
          { onConflict: 'customer_id,season,target_year,task_type' }
        );

      if (!error) totalTasks++;
    }
  }

  revalidatePath(REVALIDATE_PATH);
  return { success: true, tasksGenerated: totalTasks };
}

// ── Task Actions ──

export async function completeSeasonalTask(taskId: string) {
  await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase
    .from('seasonal_tasks')
    .update({
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) return { error: error.message };

  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}

export async function linkDealToTask(taskId: string, dealId: string) {
  await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase
    .from('seasonal_tasks')
    .update({
      deal_id: dealId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) return { error: error.message };

  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}

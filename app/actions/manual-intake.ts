'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { runIntakePipeline, IntakeResult } from '@/lib/growth/intake-pipeline';
import { RawLeadInput } from '@/lib/types';

/**
 * Server action: submit a single lead through the intake pipeline.
 */
export async function runManualIntake(lead: RawLeadInput): Promise<IntakeResult> {
  const user = await requireAuth();
  const supabase = await createClient();

  if (!lead.company_name?.trim()) {
    return { error: '公司名称不能为空', total: 0, qualified: 0, disqualified: 0, duplicates: 0 };
  }

  return runIntakePipeline([lead], 'manual', user.id, supabase);
}

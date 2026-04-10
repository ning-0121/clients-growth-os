'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { runIntakePipeline, previewDedupCheck, IntakeResult } from '@/lib/growth/intake-pipeline';
import { mapRowsToLeads } from '@/lib/growth/csv-parser';
import { LeadSource, CSVColumnMapping } from '@/lib/types';

const MAX_CSV_ROWS = 200;

export interface CsvIntakeResult extends IntakeResult {
  skipped_no_company: number;
}

/**
 * Server action: import CSV rows through the shared intake pipeline.
 */
export async function runCsvIntake(
  rows: Record<string, string>[],
  mapping: CSVColumnMapping,
  defaultSource: LeadSource,
): Promise<CsvIntakeResult> {
  const user = await requireAuth();
  const supabase = await createClient();

  if (rows.length === 0) {
    return {
      error: 'No rows to import',
      total: 0, qualified: 0, disqualified: 0, duplicates: 0, skipped_no_company: 0,
    };
  }

  if (rows.length > MAX_CSV_ROWS) {
    return {
      error: `Too many rows: ${rows.length} (max ${MAX_CSV_ROWS})`,
      total: 0, qualified: 0, disqualified: 0, duplicates: 0, skipped_no_company: 0,
    };
  }

  const leads = mapRowsToLeads(rows, mapping, defaultSource);
  const skipped_no_company = rows.length - leads.length;

  if (leads.length === 0) {
    return {
      error: 'No valid rows after mapping (all missing company_name)',
      total: 0, qualified: 0, disqualified: 0, duplicates: 0, skipped_no_company,
    };
  }

  const result = await runIntakePipeline(leads, 'csv_upload', user.id, supabase);
  return { ...result, skipped_no_company };
}

/**
 * Server action: check how many rows would be deduplicated.
 * Used for CSV preview warnings.
 */
export async function checkCsvDuplicates(
  rows: Record<string, string>[],
  mapping: CSVColumnMapping,
  defaultSource: LeadSource,
): Promise<number[]> {
  const user = await requireAuth();
  const supabase = await createClient();

  const leads = mapRowsToLeads(rows, mapping, defaultSource);
  const dupIndices = await previewDedupCheck(leads, supabase);
  return Array.from(dupIndices);
}

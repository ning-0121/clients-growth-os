'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { runIntakePipeline } from '@/lib/growth/intake-pipeline';
import { RawLeadInput, LeadSource } from '@/lib/types';
import { enrichBatch, parseInput, EnrichmentFailure } from '@/lib/growth/website-enricher';

const MAX_URLS = 50;
const VALID_SOURCES: LeadSource[] = ['ig', 'linkedin', 'website', 'customs', 'referral'];

export interface WebsiteIntakeResult {
  success?: boolean;
  error?: string;
  total: number;
  qualified: number;
  disqualified: number;
  duplicates: number;
  ig_only_count: number;
  failures: EnrichmentFailure[];
}

/**
 * Server action: parse input text → enrich websites → run intake pipeline.
 */
export async function runWebsiteIntake(
  inputText: string,
  format?: 'txt' | 'csv'
): Promise<WebsiteIntakeResult> {
  const user = await requireAuth();
  const supabase = await createClient();

  // Parse input
  const entries = parseInput(inputText, format);

  if (entries.length === 0) {
    return {
      error: 'No valid URLs found in input',
      total: 0, qualified: 0, disqualified: 0, duplicates: 0,
      ig_only_count: 0, failures: [],
    };
  }

  if (entries.length > MAX_URLS) {
    return {
      error: `Too many URLs: ${entries.length} (max ${MAX_URLS} per batch)`,
      total: 0, qualified: 0, disqualified: 0, duplicates: 0,
      ig_only_count: 0, failures: [],
    };
  }

  // Enrich
  const { results, failures } = await enrichBatch(entries);

  if (results.length === 0) {
    // Log the failed run
    await supabase.from('growth_intake_runs').insert({
      trigger_type: 'website_batch',
      created_by: user.id,
      total: 0,
      qualified: 0,
      disqualified: 0,
      duplicates: 0,
    });

    return {
      error: 'All URLs failed to enrich',
      total: 0, qualified: 0, disqualified: 0, duplicates: 0,
      ig_only_count: 0, failures,
    };
  }

  // Convert to RawLeadInput
  const leads: RawLeadInput[] = results.map((r) => {
    const sourceLabel = (r as any)._source_label;
    const source: LeadSource = (sourceLabel && VALID_SOURCES.includes(sourceLabel))
      ? sourceLabel
      : 'website';

    return {
      company_name: r.company_name,
      source,
      website: r.website,
      contact_email: r.contact_email || undefined,
      instagram_handle: r.instagram_handle || undefined,
      contact_linkedin: r.contact_linkedin || undefined,
      product_match: r.product_match || undefined,
      ai_analysis: r.ai_analysis || undefined,
    };
  });

  // Run through shared intake pipeline
  const pipelineResult = await runIntakePipeline(leads, 'website_batch', user.id, supabase);
  const ig_only_count = results.filter((r) => r.ig_only).length;

  return {
    ...pipelineResult,
    ig_only_count,
    failures,
  };
}

import { createClient } from '@/lib/supabase/server';
import { VerificationEvidence, VerificationRunResult } from '@/lib/ai/types';
import { runRound1 } from './verification-rounds/round1-basic';
import { runRound2 } from './verification-rounds/round2-contact';
import { runRound3 } from './verification-rounds/round3-customs';
import { runRound4 } from './verification-rounds/round4-composite';
import { enrollLeadInSequence } from '@/lib/outreach/sequence-engine';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Status → which round to run next
const STATUS_TO_ROUND: Record<string, number> = {
  pending: 1,
  round_1: 2,
  round_2: 3,
  round_3: 4,
};

const NEXT_STATUS: Record<number, string> = {
  1: 'round_1',
  2: 'round_2',
  3: 'round_3',
  4: 'completed',
};

// Timeout: leads stuck >24h get marked as failed
const STUCK_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * Run the multi-round verification pipeline.
 * Processes leads in batches, advancing each through the next round.
 * Designed to be called by a cron/API endpoint (e.g., every 15 minutes).
 */
export async function runVerificationPipeline(
  supabase: SupabaseClient,
  batchSize = 20
): Promise<VerificationRunResult> {
  const result: VerificationRunResult = {
    processed: 0,
    advanced: 0,
    disqualified: 0,
    failed: 0,
  };

  // Mark stuck leads as failed
  await markStuckLeads(supabase);

  // Fetch leads that need processing (any processable status)
  const { data: leads } = await supabase
    .from('growth_leads')
    .select('*')
    .in('verification_status', ['pending', 'round_1', 'round_2', 'round_3'])
    .neq('status', 'disqualified')
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (!leads || leads.length === 0) {
    return result;
  }

  for (const lead of leads) {
    const round = STATUS_TO_ROUND[lead.verification_status];
    if (!round) continue;

    result.processed++;

    try {
      const { disqualify, disqualifyReason, evidence } = await processRound(lead, round, supabase);

      // Append evidence to the lead's verification trail
      const existingEvidence: VerificationEvidence[] = Array.isArray(lead.verification_evidence)
        ? lead.verification_evidence
        : [];
      const updatedEvidence = [...existingEvidence, evidence];

      if (disqualify) {
        // Disqualify the lead
        await supabase
          .from('growth_leads')
          .update({
            status: 'disqualified',
            disqualified_reason: disqualifyReason || `验证第${round}轮未通过`,
            verification_status: 'failed',
            verification_evidence: updatedEvidence,
            assigned_to: null,
            assigned_at: null,
            next_action_due: null,
          })
          .eq('id', lead.id);
        result.disqualified++;
      } else {
        // Advance to next status
        const nextStatus = NEXT_STATUS[round];

        // Save any contact info discovered during verification
        const updateData: Record<string, any> = {
          verification_status: nextStatus,
          verification_evidence: updatedEvidence,
        };
        // If round 2 found new email/linkedin via contact hunter, save them
        if (round === 2 && lead.contact_email && !lead._original_email) {
          updateData.contact_email = lead.contact_email;
        }
        if (round === 2 && lead.contact_linkedin && !lead._original_linkedin) {
          updateData.contact_linkedin = lead.contact_linkedin;
        }
        // Save phone/address from verification evidence
        for (const check of evidence.checks) {
          if (check.data?.phone) updateData.contact_phone = check.data.phone;
          if (check.data?.address) updateData.contact_address = check.data.address;
          if (check.data?.contacts) updateData.contact_people = check.data.contacts;
        }

        await supabase
          .from('growth_leads')
          .update(updateData)
          .eq('id', lead.id);
        result.advanced++;

        // Auto-enroll in outreach when verification completes with 'pursue'
        if (nextStatus === 'completed') {
          try {
            const { data: updatedLead } = await supabase
              .from('growth_leads')
              .select('ai_recommendation, contact_email')
              .eq('id', lead.id)
              .single();

            if (updatedLead?.ai_recommendation === 'pursue' && updatedLead?.contact_email) {
              // Find default active sequence
              const { data: defaultSeq } = await supabase
                .from('outreach_sequences')
                .select('id')
                .eq('is_active', true)
                .limit(1)
                .single();

              if (defaultSeq) {
                await enrollLeadInSequence(lead.id, defaultSeq.id, supabase);
              }
            }
          } catch {
            // Non-critical: don't fail verification if outreach enrollment fails
          }
        }
      }
    } catch (err) {
      console.error(`[Verification] Error processing lead ${lead.id} at round ${round}:`, err);
      result.failed++;
    }
  }

  return result;
}

async function processRound(
  lead: Record<string, any>,
  round: number,
  supabase: SupabaseClient
): Promise<{ disqualify: boolean; disqualifyReason?: string; evidence: VerificationEvidence }> {
  let checks: any[] = [];
  let disqualify = false;
  let disqualifyReason: string | undefined;

  switch (round) {
    case 1: {
      const r1 = await runRound1(lead, supabase);
      checks = r1.checks;
      disqualify = r1.disqualify;
      disqualifyReason = r1.disqualifyReason;
      break;
    }
    case 2: {
      const r2 = await runRound2(lead);
      checks = r2.checks;
      disqualify = r2.disqualify;
      disqualifyReason = r2.disqualifyReason;
      break;
    }
    case 3: {
      const r3 = await runRound3(lead, supabase);
      checks = r3.checks;
      break;
    }
    case 4: {
      const r4 = await runRound4(lead, supabase);
      checks = r4.checks;
      break;
    }
  }

  return {
    disqualify,
    disqualifyReason,
    evidence: {
      round,
      timestamp: new Date().toISOString(),
      checks,
    },
  };
}

async function markStuckLeads(supabase: SupabaseClient) {
  const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MS).toISOString();

  await supabase
    .from('growth_leads')
    .update({ verification_status: 'failed' })
    .in('verification_status', ['pending', 'round_1', 'round_2', 'round_3'])
    .lt('updated_at', cutoff);
}

import { SupabaseClient } from '@supabase/supabase-js';
import { generateColdEmail } from './email-generator';
import { sendEmail } from './resend-client';
import { EmailType } from '@/lib/ai/prompts';

interface SequenceStep {
  step_number: number;
  delay_days: number;
  email_type: EmailType;
}

/**
 * Enroll a lead into an outreach sequence.
 * Skips if lead has no email or is already in an active campaign.
 */
export async function enrollLeadInSequence(
  leadId: string,
  sequenceId: string,
  supabase: SupabaseClient
): Promise<{ success: boolean; error?: string }> {
  // Check lead has email
  const { data: lead } = await supabase
    .from('growth_leads')
    .select('id, contact_email, outreach_status')
    .eq('id', leadId)
    .single();

  if (!lead) return { success: false, error: 'Lead not found' };
  if (!lead.contact_email) return { success: false, error: 'Lead has no email' };
  if (lead.outreach_status === 'replied' || lead.outreach_status === 'opted_out') {
    return { success: false, error: `Lead outreach_status is ${lead.outreach_status}` };
  }

  // Check no active campaign exists
  const { data: existing } = await supabase
    .from('outreach_campaigns')
    .select('id')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .limit(1);

  if (existing && existing.length > 0) {
    return { success: false, error: 'Lead already has an active campaign' };
  }

  // Get sequence to determine first step timing
  const { data: sequence } = await supabase
    .from('outreach_sequences')
    .select('steps')
    .eq('id', sequenceId)
    .single();

  if (!sequence) return { success: false, error: 'Sequence not found' };

  const steps = sequence.steps as SequenceStep[];
  const firstStep = steps.find((s) => s.step_number === 1);
  const delayMs = (firstStep?.delay_days || 0) * 24 * 60 * 60 * 1000;
  const nextSendAt = new Date(Date.now() + delayMs).toISOString();

  // Create campaign
  const { error } = await supabase.from('outreach_campaigns').insert({
    lead_id: leadId,
    sequence_id: sequenceId,
    current_step: 1,
    status: 'active',
    next_send_at: nextSendAt,
  });

  if (error) return { success: false, error: error.message };

  // Update lead outreach status
  await supabase
    .from('growth_leads')
    .update({ outreach_status: 'enrolled' })
    .eq('id', leadId);

  return { success: true };
}

/**
 * Process the outreach queue: find campaigns due for sending,
 * generate AI emails, and send them.
 */
export async function processOutreachQueue(
  supabase: SupabaseClient,
  batchSize = 10
): Promise<{ sent: number; failed: number; completed: number }> {
  const now = new Date().toISOString();
  const result = { sent: 0, failed: 0, completed: 0 };

  // Find campaigns ready to send
  const { data: campaigns } = await supabase
    .from('outreach_campaigns')
    .select(`
      id, lead_id, sequence_id, current_step,
      outreach_sequences!inner(steps),
      growth_leads!inner(id, company_name, contact_name, contact_email, website, ai_analysis, customs_summary)
    `)
    .eq('status', 'active')
    .lte('next_send_at', now)
    .limit(batchSize);

  if (!campaigns || campaigns.length === 0) return result;

  for (const campaign of campaigns) {
    const lead = (campaign as any).growth_leads;
    const steps = ((campaign as any).outreach_sequences?.steps || []) as SequenceStep[];
    const currentStepConfig = steps.find((s) => s.step_number === campaign.current_step);

    if (!currentStepConfig || !lead.contact_email) {
      result.failed++;
      continue;
    }

    // Get previous email subjects for context
    const { data: prevEmails } = await supabase
      .from('outreach_emails')
      .select('subject')
      .eq('campaign_id', campaign.id)
      .order('step_number', { ascending: true });

    const previousSubjects = (prevEmails || []).map((e: any) => e.subject);

    // Generate email via AI
    const email = await generateColdEmail(
      lead,
      campaign.current_step,
      currentStepConfig.email_type,
      previousSubjects
    );

    if (!email) {
      // Pause campaign to prevent infinite retry on AI failure
      await supabase
        .from('outreach_campaigns')
        .update({ status: 'paused', updated_at: now })
        .eq('id', campaign.id);
      result.failed++;
      continue;
    }

    // Send via Resend
    const sendResult = await sendEmail({
      to: lead.contact_email,
      subject: email.subject,
      html: email.body_html,
      text: email.body_text,
    });

    if ('error' in sendResult) {
      // Log failed email
      await supabase.from('outreach_emails').insert({
        campaign_id: campaign.id,
        lead_id: campaign.lead_id,
        step_number: campaign.current_step,
        subject: email.subject,
        body_html: email.body_html,
        to_email: lead.contact_email,
        status: 'bounced',
      });

      // If bounced, pause the campaign
      await supabase
        .from('outreach_campaigns')
        .update({ status: 'bounced', updated_at: now })
        .eq('id', campaign.id);

      result.failed++;
      continue;
    }

    // Log sent email
    await supabase.from('outreach_emails').insert({
      campaign_id: campaign.id,
      lead_id: campaign.lead_id,
      step_number: campaign.current_step,
      resend_message_id: sendResult.id,
      subject: email.subject,
      body_html: email.body_html,
      to_email: lead.contact_email,
      status: 'sent',
      sent_at: now,
    });

    // Advance to next step or complete
    const nextStep = steps.find((s) => s.step_number === campaign.current_step + 1);

    if (nextStep) {
      const nextSendAt = new Date(Date.now() + nextStep.delay_days * 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from('outreach_campaigns')
        .update({
          current_step: nextStep.step_number,
          next_send_at: nextSendAt,
          updated_at: now,
        })
        .eq('id', campaign.id);
    } else {
      // Sequence complete
      await supabase
        .from('outreach_campaigns')
        .update({ status: 'completed', completed_at: now, updated_at: now })
        .eq('id', campaign.id);
      result.completed++;
    }

    // Update lead status
    await supabase
      .from('growth_leads')
      .update({ outreach_status: 'sequence_active', last_action_at: now })
      .eq('id', campaign.lead_id);

    result.sent++;
  }

  return result;
}

/**
 * Handle email events from Resend webhook.
 */
export async function handleEmailEvent(
  event: { type: string; data: { email_id?: string } },
  supabase: SupabaseClient
) {
  const resendId = event.data.email_id;
  if (!resendId) return;

  const { data: email } = await supabase
    .from('outreach_emails')
    .select('id, campaign_id, lead_id')
    .eq('resend_message_id', resendId)
    .single();

  if (!email) return;

  const now = new Date().toISOString();

  switch (event.type) {
    case 'email.delivered':
      await supabase.from('outreach_emails').update({ status: 'delivered' }).eq('id', email.id);
      break;

    case 'email.opened':
      await supabase.from('outreach_emails').update({ status: 'opened', opened_at: now }).eq('id', email.id);
      break;

    case 'email.bounced':
      await supabase.from('outreach_emails').update({ status: 'bounced' }).eq('id', email.id);
      await supabase.from('outreach_campaigns').update({ status: 'bounced', updated_at: now }).eq('id', email.campaign_id);
      break;

    case 'email.complained':
      await supabase.from('outreach_emails').update({ status: 'complained' }).eq('id', email.id);
      await supabase.from('outreach_campaigns').update({ status: 'unsubscribed', updated_at: now }).eq('id', email.campaign_id);
      await supabase.from('growth_leads').update({ outreach_status: 'opted_out' }).eq('id', email.lead_id);
      break;
  }
}

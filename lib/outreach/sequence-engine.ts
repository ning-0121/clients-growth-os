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
 * Generic/role-based email prefixes that should NOT receive cold outreach.
 * These go to nobody in particular and get marked as spam.
 */
const GENERIC_EMAIL_PREFIXES = [
  'info', 'hello', 'hi', 'hey', 'contact', 'sales', 'support', 'help',
  'customerservice', 'service', 'care', 'team', 'admin', 'office',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mail', 'email', 'post', 'webmaster', 'feedback',
  'press', 'media', 'pr', 'marketing', 'orders', 'billing',
  'accounts', 'accounting', 'hr', 'jobs', 'careers', 'hiring',
  'legal', 'compliance', 'privacy', 'security',
  'shop', 'store', 'wholesale', 'buy', 'purchasing',
];

/**
 * Check if an email is a generic/role-based address.
 * Returns a quality tier: 'personal' | 'generic' | 'unknown'
 */
export function classifyEmailQuality(email: string): 'personal' | 'generic' | 'unknown' {
  if (!email || !email.includes('@')) return 'unknown';
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
  if (GENERIC_EMAIL_PREFIXES.includes(local)) return 'generic';
  // Personal emails usually have a name (contains letters, possibly numbers/dots)
  // Simple heuristic: if it looks like a name pattern, it's personal
  if (local.length >= 3 && /[a-z]/.test(local)) return 'personal';
  return 'unknown';
}

/**
 * Enroll a lead into an outreach sequence.
 * Skips if lead has no email, generic email, or is already in an active campaign.
 */
export async function enrollLeadInSequence(
  leadId: string,
  sequenceId: string,
  supabase: SupabaseClient
): Promise<{ success: boolean; error?: string; emailQuality?: string }> {
  // Check lead has email
  const { data: lead } = await supabase
    .from('growth_leads')
    .select('id, contact_email, outreach_status, company_name')
    .eq('id', leadId)
    .single();

  if (!lead) return { success: false, error: 'Lead not found' };
  if (!lead.contact_email) return { success: false, error: 'Lead has no email — run enrichment first' };
  if (lead.outreach_status === 'replied' || lead.outreach_status === 'opted_out') {
    return { success: false, error: `Lead outreach_status is ${lead.outreach_status}` };
  }

  // ── EMAIL QUALITY GATE ──────────────────────────────────────────────────
  const emailQuality = classifyEmailQuality(lead.contact_email);
  if (emailQuality === 'generic') {
    // Tag lead so we know why it was skipped — don't just silently skip
    await supabase.from('growth_leads').update({
      outreach_status: 'blocked_generic_email',
    }).eq('id', leadId);
    return {
      success: false,
      error: `Generic email blocked: ${lead.contact_email}. Need personal email (first.last@ format) before sending.`,
      emailQuality,
    };
  }
  // ────────────────────────────────────────────────────────────────────────

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
  // IMPORTANT: A/B grade leads require manual approval — they go through
  // pending_email_approvals queue, NOT through auto-send here.
  // Only C/D grade or uncategorized leads auto-send.
  const { data: campaigns } = await supabase
    .from('outreach_campaigns')
    .select(`
      id, lead_id, sequence_id, current_step,
      outreach_sequences!inner(steps),
      growth_leads!inner(id, company_name, contact_name, contact_email, website, ai_analysis, customs_summary, category, grade)
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

    // Double-check email quality at send time
    if (classifyEmailQuality(lead.contact_email) === 'generic') {
      await supabase.from('outreach_campaigns').update({ status: 'paused', updated_at: now }).eq('id', campaign.id);
      await supabase.from('growth_leads').update({ outreach_status: 'blocked_generic_email' }).eq('id', campaign.lead_id);
      result.failed++;
      continue;
    }

    // ── APPROVAL GATE: A/B grade leads MUST go through pending_email_approvals ──
    // The cron does NOT auto-send them. Sales must manually submit + admin approves.
    const leadCategory = (lead as any).category || ((lead as any).grade === 'A' || (lead as any).grade === 'B' ? (lead as any).grade : null);
    if (leadCategory === 'A' || leadCategory === 'B') {
      // Pause the campaign — don't auto-send high-value leads
      await supabase.from('outreach_campaigns')
        .update({ status: 'paused', updated_at: now })
        .eq('id', campaign.id);
      result.failed++; // not really failed, but skipped
      continue;
    }
    // C/D or uncategorized leads continue to auto-send below

    // Get previous email subjects for context
    const { data: prevEmails } = await supabase
      .from('outreach_emails')
      .select('subject, angle_used')
      .eq('campaign_id', campaign.id)
      .order('step_number', { ascending: true });

    const previousSubjects = (prevEmails || []).map((e: any) => e.subject);
    const previousAngles = (prevEmails || []).map((e: any) => e.angle_used).filter(Boolean);

    // Generate email via AI (with personalization hooks + previous angle tracking)
    const email = await generateColdEmail(
      lead,
      campaign.current_step,
      currentStepConfig.email_type,
      previousSubjects,
      previousAngles
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
      if (sendResult.transient) {
        // Rate limit / network error — leave campaign active, retry next cron run
        result.failed++;
        continue;
      }
      // Permanent send failure (bad address etc.) — log as bounced and pause
      await supabase.from('outreach_emails').insert({
        campaign_id: campaign.id,
        lead_id: campaign.lead_id,
        step_number: campaign.current_step,
        subject: email.subject,
        body_html: email.body_html,
        to_email: lead.contact_email,
        status: 'bounced',
      });
      await supabase
        .from('outreach_campaigns')
        .update({ status: 'bounced', updated_at: now })
        .eq('id', campaign.id);
      result.failed++;
      continue;
    }

    // Log sent email (include body_text for visibility in dashboard)
    await supabase.from('outreach_emails').insert({
      campaign_id: campaign.id,
      lead_id: campaign.lead_id,
      step_number: campaign.current_step,
      resend_message_id: sendResult.id,
      subject: email.subject,
      body_text: email.body_text,
      body_html: email.body_html,
      angle_used: email.angle_used || null,
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
      await supabase.from('outreach_campaigns')
        .update({ status: 'bounced', updated_at: now })
        .eq('id', email.campaign_id)
        .eq('status', 'active');
      break;

    case 'email.complained':
      await supabase.from('outreach_emails').update({ status: 'complained' }).eq('id', email.id);
      await supabase.from('outreach_campaigns')
        .update({ status: 'unsubscribed', updated_at: now })
        .eq('id', email.campaign_id)
        .eq('status', 'active');
      await supabase.from('growth_leads').update({ outreach_status: 'opted_out' }).eq('id', email.lead_id);
      break;
  }
}

/**
 * Email Composer Agent — Generates and sends AI-powered outreach emails.
 *
 * Flow: Receives leads with strategies → Generates personalized emails
 *       → Sends via Resend → Records in outreach log.
 */

import { Agent, AgentContext, AgentResult } from '../types';
import { generateColdEmail } from '@/lib/outreach/email-generator';
import { sendEmail } from '@/lib/outreach/resend-client';
import type { EmailType } from '@/lib/ai/prompts';

export const emailComposerAgent: Agent = {
  role: 'email-composer',
  pipeline: 'outbound',
  description: '生成个性化开发邮件并发送',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const leadIds = (input.leadIds as string[]) || [];

    if (context.leadId && !leadIds.includes(context.leadId)) {
      leadIds.push(context.leadId);
    }

    if (!leadIds.length) {
      return { success: false, error: '没有可发送邮件的线索' };
    }

    try {
      // Fetch leads with active campaigns
      const { data: campaigns, error } = await context.supabase
        .from('outreach_campaigns')
        .select('*, growth_leads(*)')
        .in('lead_id', leadIds)
        .eq('status', 'active');

      if (error || !campaigns?.length) {
        // If no campaigns exist, try to compose the first email for leads with email addresses
        const { data: leads } = await context.supabase
          .from('growth_leads')
          .select('*')
          .in('id', leadIds)
          .not('contact_email', 'is', null);

        if (!leads?.length) {
          return { success: true, data: { sent: 0, message: '没有可用邮箱的线索' }, shouldStop: true };
        }
      }

      const emailsSent: { leadId: string; subject: string; to: string }[] = [];
      const emailsFailed: { leadId: string; error: string }[] = [];

      // Process each campaign
      for (const campaign of (campaigns || [])) {
        const lead = campaign.growth_leads;
        if (!lead?.contact_email) continue;

        const analysis = (lead.ai_analysis as Record<string, unknown>) || {};
        const strategy = (analysis.outreach_strategy || campaign.strategy) as Record<string, unknown>;
        const emailSequence = (strategy?.email_sequence as { step: number; type: string }[]) || [];
        const currentStep = campaign.current_step || 0;
        const nextStep = emailSequence[currentStep];

        if (!nextStep) {
          // Campaign completed
          await context.supabase
            .from('outreach_campaigns')
            .update({ status: 'completed' })
            .eq('id', campaign.id);
          continue;
        }

        try {
          // Generate email using existing lead data
          const email = await generateColdEmail(
            {
              id: lead.id,
              company_name: lead.company_name,
              contact_name: lead.contact_name,
              website: lead.website,
              ai_analysis: analysis,
            },
            nextStep.step,
            nextStep.type as EmailType,
            []
          );

          if (!email) {
            emailsFailed.push({ leadId: lead.id, error: '邮件生成失败' });
            continue;
          }

          // Send email
          const sendResult = await sendEmail({
            to: lead.contact_email,
            subject: email.subject,
            html: email.body_html,
            text: email.body_text,
          });

          if ('error' in sendResult) {
            emailsFailed.push({ leadId: lead.id, error: sendResult.error });
            continue;
          }

          // Log the sent email
          await context.supabase.from('outreach_emails').insert({
            campaign_id: campaign.id,
            lead_id: lead.id,
            step_number: nextStep.step,
            email_type: nextStep.type,
            subject: email.subject,
            body_text: email.body_text,
            body_html: email.body_html,
            to_email: lead.contact_email,
            resend_id: sendResult.id,
            status: 'sent',
            sent_at: new Date().toISOString(),
          });

          // Advance campaign step
          const nextStepIndex = currentStep + 1;
          const delayDays = emailSequence[nextStepIndex]
            ? (emailSequence[nextStepIndex] as unknown as { delay_days: number }).delay_days || 3
            : 0;

          await context.supabase
            .from('outreach_campaigns')
            .update({
              current_step: nextStepIndex,
              last_sent_at: new Date().toISOString(),
              next_send_at: nextStepIndex < emailSequence.length
                ? new Date(Date.now() + delayDays * 86400000).toISOString()
                : null,
              status: nextStepIndex >= emailSequence.length ? 'completed' : 'active',
            })
            .eq('id', campaign.id);

          emailsSent.push({
            leadId: lead.id,
            subject: email.subject,
            to: lead.contact_email,
          });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          emailsFailed.push({ leadId: lead.id, error: errorMsg });
        }
      }

      return {
        success: true,
        data: {
          sent: emailsSent.length,
          failed: emailsFailed.length,
          emails: emailsSent,
          errors: emailsFailed,
          leadIds: emailsSent.map((e) => e.leadId),
        },
        nextAgent: 'follow-up-tracker',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `邮件发送失败: ${errorMsg}` };
    }
  },
};

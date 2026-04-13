/**
 * Follow-up Tracker Agent — Monitors email responses and schedules follow-ups.
 *
 * Flow: Checks for replies → Updates lead status → Schedules next actions
 *       → Escalates hot leads → Loops back to email-composer if needed.
 */

import { Agent, AgentContext, AgentResult } from '../types';

export const followUpTrackerAgent: Agent = {
  role: 'follow-up-tracker',
  pipeline: 'outbound',
  description: '追踪邮件回复，安排后续跟进，持续开发客户',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const leadIds = (input.leadIds as string[]) || [];

    try {
      // Check for any campaigns that need follow-up
      const now = new Date().toISOString();
      const { data: dueCampaigns, error } = await context.supabase
        .from('outreach_campaigns')
        .select('*, growth_leads(id, company_name, contact_email, status)')
        .eq('status', 'active')
        .lte('next_send_at', now);

      if (error) {
        return { success: false, error: error.message };
      }

      // Check for leads that have replied (conversations created)
      const activeCampaignLeadIds = (dueCampaigns || [])
        .map((c: Record<string, unknown>) => {
          const lead = c.growth_leads as Record<string, string>;
          return lead?.id;
        })
        .filter(Boolean);

      if (activeCampaignLeadIds.length > 0) {
        const { data: conversations } = await context.supabase
          .from('conversations')
          .select('lead_id')
          .in('lead_id', activeCampaignLeadIds)
          .eq('status', 'active');

        // Mark leads with replies
        const repliedLeadIds = new Set(
          (conversations || []).map((c: { lead_id: string }) => c.lead_id)
        );

        for (const leadId of repliedLeadIds) {
          // Update lead status to "replied"
          await context.supabase
            .from('growth_leads')
            .update({ status: 'replied' })
            .eq('id', leadId);

          // Pause the campaign — human takes over or AI escalates
          await context.supabase
            .from('outreach_campaigns')
            .update({ status: 'paused' })
            .eq('lead_id', leadId)
            .eq('status', 'active');
        }
      }

      // Log tracking activity
      for (const leadId of leadIds) {
        await context.supabase.from('growth_lead_actions').insert({
          lead_id: leadId,
          action_type: 'auto_track',
          notes: '自动跟踪检查完成',
          created_by: process.env.SYSTEM_USER_ID || '',
        });
      }

      return {
        success: true,
        data: {
          campaignsChecked: dueCampaigns?.length || 0,
          dueForFollowUp: (dueCampaigns || []).filter(
            (c: Record<string, unknown>) => !leadIds.length || leadIds.includes(
              ((c.growth_leads as Record<string, string>)?.id) || ''
            )
          ).length,
          trackedLeads: leadIds.length,
        },
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `追踪失败: ${errorMsg}` };
    }
  },
};

/**
 * Strategy Planner Agent — Develops personalized outreach strategies.
 *
 * Flow: Receives analyzed leads → AI generates multi-step strategy
 *       → Creates outreach campaign plan → Feeds to email-composer.
 */

import { Agent, AgentContext, AgentResult } from '../types';
import { COMPANY } from '@/lib/config/company';
import { analyzeStructured } from '@/lib/ai/ai-service';

const STRATEGY_PROMPT = (lead: LeadForStrategy) => `You are a senior B2B sales strategist for ${COMPANY.name}, a ${COMPANY.description}.

Design a personalized outreach strategy for this potential client.

LEAD PROFILE:
Company: ${lead.company_name}
Website: ${lead.website || 'N/A'}
Products: ${lead.product_match || 'N/A'}
Category: ${lead.category || 'N/A'}
Score: ${lead.score}/100 (Grade: ${lead.grade})
Company Type: ${lead.company_type || 'N/A'}
Scale: ${lead.scale || 'N/A'}
Contact: ${lead.contact_name || 'N/A'} | Email: ${lead.contact_email || 'N/A'}
AI Analysis: ${JSON.stringify(lead.ai_analysis || {})}

Design a 4-step email outreach sequence + social media engagement plan.

Respond with JSON (no markdown):
{
  "strategy": {
    "approach": string (1-2 sentences: overall approach for this lead),
    "tone": "casual" | "professional" | "consultative",
    "key_angle": string (the main value proposition to emphasize),
    "personalization_hooks": string[] (3-5 specific things to reference about their business),
    "email_sequence": [
      {
        "step": number (1-4),
        "type": "intro" | "follow_up" | "value_add" | "breakup",
        "delay_days": number (days after previous email),
        "angle": string (unique angle for this email),
        "key_message": string (core message in 1 sentence)
      }
    ],
    "social_plan": {
      "instagram": string | null (engagement strategy for IG, or null if no IG),
      "linkedin": string | null (engagement strategy for LinkedIn, or null)
    },
    "estimated_conversion_probability": number (0-100),
    "notes": string (any special considerations)
  }
}`;

interface LeadForStrategy {
  company_name: string;
  website?: string;
  product_match?: string;
  category?: string;
  score: number;
  grade: string;
  company_type?: string;
  scale?: string;
  contact_name?: string;
  contact_email?: string;
  ai_analysis?: Record<string, unknown>;
}

interface StrategyResult {
  strategy: {
    approach: string;
    tone: string;
    key_angle: string;
    personalization_hooks: string[];
    email_sequence: {
      step: number;
      type: string;
      delay_days: number;
      angle: string;
      key_message: string;
    }[];
    social_plan: { instagram: string | null; linkedin: string | null };
    estimated_conversion_probability: number;
    notes: string;
  };
}

function validateStrategy(data: unknown): StrategyResult {
  if (!data || typeof data !== 'object') throw new Error('Invalid');
  const d = data as Record<string, unknown>;
  const s = d.strategy as Record<string, unknown>;
  if (!s) throw new Error('Missing strategy');
  return {
    strategy: {
      approach: String(s.approach || ''),
      tone: String(s.tone || 'professional'),
      key_angle: String(s.key_angle || ''),
      personalization_hooks: Array.isArray(s.personalization_hooks)
        ? s.personalization_hooks.map(String)
        : [],
      email_sequence: Array.isArray(s.email_sequence)
        ? s.email_sequence.map((e: Record<string, unknown>) => ({
            step: Number(e.step),
            type: String(e.type),
            delay_days: Number(e.delay_days),
            angle: String(e.angle),
            key_message: String(e.key_message),
          }))
        : [],
      social_plan: {
        instagram: s.social_plan && (s.social_plan as Record<string, unknown>).instagram
          ? String((s.social_plan as Record<string, unknown>).instagram)
          : null,
        linkedin: s.social_plan && (s.social_plan as Record<string, unknown>).linkedin
          ? String((s.social_plan as Record<string, unknown>).linkedin)
          : null,
      },
      estimated_conversion_probability: Number(s.estimated_conversion_probability || 0),
      notes: String(s.notes || ''),
    },
  };
}

export const strategyPlannerAgent: Agent = {
  role: 'strategy-planner',
  pipeline: 'outbound',
  description: '为每个客户制定个性化的开发策略和多步骤开发计划',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const leadIds = (input.leadIds as string[]) || [];

    if (context.leadId && !leadIds.includes(context.leadId)) {
      leadIds.push(context.leadId);
    }

    if (!leadIds.length) {
      return { success: false, error: '没有可规划策略的线索' };
    }

    try {
      const { data: leads, error } = await context.supabase
        .from('growth_leads')
        .select('*')
        .in('id', leadIds);

      if (error || !leads?.length) {
        return { success: false, error: error?.message || '未找到线索' };
      }

      const strategies: { leadId: string; strategy: StrategyResult['strategy'] }[] = [];

      for (const lead of leads) {
        const analysis = (lead.ai_analysis as Record<string, unknown>) || {};
        const leadData: LeadForStrategy = {
          company_name: lead.company_name,
          website: lead.website,
          product_match: lead.product_match,
          category: analysis.category as string,
          score: lead.score || 0,
          grade: lead.grade || 'C',
          company_type: analysis.company_type as string,
          scale: analysis.estimated_scale as string || analysis.scale_estimate as string,
          contact_name: lead.contact_name,
          contact_email: lead.contact_email,
          ai_analysis: analysis,
        };

        const result = await analyzeStructured(
          STRATEGY_PROMPT(leadData),
          'strategy_planning',
          validateStrategy,
          { leadId: lead.id }
        );

        // Store strategy in lead's ai_analysis
        await context.supabase
          .from('growth_leads')
          .update({
            status: 'outreach',
            ai_analysis: {
              ...analysis,
              outreach_strategy: result.strategy,
              strategy_created_at: new Date().toISOString(),
            },
          })
          .eq('id', lead.id);

        // Create outreach campaign
        const { data: campaign } = await context.supabase
          .from('outreach_campaigns')
          .insert({
            lead_id: lead.id,
            status: 'active',
            current_step: 0,
            total_steps: result.strategy.email_sequence.length,
            strategy: result.strategy,
            next_send_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        strategies.push({ leadId: lead.id, strategy: result.strategy });
      }

      return {
        success: true,
        data: {
          strategiesCreated: strategies.length,
          leadIds: strategies.map((s) => s.leadId),
          strategies: strategies.map((s) => ({
            leadId: s.leadId,
            approach: s.strategy.approach,
            conversionProbability: s.strategy.estimated_conversion_probability,
          })),
        },
        nextAgent: 'email-composer',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `策略规划失败: ${errorMsg}` };
    }
  },
};

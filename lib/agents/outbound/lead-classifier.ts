/**
 * Lead Classifier Agent — Categorizes leads into client pool segments.
 *
 * Flow: Receives raw leads → Analyzes fit & intent signals → Assigns category
 *       (hot/warm/cold/vip/nurture) → Updates client pool.
 */

import { Agent, AgentContext, AgentResult } from '../types';
import { COMPANY } from '@/lib/config/company';
import { analyzeStructured } from '@/lib/ai/ai-service';

const CLASSIFY_PROMPT = (leads: LeadForClassification[]) => `You are a B2B lead classification specialist for ${COMPANY.name}.

Classify each lead into the appropriate customer category:
- "hot": High match, strong buying signals, needs immediate follow-up
- "warm": Good match, moderate interest, needs nurturing
- "cold": Low interest or unclear fit, long-term cultivation
- "vip": High-value, large-scale buyer with significant potential
- "nurture": Good fit but not ready to buy, needs content education

Leads to classify:
${leads.map((l, i) => `${i + 1}. ${l.company_name} | Website: ${l.website || 'N/A'} | Products: ${l.product_match || 'N/A'} | Source: ${l.source} | Analysis: ${JSON.stringify(l.ai_analysis || {})}`).join('\n')}

Respond with JSON (no markdown):
{
  "classifications": [
    {
      "index": number (1-based),
      "category": "hot" | "warm" | "cold" | "vip" | "nurture",
      "confidence": number (0-100),
      "reasoning": string (1 sentence),
      "priority": number (1-10, higher = more urgent),
      "suggested_first_action": string (what to do first with this lead)
    }
  ]
}`;

interface LeadForClassification {
  id: string;
  company_name: string;
  website?: string;
  product_match?: string;
  source: string;
  ai_analysis?: Record<string, unknown>;
}

interface Classification {
  index: number;
  category: string;
  confidence: number;
  reasoning: string;
  priority: number;
  suggested_first_action: string;
}

function validateClassifications(data: unknown): { classifications: Classification[] } {
  if (!data || typeof data !== 'object') throw new Error('Invalid response');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.classifications)) throw new Error('Missing classifications');
  return {
    classifications: d.classifications.map((c: Record<string, unknown>) => ({
      index: Number(c.index),
      category: String(c.category || 'cold'),
      confidence: Number(c.confidence || 50),
      reasoning: String(c.reasoning || ''),
      priority: Number(c.priority || 5),
      suggested_first_action: String(c.suggested_first_action || ''),
    })),
  };
}

export const leadClassifierAgent: Agent = {
  role: 'lead-classifier',
  pipeline: 'outbound',
  description: '将线索分类到客户池的不同层级（热门/温暖/冷/VIP/培育）',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const leadIds = (input.leadIds as string[]) || [];

    // If a single lead, process it directly
    if (context.leadId) {
      leadIds.push(context.leadId);
    }

    if (!leadIds.length) {
      return { success: false, error: '没有可分类的线索' };
    }

    try {
      // Fetch leads from database
      const { data: leads, error } = await context.supabase
        .from('growth_leads')
        .select('id, company_name, website, product_match, source, ai_analysis')
        .in('id', leadIds);

      if (error || !leads?.length) {
        return { success: false, error: error?.message || '未找到线索' };
      }

      // Classify using AI
      const result = await analyzeStructured(
        CLASSIFY_PROMPT(leads as LeadForClassification[]),
        'lead_classification',
        validateClassifications
      );

      // Update each lead with classification
      const updated: { id: string; category: string }[] = [];
      for (const classification of result.classifications) {
        const lead = leads[classification.index - 1];
        if (!lead) continue;

        const existingAnalysis = (lead.ai_analysis as Record<string, unknown>) || {};
        await context.supabase
          .from('growth_leads')
          .update({
            ai_analysis: {
              ...existingAnalysis,
              category: classification.category,
              classification_confidence: classification.confidence,
              classification_reasoning: classification.reasoning,
              priority: classification.priority,
              suggested_first_action: classification.suggested_first_action,
              classified_at: new Date().toISOString(),
            },
          })
          .eq('id', lead.id);

        updated.push({ id: lead.id, category: classification.category });
      }

      return {
        success: true,
        data: {
          classified: updated.length,
          breakdown: {
            hot: updated.filter((u) => u.category === 'hot').length,
            warm: updated.filter((u) => u.category === 'warm').length,
            cold: updated.filter((u) => u.category === 'cold').length,
            vip: updated.filter((u) => u.category === 'vip').length,
            nurture: updated.filter((u) => u.category === 'nurture').length,
          },
          leadIds: updated.map((u) => u.id),
        },
        nextAgent: 'lead-analyzer',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `分类失败: ${errorMsg}` };
    }
  },
};

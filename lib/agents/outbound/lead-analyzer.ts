/**
 * Lead Analyzer Agent — Deep analysis of lead quality, fit, and opportunity.
 *
 * Flow: Receives classified leads → Enriches with website/social data
 *       → AI-powered scoring → Updates lead with comprehensive analysis.
 */

import { Agent, AgentContext, AgentResult } from '../types';
import { analyzeWebsite } from '@/lib/ai/website-analyzer';
import { enrichBatch } from '@/lib/growth/website-enricher';

export const leadAnalyzerAgent: Agent = {
  role: 'lead-analyzer',
  pipeline: 'outbound',
  description: '深度分析客户质量、匹配度和商业机会',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const leadIds = (input.leadIds as string[]) || [];

    if (context.leadId && !leadIds.includes(context.leadId)) {
      leadIds.push(context.leadId);
    }

    if (!leadIds.length) {
      return { success: false, error: '没有可分析的线索' };
    }

    try {
      const { data: leads, error } = await context.supabase
        .from('growth_leads')
        .select('*')
        .in('id', leadIds);

      if (error || !leads?.length) {
        return { success: false, error: error?.message || '未找到线索' };
      }

      const analyzed: { id: string; score: number; grade: string }[] = [];

      // Batch enrich websites
      const leadsWithWebsites = leads.filter((l: Record<string, unknown>) => l.website);
      let enrichedMap = new Map<string, Record<string, unknown>>();

      if (leadsWithWebsites.length > 0) {
        try {
          const enrichResult = await enrichBatch(
            leadsWithWebsites.map((l: Record<string, unknown>) => ({
              website: l.website as string,
              product_hint: l.product_match as string,
            }))
          );
          for (const r of enrichResult.results) {
            enrichedMap.set(r.url, r as unknown as Record<string, unknown>);
          }
        } catch {
          // Non-critical: website enrichment may fail
        }
      }

      for (const lead of leads) {
        const enriched = lead.website ? enrichedMap.get(lead.website as string) : null;
        const existingAnalysis = (lead.ai_analysis as Record<string, unknown>) || {};

        // Use AI analysis from enrichment or existing
        const aiAnalysis = enriched?.ai_analysis as Record<string, unknown> | null;
        const fitScore = Number(aiAnalysis?.product_fit_score || 0);
        const hasEmail = Boolean(lead.contact_email || enriched?.contact_email);
        const hasLinkedIn = Boolean(lead.contact_linkedin || enriched?.contact_linkedin);
        const isApparel = aiAnalysis?.is_apparel_company !== false;

        // Weighted scoring
        const score = Math.round(
          fitScore * 0.4 +
          (hasEmail ? 20 : 0) +
          (hasLinkedIn ? 10 : 0) +
          (isApparel ? 20 : 0) +
          (existingAnalysis.priority ? Number(existingAnalysis.priority) : 5)
        );

        const grade = score >= 80 ? 'S' : score >= 65 ? 'A' : score >= 50 ? 'B' : score >= 35 ? 'C' : 'D';

        // Update lead with enriched data
        const updates: Record<string, unknown> = {
          score,
          grade,
          status: grade === 'D' ? 'archived' : 'verified',
          ai_analysis: {
            ...existingAnalysis,
            ...(aiAnalysis || {}),
            composite_score: score,
            grade,
            analyzed_at: new Date().toISOString(),
          },
        };

        // Extract contact info if found during enrichment
        if (enriched?.contact_email && !lead.contact_email) {
          updates.contact_email = enriched.contact_email;
        }
        if (enriched?.instagram_handle && !lead.instagram_handle) {
          updates.instagram_handle = enriched.instagram_handle;
        }

        await context.supabase
          .from('growth_leads')
          .update(updates)
          .eq('id', lead.id);

        analyzed.push({ id: lead.id, score, grade });
      }

      // Filter out low-quality leads for next step
      const qualifiedIds = analyzed.filter((a) => a.grade !== 'D').map((a) => a.id);

      return {
        success: true,
        data: {
          analyzed: analyzed.length,
          qualified: qualifiedIds.length,
          disqualified: analyzed.length - qualifiedIds.length,
          breakdown: {
            S: analyzed.filter((a) => a.grade === 'S').length,
            A: analyzed.filter((a) => a.grade === 'A').length,
            B: analyzed.filter((a) => a.grade === 'B').length,
            C: analyzed.filter((a) => a.grade === 'C').length,
            D: analyzed.filter((a) => a.grade === 'D').length,
          },
          leadIds: qualifiedIds,
        },
        nextAgent: qualifiedIds.length > 0 ? 'strategy-planner' : undefined,
        shouldStop: qualifiedIds.length === 0,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `分析失败: ${errorMsg}` };
    }
  },
};

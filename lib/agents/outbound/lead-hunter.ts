/**
 * Lead Hunter Agent — Searches for potential clients across web & social media.
 *
 * Flow: Receives search criteria → Scrapes websites/social → Extracts company info
 *       → Returns raw leads for classification.
 *
 * Sources: Google Search, Instagram, LinkedIn, industry directories
 */

import { Agent, AgentContext, AgentResult, SearchCriteria } from '../types';
import { COMPANY } from '@/lib/config/company';
import { analyzeStructured } from '@/lib/ai/ai-service';
import { deduplicateBatch } from '@/lib/utils/dedup';
import { cleanBatch } from '@/lib/utils/data-cleaner';
import { EXCLUDE_KEYWORDS } from '@/lib/config/search-keywords';

const SEARCH_PROMPT = (criteria: SearchCriteria) => `You are a B2B lead researcher for ${COMPANY.name}, a ${COMPANY.description}.

Your task: Find potential B2B customers based on these criteria:
Keywords: ${criteria.keywords.join(', ')}
Target platforms: ${criteria.platforms.join(', ')}
Region: ${criteria.region || 'Global'}
Product categories: ${criteria.productCategories?.join(', ') || 'All apparel'}
Minimum company size: ${criteria.minCompanySize || 'Any'}

Generate a list of company profiles that would be ideal customers for us.
For each company, research and provide:
1. Company name
2. Website URL (must be real, verifiable)
3. Social media handles (Instagram, LinkedIn)
4. Estimated company type (brand/retailer/wholesaler)
5. Products they sell
6. Why they'd be a good fit

Respond with JSON (no markdown):
{
  "leads": [
    {
      "company_name": string,
      "website": string,
      "instagram": string | null,
      "linkedin": string | null,
      "company_type": "brand" | "retailer" | "wholesaler" | "other",
      "products": string[],
      "region": string,
      "fit_reason": string,
      "estimated_scale": "small" | "medium" | "large"
    }
  ]
}

Return 5-15 high-quality leads. Quality over quantity.`;

function validateSearchResults(data: unknown): { leads: RawSearchLead[] } {
  if (!data || typeof data !== 'object') throw new Error('Invalid response');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.leads)) throw new Error('Missing leads array');
  return {
    leads: d.leads.map((lead: Record<string, unknown>) => ({
      company_name: String(lead.company_name || ''),
      website: String(lead.website || ''),
      instagram: lead.instagram ? String(lead.instagram) : null,
      linkedin: lead.linkedin ? String(lead.linkedin) : null,
      company_type: String(lead.company_type || 'other'),
      products: Array.isArray(lead.products) ? lead.products.map(String) : [],
      region: String(lead.region || ''),
      fit_reason: String(lead.fit_reason || ''),
      estimated_scale: String(lead.estimated_scale || 'medium'),
    })),
  };
}

interface RawSearchLead {
  company_name: string;
  website: string;
  instagram: string | null;
  linkedin: string | null;
  company_type: string;
  products: string[];
  region: string;
  fit_reason: string;
  estimated_scale: string;
}

export const leadHunterAgent: Agent = {
  role: 'lead-hunter',
  pipeline: 'outbound',
  description: '在网站和社交媒体上搜索目标客户，建立客户池',

  async execute(context: AgentContext): Promise<AgentResult> {
    const criteria = context.previousResults as unknown as SearchCriteria;

    if (!criteria?.keywords?.length) {
      return { success: false, error: '缺少搜索关键词' };
    }

    try {
      // Use AI to generate high-quality lead suggestions
      const result = await analyzeStructured(
        SEARCH_PROMPT(criteria),
        'lead_hunting',
        validateSearchResults
      );

      if (!result.leads.length) {
        return { success: true, data: { leads: [], message: '未找到匹配的客户' }, shouldStop: true };
      }

      // ── Step 1: 数据清洗 — 过滤垃圾数据 ──
      const rawLeads = result.leads.map((l) => ({
        company_name: l.company_name,
        website: l.website,
        instagram_handle: l.instagram,
        contact_linkedin: l.linkedin,
        source: 'ai_search',
        product_match: l.products.join(', '),
        company_type: l.company_type,
        region: l.region,
        fit_reason: l.fit_reason,
        estimated_scale: l.estimated_scale,
      }));

      const { valid: cleanedLeads, rejected } = cleanBatch(rawLeads);

      // ── Step 2: 去重 — 多字段模糊匹配 ──
      const { unique: newLeads, duplicates } = await deduplicateBatch(
        context.supabase,
        cleanedLeads
      );

      // ── Step 3: 入库 — 只插入清洗+去重后的数据 ──
      const insertedLeads: string[] = [];
      for (const lead of newLeads) {
        const { data: inserted } = await context.supabase
          .from('growth_leads')
          .insert({
            company_name: lead.company_name,
            website: lead.website,
            instagram_handle: lead.instagram_handle,
            contact_linkedin: lead.contact_linkedin,
            contact_email: lead.contact_email,
            source: 'ai_search',
            status: 'new',
            product_match: lead.product_match,
            ai_analysis: {
              company_type: (lead as Record<string, unknown>).company_type,
              region: (lead as Record<string, unknown>).region,
              fit_reason: (lead as Record<string, unknown>).fit_reason,
              estimated_scale: (lead as Record<string, unknown>).estimated_scale,
              data_quality_score: (lead as Record<string, unknown>).dataQualityScore,
              cleaning_notes: (lead as Record<string, unknown>).cleaningNotes,
              hunted_at: new Date().toISOString(),
            },
          })
          .select('id')
          .single();

        if (inserted) {
          insertedLeads.push(inserted.id);
        }
      }

      return {
        success: true,
        data: {
          totalFound: result.leads.length,
          afterCleaning: cleanedLeads.length,
          rejectedByCleaning: rejected.length,
          afterDedup: newLeads.length,
          duplicatesSkipped: duplicates.length,
          newLeads: insertedLeads.length,
          leadIds: insertedLeads,
          rejectionReasons: rejected.map((r) => r.rejectionReason),
          duplicateMatches: duplicates.map((d) => ({
            company: d.lead.company_name,
            matchType: d.match.matchType,
            existingCompany: d.match.existingCompanyName,
          })),
        },
        nextAgent: 'lead-classifier',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `搜索失败: ${errorMsg}` };
    }
  },
};

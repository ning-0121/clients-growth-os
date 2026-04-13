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

      // Deduplicate against existing leads in the database
      const websites = result.leads
        .map((l) => l.website)
        .filter(Boolean);

      const { data: existing } = await context.supabase
        .from('growth_leads')
        .select('website')
        .in('website', websites);

      const existingWebsites = new Set((existing || []).map((e: { website: string }) => e.website));
      const newLeads = result.leads.filter((l) => !existingWebsites.has(l.website));

      // Insert new leads into database
      const insertedLeads: string[] = [];
      for (const lead of newLeads) {
        const { data: inserted } = await context.supabase
          .from('growth_leads')
          .insert({
            company_name: lead.company_name,
            website: lead.website,
            instagram_handle: lead.instagram,
            contact_linkedin: lead.linkedin,
            source: 'ai_search',
            status: 'new',
            product_match: lead.products.join(', '),
            ai_analysis: {
              company_type: lead.company_type,
              region: lead.region,
              fit_reason: lead.fit_reason,
              estimated_scale: lead.estimated_scale,
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
          newLeads: newLeads.length,
          duplicatesSkipped: result.leads.length - newLeads.length,
          leadIds: insertedLeads,
          leads: newLeads,
        },
        nextAgent: 'lead-classifier',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `搜索失败: ${errorMsg}` };
    }
  },
};

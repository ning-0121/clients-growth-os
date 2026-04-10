import { analyzeStructured } from './ai-service';
import { buildWebsiteAnalysisPrompt, WebsiteContent } from './prompts';
import { AIWebsiteAnalysis } from './types';

/**
 * Validate the AI response matches AIWebsiteAnalysis shape.
 * Applies sensible defaults for missing fields.
 */
function validateAnalysis(data: unknown): AIWebsiteAnalysis {
  if (!data || typeof data !== 'object') {
    throw new Error('Response is not an object');
  }

  const d = data as Record<string, any>;

  return {
    is_apparel_company: Boolean(d.is_apparel_company),
    confidence: clamp(Number(d.confidence) || 0, 0, 100),
    product_categories: Array.isArray(d.product_categories)
      ? d.product_categories.filter((c: any) => typeof c === 'string')
      : [],
    company_type: ['brand', 'retailer', 'manufacturer', 'wholesaler', 'other'].includes(d.company_type)
      ? d.company_type
      : 'other',
    scale_estimate: ['small', 'medium', 'large'].includes(d.scale_estimate)
      ? d.scale_estimate
      : 'medium',
    product_fit_score: clamp(Number(d.product_fit_score) || 0, 0, 100),
    outreach_recommendation: String(d.outreach_recommendation || ''),
    key_evidence: Array.isArray(d.key_evidence)
      ? d.key_evidence.filter((e: any) => typeof e === 'string').slice(0, 10)
      : [],
    analyzed_at: new Date().toISOString(),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Analyze a website using AI to determine if it's a good B2B customer fit.
 * Returns null if AI is unavailable (caller should fallback to keyword matching).
 */
export async function analyzeWebsite(
  content: WebsiteContent,
  leadId?: string
): Promise<AIWebsiteAnalysis | null> {
  // Skip if no meaningful content
  if (!content.bodyText || content.bodyText.trim().length < 50) {
    return null;
  }

  try {
    const prompt = buildWebsiteAnalysisPrompt(content);
    return await analyzeStructured<AIWebsiteAnalysis>(
      prompt,
      'website_analysis',
      validateAnalysis,
      { leadId }
    );
  } catch (err) {
    console.warn(`[AI] Website analysis failed for ${content.url}:`, err);
    return null;
  }
}

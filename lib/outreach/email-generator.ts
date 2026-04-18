import { analyzeStructured } from '@/lib/ai/ai-service';
import { buildColdEmailPrompt, ColdEmailContext, EmailType } from '@/lib/ai/prompts';

export interface GeneratedEmail {
  subject: string;
  body_text: string;
  body_html: string;
  angle_used?: string;
}

function validateEmail(data: unknown): GeneratedEmail {
  if (!data || typeof data !== 'object') throw new Error('Not an object');
  const d = data as Record<string, any>;
  if (!d.subject || !d.body_text) throw new Error('Missing subject or body_text');

  return {
    subject: String(d.subject).slice(0, 200),
    body_text: String(d.body_text),
    body_html: String(d.body_html || `<p>${String(d.body_text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`),
    angle_used: d.angle_used ? String(d.angle_used) : undefined,
  };
}

/**
 * Extract personalization hooks from ai_analysis.
 * These are specific, verifiable facts about the company that make the email feel researched.
 */
function extractPersonalizationHooks(lead: Record<string, any>): string[] {
  const hooks: string[] = [];
  const ai = lead.ai_analysis || {};

  // Product categories — mention specific products
  if (ai.product_categories?.length) {
    const cats = ai.product_categories.slice(0, 3).join(', ');
    hooks.push(`Sells ${cats}`);
  }

  // Company type signal
  if (ai.company_type === 'brand') hooks.push('Independent brand (not a retailer) — own label, need manufacturing partner');
  if (ai.company_type === 'retailer') hooks.push('Retailer sourcing directly from factories (likely private label)');

  // Scale signals
  if (ai.scale_estimate === 'small') hooks.push('Small/indie brand — likely values low MOQ and fast turnaround');
  if (ai.scale_estimate === 'medium') hooks.push('Established brand — likely wants quality consistency and reliable delivery');

  // Funding/news from research
  if (ai.founded) hooks.push(`Founded ${ai.founded}`);
  if (ai.employees) hooks.push(`~${ai.employees} employees`);
  if (ai.revenue) hooks.push(`Revenue ~${ai.revenue}`);

  // Key evidence from website scan
  if (ai.key_evidence?.length) {
    hooks.push(...ai.key_evidence.slice(0, 2));
  }

  // Customs data — shows they're already importing
  const customs = lead.customs_summary;
  if (customs?.import_count) {
    hooks.push(`Has made ${customs.import_count} apparel imports — active sourcing buyer`);
  }
  if (customs?.top_suppliers) {
    hooks.push(`Currently sources from: ${customs.top_suppliers.slice(0, 2).join(', ')}`);
  }

  return hooks.filter(Boolean).slice(0, 5);
}

/**
 * Get seasonal angle based on current month.
 * Apparel buying cycles: Fall/Winter orders placed in spring, Spring/Summer in fall.
 */
function getSeasonalAngle(): string {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 2 && month <= 4) return 'Spring buying season — Fall/Winter 2026 orders being placed now';
  if (month >= 5 && month <= 7) return 'Summer — good time to plan holiday/winter production';
  if (month >= 8 && month <= 10) return 'Fall buying season — Spring/Summer 2027 orders being planned';
  return 'Year-end — good time to lock in Q1 production capacity';
}

/**
 * Generate a personalized cold email using AI.
 * Uses lead's AI analysis, customs data, and personalization hooks.
 */
export async function generateColdEmail(
  lead: Record<string, any>,
  stepNumber: number,
  emailType: EmailType,
  previousSubjects: string[] = [],
  previousAngles: string[] = []
): Promise<GeneratedEmail | null> {
  const aiAnalysis = lead.ai_analysis || {};
  const hooks = extractPersonalizationHooks(lead);

  // ── Extract the pre-generated strategy if it exists ──
  // Strategy is saved by /api/ai/customer-strategy into ai_analysis.outreach_strategy
  const strategyBundle = aiAnalysis.outreach_strategy || null;
  const customerAnalysis = strategyBundle?.analysis || null;
  const devStrategy = strategyBundle?.strategy || null;

  const ctx: ColdEmailContext = {
    company_name: lead.company_name,
    contact_name: lead.contact_name || undefined,
    contact_role: aiAnalysis.contact_role || undefined,
    website: lead.website || undefined,
    product_categories: aiAnalysis.product_categories || [],
    company_type: aiAnalysis.company_type,
    scale_estimate: aiAnalysis.scale_estimate,
    outreach_recommendation: aiAnalysis.outreach_recommendation,
    customs_summary: lead.customs_summary || undefined,
    personalization_hooks: hooks.length > 0 ? hooks : undefined,
    seasonal_angle: getSeasonalAngle(),
    target_market: aiAnalysis.target_market || undefined,
    // ── Pre-generated strategy as the email backbone ──
    strategy_company_summary: customerAnalysis?.company_summary || undefined,
    strategy_approach: devStrategy?.approach || undefined,
    strategy_first_touch_angle: devStrategy?.first_touch_angle || undefined,
    strategy_talking_points: devStrategy?.key_talking_points || undefined,
    strategy_recommended_products: customerAnalysis?.recommended_products || undefined,
    strategy_buying_signals: customerAnalysis?.buying_signals || undefined,
    step_number: stepNumber,
    email_type: emailType,
    previous_subjects: previousSubjects,
    previous_angles: previousAngles,
  };

  try {
    const prompt = buildColdEmailPrompt(ctx);
    return await analyzeStructured<GeneratedEmail>(
      prompt,
      'cold_email_generation',
      validateEmail,
      { leadId: lead.id }
    );
  } catch (err) {
    console.error(`[Outreach] Failed to generate email for lead ${lead.id}:`, err);
    return null;
  }
}

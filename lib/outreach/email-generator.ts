import { analyzeStructured } from '@/lib/ai/ai-service';
import { buildColdEmailPrompt, ColdEmailContext, EmailType } from '@/lib/ai/prompts';

export interface GeneratedEmail {
  subject: string;
  body_text: string;
  body_html: string;
}

function validateEmail(data: unknown): GeneratedEmail {
  if (!data || typeof data !== 'object') throw new Error('Not an object');
  const d = data as Record<string, any>;

  if (!d.subject || !d.body_text) {
    throw new Error('Missing subject or body_text');
  }

  return {
    subject: String(d.subject).slice(0, 200),
    body_text: String(d.body_text),
    body_html: String(d.body_html || `<p>${String(d.body_text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`),
  };
}

/**
 * Generate a personalized cold email using AI.
 * Uses the lead's AI analysis and customs data for personalization.
 */
export async function generateColdEmail(
  lead: Record<string, any>,
  stepNumber: number,
  emailType: EmailType,
  previousSubjects: string[] = []
): Promise<GeneratedEmail | null> {
  const aiAnalysis = lead.ai_analysis || {};

  const ctx: ColdEmailContext = {
    company_name: lead.company_name,
    contact_name: lead.contact_name || undefined,
    website: lead.website || undefined,
    product_categories: aiAnalysis.product_categories || [],
    company_type: aiAnalysis.company_type,
    scale_estimate: aiAnalysis.scale_estimate,
    outreach_recommendation: aiAnalysis.outreach_recommendation,
    customs_summary: lead.customs_summary || undefined,
    step_number: stepNumber,
    email_type: emailType,
    previous_subjects: previousSubjects,
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

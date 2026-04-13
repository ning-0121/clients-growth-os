/**
 * Prompt templates for AI analysis.
 * Each returns a user-message string with explicit JSON schema instructions.
 */

import { COMPANY } from '@/lib/config/company';

export interface WebsiteContent {
  url: string;
  title: string;
  metaDescription: string;
  bodyText: string; // first ~5000 chars
  navItems: string[]; // navigation menu items
  headings: string[]; // H1/H2 headings
}

export function buildWebsiteAnalysisPrompt(content: WebsiteContent): string {
  const nav = content.navItems.length > 0 ? `Navigation: ${content.navItems.join(', ')}` : '';
  const headings = content.headings.length > 0 ? `Headings: ${content.headings.join(', ')}` : '';

  return `You are a B2B lead qualification analyst for ${COMPANY.name}, a ${COMPANY.description}.
We produce: ${COMPANY.products.join(', ')}.

Analyze this website and determine if this company would be a good B2B customer for us.

URL: ${content.url}
Title: ${content.title}
Meta Description: ${content.metaDescription}
${nav}
${headings}

Page Content (excerpt):
${content.bodyText.slice(0, 4000)}

Respond with a JSON object (no markdown, no code fences, just raw JSON):
{
  "is_apparel_company": boolean,
  "confidence": number (0-100, how confident you are in is_apparel_company),
  "product_categories": string[] (specific categories like "activewear", "streetwear", "t-shirts", "hoodies", etc.),
  "company_type": "brand" | "retailer" | "manufacturer" | "wholesaler" | "other",
  "scale_estimate": "small" | "medium" | "large" (based on website signals: small=indie/startup, medium=established, large=major retailer/chain),
  "product_fit_score": number (0-100, how well they match our manufacturing capabilities),
  "outreach_recommendation": string (1-2 sentences: how should our sales team approach this company),
  "key_evidence": string[] (3-5 key facts from the website that support your analysis)
}`;
}

export function buildCustomsMatchPrompt(
  leadInfo: { company_name: string; website?: string; product_match?: string },
  candidates: { importer_name: string; product_desc?: string; hs_code?: string }[]
): string {
  const candidateList = candidates
    .map((c, i) => `${i + 1}. "${c.importer_name}" (HS: ${c.hs_code || 'N/A'}, Product: ${c.product_desc || 'N/A'})`)
    .join('\n');

  return `You are matching a sales lead to customs/trade records. Determine which (if any) customs records belong to the same company.

Lead:
- Company: "${leadInfo.company_name}"
- Website: ${leadInfo.website || 'N/A'}
- Products: ${leadInfo.product_match || 'N/A'}

Customs record candidates:
${candidateList}

For each candidate, decide if it's the same company as the lead. Consider:
- Name variations (abbreviations, legal suffixes, translations)
- Product alignment
- Common sense (a tech company probably isn't the same as an apparel brand)

Respond with a JSON object (no markdown, no code fences):
{
  "matches": [
    { "index": number (1-based), "confidence": "high" | "medium" | "low", "reasoning": string }
  ]
}

Only include candidates you believe are matches. Empty array if none match.`;
}

export function buildCompositeScorePrompt(evidence: {
  company_name: string;
  website?: string;
  source: string;
  ai_analysis?: Record<string, any>;
  customs_summary?: Record<string, any>;
  verification_evidence?: Record<string, any>[];
  contact_email?: string;
  contact_linkedin?: string;
  contact_name?: string;
}): string {
  return `You are a B2B sales intelligence analyst for ${COMPANY.name}, a ${COMPANY.description}.
Evaluate this lead and give a final recommendation.

Company: ${evidence.company_name}
Website: ${evidence.website || 'N/A'}
Source: ${evidence.source}
Contact: ${evidence.contact_name || 'N/A'} | Email: ${evidence.contact_email || 'N/A'} | LinkedIn: ${evidence.contact_linkedin || 'N/A'}

AI Website Analysis: ${evidence.ai_analysis ? JSON.stringify(evidence.ai_analysis) : 'Not available'}

Customs Trade Data: ${evidence.customs_summary ? JSON.stringify(evidence.customs_summary) : 'Not available'}

Verification Results: ${evidence.verification_evidence ? JSON.stringify(evidence.verification_evidence) : 'Not available'}

Based on ALL available evidence, provide your assessment.

Respond with a JSON object (no markdown, no code fences):
{
  "score": number (0-100, overall lead quality),
  "recommendation": "pursue" | "skip" | "investigate",
  "reasoning": string (2-3 sentences explaining your score),
  "suggested_approach": string (1-2 sentences on best outreach strategy)
}`;
}

// ── Outreach Email Prompts ──

export type EmailType = 'intro' | 'follow_up' | 'value_add' | 'breakup';

export interface ColdEmailContext {
  company_name: string;
  contact_name?: string;
  website?: string;
  product_categories?: string[];
  company_type?: string;
  scale_estimate?: string;
  outreach_recommendation?: string;
  customs_summary?: Record<string, any>;
  step_number: number;
  email_type: EmailType;
  previous_subjects?: string[];
}

export function buildColdEmailPrompt(ctx: ColdEmailContext): string {
  const prevContext = ctx.previous_subjects?.length
    ? `\nPrevious emails sent (do NOT repeat these angles):\n${ctx.previous_subjects.map((s, i) => `  ${i + 1}. Subject: "${s}"`).join('\n')}`
    : '';

  const tradeInfo = ctx.customs_summary
    ? `\nTrade data: This company imports apparel (${JSON.stringify(ctx.customs_summary)}).`
    : '';

  const emailTypeInstructions: Record<EmailType, string> = {
    intro: `This is the FIRST cold email. Goal: introduce yourself briefly, mention something specific about THEIR business that shows you did research, and suggest a quick chat. Keep it casual and short.`,
    follow_up: `This is a follow-up (they haven't replied to the first email). Goal: provide a different angle — mention a specific capability, a recent project, or ask a question about their upcoming season. Do NOT repeat the first email. Do NOT say "following up on my last email".`,
    value_add: `This is a value-add email. Goal: share something genuinely useful — a trend insight, a production tip, or a relevant case study. Position yourself as knowledgeable, not salesy. Make them want to reply.`,
    breakup: `This is the final email in the sequence. Goal: be lighthearted, say you won't keep emailing, leave the door open. Keep it very short (2-3 sentences max). Something like "I'll stop bugging you — but if you ever need [X], I'm here."`,
  };

  return `You are ${COMPANY.salesPerson}, a sales representative at ${COMPANY.name}, a ${COMPANY.description}.

Write a cold outreach email to a potential B2B customer.

ABOUT THE RECIPIENT:
Company: ${ctx.company_name}
Contact: ${ctx.contact_name || 'Unknown'}
Website: ${ctx.website || 'N/A'}
Products they sell: ${ctx.product_categories?.join(', ') || 'apparel (specific categories unknown)'}
Company type: ${ctx.company_type || 'Unknown'}
Scale: ${ctx.scale_estimate || 'Unknown'}
${tradeInfo}
${prevContext}

EMAIL TYPE: ${ctx.email_type} (step ${ctx.step_number} of the sequence)
${emailTypeInstructions[ctx.email_type]}

STRICT RULES:
- Write like a REAL person, not a corporation. Use "Hey [Name]" or "Hi [Name]", never "Dear Sir/Madam"
- If contact name is unknown, skip the greeting name and start directly
- Under 150 words. Short paragraphs. No bullet point lists.
- Reference something SPECIFIC about their business (products, style, market position)
- Mention ONE relevant capability of ours (not a laundry list)
- No "I hope this email finds you well" or any corporate filler
- No emojis
- Sound like a 28-year-old who's been in the garment industry for 5 years
- Each email must have a COMPLETELY different angle from previous ones
- End with a low-commitment CTA (not "schedule a call", more like "worth a quick chat?" or "any interest?")

Respond with a JSON object (no markdown, no code fences):
{
  "subject": string (short, intriguing, under 50 chars, no caps lock),
  "body_text": string (the email body as plain text),
  "body_html": string (same content wrapped in simple HTML paragraphs)
}`;
}

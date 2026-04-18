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
  contact_role?: string;          // e.g. "Head of Sourcing", "Buying Director"
  website?: string;
  product_categories?: string[];
  company_type?: string;
  scale_estimate?: string;
  outreach_recommendation?: string;
  customs_summary?: Record<string, any>;
  // ── Deep personalization hooks (from pre-research) ──
  personalization_hooks?: string[];   // e.g. ["just launched a spring yoga line", "expanded to 12 stores"]
  company_news?: string;              // recent news/funding/expansion
  seasonal_angle?: string;            // e.g. "spring/summer season buying happening now"
  pain_point?: string;                // e.g. "sourcing manager left, production delays"
  target_market?: string;             // e.g. "US yoga studios and boutique fitness retailers"
  // ── Sequence context ──
  step_number: number;
  email_type: EmailType;
  previous_subjects?: string[];
  previous_angles?: string[];         // what hooks were already used
}

/**
 * Build a cold email prompt optimized for high reply rates.
 *
 * Based on GitHub research (kaymen99/sales-outreach-automation-langgraph + 2025 benchmarks):
 * - Deep personalization (referencing specifics) doubles reply rate: 9% → 18%
 * - Under 100 words for first email: 12% vs 2% for 200+ words
 * - Single CTA, casual tone, no corporate filler
 * - 55% of replies come from follow-ups — sequence matters
 */
export function buildColdEmailPrompt(ctx: ColdEmailContext): string {
  const prevContext = ctx.previous_subjects?.length
    ? `\nPrevious emails (MUST use different angles, do not repeat):\n${ctx.previous_subjects.map((s, i) => `  ${i + 1}. Subject: "${s}"${ctx.previous_angles?.[i] ? ` (angle: ${ctx.previous_angles[i]})` : ''}`).join('\n')}`
    : '';

  const tradeInfo = ctx.customs_summary
    ? `\nTrade data: ${JSON.stringify(ctx.customs_summary)} — they already import apparel, so they have sourcing infrastructure.`
    : '';

  // Build personalization block — the most important part
  const personalizationLines: string[] = [];
  if (ctx.personalization_hooks?.length) {
    personalizationLines.push(`Key observations about their business:`);
    ctx.personalization_hooks.forEach(h => personalizationLines.push(`  • ${h}`));
  }
  if (ctx.company_news) personalizationLines.push(`Recent news: ${ctx.company_news}`);
  if (ctx.seasonal_angle) personalizationLines.push(`Seasonal timing: ${ctx.seasonal_angle}`);
  if (ctx.pain_point) personalizationLines.push(`Potential pain point: ${ctx.pain_point}`);
  if (ctx.target_market) personalizationLines.push(`Their target market: ${ctx.target_market}`);
  const personalizationBlock = personalizationLines.length
    ? `\nPERSONALIZATION RESEARCH:\n${personalizationLines.join('\n')}`
    : '';

  const emailTypeInstructions: Record<EmailType, string> = {
    intro: `FIRST cold email. Goal: prove you actually looked at their business (not template spam), mention ONE specific observation about them, connect it to ONE thing we can offer. Maximum 80 words. Single question CTA.

  The #1 rule: NEVER write "I came across your company". Instead, start with the specific observation. Example opening: "Your spring yoga collection just launched — have you locked in production for the fall season yet?"`,

    follow_up: `Follow-up (no reply to first email). Take a COMPLETELY different angle. Do NOT mention the previous email at all. Act like this is a fresh cold email from a different angle (different product capability, different season, different pain point). Under 80 words.`,

    value_add: `Value-add email. Share one genuinely useful insight — a fabric trend, a production timing tip, a market observation specific to their category. DO NOT try to sell. Just be helpful. Make them think "this person knows their stuff." Under 100 words. End with a soft question.`,

    breakup: `Final email. Lighthearted and very short (2-3 sentences max). Signal that you won't email again. Leave the door open. Example: "Last one — I promise. If your sourcing needs ever change, you know where to find me." No CTA, just closure.`,
  };

  return `You are ${COMPANY.salesPerson}, sales at ${COMPANY.name} — ${COMPANY.description}.

Our actual capabilities (be specific, pick ONE relevant to this company):
- MOQ 300 pieces/style, 15-day sample turnaround
- Specialties: activewear (compression, moisture-wicking), streetwear, athleisure, OEM/ODM
- Fabric certifications: OEKO-TEX, GRS recycled, UPF50+ performance
- FOB Guangzhou, typical $8-22/pc depending on complexity
- Current clients include US fitness brands and European outdoor retailers
- We can match any reference sample within 3 revisions

RECIPIENT:
Company: ${ctx.company_name}
Contact: ${ctx.contact_name || '(name unknown)'}${ctx.contact_role ? ` — ${ctx.contact_role}` : ''}
Website: ${ctx.website || 'N/A'}
Products: ${ctx.product_categories?.join(', ') || 'apparel'}
Company type: ${ctx.company_type || 'unknown'}, Scale: ${ctx.scale_estimate || 'unknown'}
${tradeInfo}
${personalizationBlock}
${prevContext}

EMAIL TYPE: ${ctx.email_type.toUpperCase()} (step ${ctx.step_number})
${emailTypeInstructions[ctx.email_type]}

NON-NEGOTIABLE RULES:
1. Under 100 words for intro/follow-up, under 120 for value_add, under 40 for breakup
2. ONE specific observation about their business (not generic "I like your brand")
3. ONE capability match (not a list of 5 things we do)
4. ONE question CTA (not "let's hop on a call", more like "would samples make sense?")
5. No "I hope this finds you well", no "Dear Sir/Madam", no corporate language
6. No emojis
7. If no contact name: skip the salutation, start directly with the observation
8. If you have personalization hooks: USE THEM — the first line must reference something specific

Respond with a JSON object (no markdown, no code fences):
{
  "subject": string (under 45 chars, lowercase, curiosity-inducing — NOT "Introducing JOJO Fashion"),
  "body_text": string (plain text email body, no signatures — we add those separately),
  "body_html": string (same wrapped in simple HTML paragraphs, no styling),
  "angle_used": string (1-sentence description of the personalization angle used, for tracking)
}`;
}

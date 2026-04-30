import { createClient } from '@/lib/supabase/server';
import { analyzeStructured } from '@/lib/ai/ai-service';
import { buildCompositeScorePrompt } from '@/lib/ai/prompts';
import { VerificationCheck, AICompositeScore } from '@/lib/ai/types';

/**
 * Round 4: AI Composite Scoring
 * - Gather all evidence from previous rounds
 * - Call AI for final assessment
 * - Update lead's final score, grade, and recommendation
 */
export async function runRound4(
  lead: Record<string, any>,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ checks: VerificationCheck[] }> {
  const checks: VerificationCheck[] = [];

  // Build evidence from all available data
  const evidence = {
    company_name: lead.company_name,
    website: lead.website,
    source: lead.source,
    ai_analysis: lead.ai_analysis || undefined,
    customs_summary: lead.customs_summary || undefined,
    verification_evidence: Array.isArray(lead.verification_evidence) ? lead.verification_evidence : undefined,
    contact_email: lead.contact_email,
    contact_linkedin: lead.contact_linkedin,
    contact_name: lead.contact_name,
  };

  try {
    const prompt = buildCompositeScorePrompt(evidence);
    const composite = await analyzeStructured<AICompositeScore>(
      prompt,
      'composite_scoring',
      validateCompositeScore,
      { leadId: lead.id, maxTokens: 1024 }  // structured JSON output, <1024 sufficient
    );

    // Determine new grade based on AI composite score
    const newGrade = composite.score >= 70 ? 'A'
      : composite.score >= 55 ? 'B+'
      : composite.score >= 40 ? 'B'
      : 'C';

    // Update lead with AI scoring
    await supabase
      .from('growth_leads')
      .update({
        ai_composite_score: composite.score,
        ai_recommendation: composite.recommendation,
        ai_reasoning: composite.reasoning,
        final_score: composite.score,
        grade: newGrade,
      })
      .eq('id', lead.id);

    checks.push({
      name: 'ai_composite_score',
      result: composite.recommendation === 'pursue' ? 'pass'
        : composite.recommendation === 'investigate' ? 'warn'
        : 'fail',
      detail: `Score: ${composite.score}/100 | ${composite.recommendation} | ${composite.reasoning}`,
      data: {
        score: composite.score,
        recommendation: composite.recommendation,
        suggested_approach: composite.suggested_approach,
      },
    });
  } catch (err) {
    // AI unavailable — keep existing scores
    checks.push({
      name: 'ai_composite_score',
      result: 'skip',
      detail: 'AI composite scoring unavailable, keeping existing scores',
    });
  }

  return { checks };
}

function validateCompositeScore(data: unknown): AICompositeScore {
  if (!data || typeof data !== 'object') throw new Error('Not an object');
  const d = data as Record<string, any>;

  return {
    score: Math.max(0, Math.min(100, Number(d.score) || 0)),
    recommendation: ['pursue', 'skip', 'investigate'].includes(d.recommendation)
      ? d.recommendation
      : 'investigate',
    reasoning: String(d.reasoning || ''),
    suggested_approach: String(d.suggested_approach || ''),
    scored_at: new Date().toISOString(),
  };
}

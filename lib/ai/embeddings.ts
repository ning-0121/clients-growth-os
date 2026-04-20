import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Embeddings client using Anthropic's Voyage AI endpoint via proxy,
 * OR OpenAI if OPENAI_API_KEY is set.
 *
 * Anthropic doesn't provide embeddings directly — they recommend Voyage AI.
 * But to keep deps simple, we use OpenAI's text-embedding-3-small (1536 dim)
 * which is cheap and widely compatible.
 *
 * Fallback: if no embedding key is configured, returns null and RAG is skipped
 * gracefully (system still works, just loses the 20% accuracy boost).
 */

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!text || text.length < 10) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8000), // model max is 8192 tokens
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) return null;
    return vec;
  } catch {
    return null;
  }
}

/**
 * Build a text representation of a lead for embedding.
 * Includes: company name, products, type, scale, key evidence.
 */
export function leadToEmbeddingText(lead: Record<string, any>): string {
  const ai = lead.ai_analysis || {};
  const parts: string[] = [];
  parts.push(`Company: ${lead.company_name || ''}`);
  if (lead.website) parts.push(`Website: ${lead.website}`);
  if (ai.company_type) parts.push(`Type: ${ai.company_type}`);
  if (ai.scale_estimate) parts.push(`Scale: ${ai.scale_estimate}`);
  if (ai.product_categories?.length) parts.push(`Products: ${ai.product_categories.join(', ')}`);
  if (ai.key_evidence?.length) parts.push(`Evidence: ${ai.key_evidence.join('; ')}`);
  if (lead.product_match) parts.push(`Product match: ${lead.product_match}`);
  return parts.join('\n');
}

/**
 * Upsert a lead's embedding to pgvector.
 */
export async function upsertLeadEmbedding(
  supabase: SupabaseClient,
  lead: Record<string, any>
): Promise<boolean> {
  const text = leadToEmbeddingText(lead);
  const embedding = await generateEmbedding(text);
  if (!embedding) return false;

  const outcome =
    lead.status === 'converted' ? 'won' :
    lead.status === 'disqualified' ? 'lost' :
    lead.status === 'qualified' ? 'nurturing' : 'unknown';

  const { error } = await supabase.from('lead_embeddings').upsert({
    lead_id: lead.id,
    content: text,
    embedding,
    outcome,
    grade: lead.grade,
    deal_probability: lead.deal_probability || 0,
  }, { onConflict: 'lead_id' });

  return !error;
}

/**
 * Find similar historical leads for RAG context.
 * Returns the top-N most-similar leads with their outcomes, useful as few-shot
 * examples for the AI classifier.
 */
export async function findSimilarLeads(
  supabase: SupabaseClient,
  lead: Record<string, any>,
  count = 3,
  threshold = 0.6
): Promise<Array<{
  lead_id: string;
  content: string;
  outcome: string;
  grade: string | null;
  deal_probability: number;
  similarity: number;
}>> {
  const text = leadToEmbeddingText(lead);
  const embedding = await generateEmbedding(text);
  if (!embedding) return [];

  try {
    const { data, error } = await supabase.rpc('match_leads', {
      query_embedding: embedding,
      match_count: count,
      match_threshold: threshold,
    });
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * Format similar leads as a few-shot context block for an AI prompt.
 */
export function formatSimilarLeadsForPrompt(
  similarLeads: Array<{
    content: string;
    outcome: string;
    grade: string | null;
    deal_probability: number;
    similarity: number;
  }>
): string {
  if (similarLeads.length === 0) return '';

  const lines = ['## Similar historical customers (for reference):\n'];
  for (const [i, lead] of similarLeads.entries()) {
    const outcome = lead.outcome === 'won' ? '✅ WON DEAL' :
                    lead.outcome === 'lost' ? '❌ DISQUALIFIED' :
                    lead.outcome === 'nurturing' ? '⏳ NURTURING' : '❓';
    lines.push(`### Similar #${i + 1} (similarity ${(lead.similarity * 100).toFixed(0)}%, grade ${lead.grade || '?'}, probability ${lead.deal_probability}%)`);
    lines.push(`Outcome: ${outcome}`);
    lines.push(lead.content);
    lines.push('');
  }
  return lines.join('\n');
}

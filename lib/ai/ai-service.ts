import { getAnthropicClient, DEFAULT_MODEL } from './anthropic-client';
import { AIRequestOptions, AIUsageRecord } from './types';
import { createClient } from '@/lib/supabase/server';

// ── Rate Limiter (token bucket) ──

const RPM_LIMIT = parseInt(process.env.AI_RATE_LIMIT_RPM || '20', 10);

let tokenBucket = RPM_LIMIT;
let lastRefill = Date.now();
const waitQueue: (() => void)[] = [];

function refillBucket() {
  const now = Date.now();
  const elapsed = now - lastRefill;
  const tokensToAdd = Math.floor((elapsed / 60_000) * RPM_LIMIT);
  if (tokensToAdd > 0) {
    tokenBucket = Math.min(RPM_LIMIT, tokenBucket + tokensToAdd);
    lastRefill = now;
  }
}

async function acquireToken(): Promise<void> {
  refillBucket();
  if (tokenBucket > 0) {
    tokenBucket--;
    return;
  }
  // Wait for a token to become available
  return new Promise((resolve) => {
    waitQueue.push(() => {
      tokenBucket--;
      resolve();
    });
    // Check every 3 seconds
    const interval = setInterval(() => {
      refillBucket();
      if (tokenBucket > 0 && waitQueue.length > 0) {
        const next = waitQueue.shift();
        clearInterval(interval);
        next?.();
      }
    }, 3000);
  });
}

// ── LRU Cache ──

interface CacheEntry {
  response: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 500;

async function hashKey(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getCached(key: string, ttl: number): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    cache.delete(key);
    return null;
  }
  return entry.response;
}

function setCache(key: string, response: string) {
  // Evict oldest if at capacity
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { response, timestamp: Date.now() });
}

// ── Cost Tracking ──

// Sonnet pricing (per token)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4-5-20251001': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
};

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens = 0,
  cacheReadTokens = 0
): number {
  const pricing = PRICING[model] || PRICING['claude-sonnet-4-20250514'];
  // Anthropic pricing (2026):
  //   Cache writes cost 1.25x input rate
  //   Cache reads cost 0.10x input rate (90% discount)
  const cacheWriteRate = pricing.input * 1.25;
  const cacheReadRate = pricing.input * 0.1;
  return (
    inputTokens * pricing.input +
    outputTokens * pricing.output +
    cacheCreationTokens * cacheWriteRate +
    cacheReadTokens * cacheReadRate
  );
}

async function logUsage(record: AIUsageRecord) {
  try {
    const supabase = await createClient();
    await supabase.from('growth_ai_usage').insert({
      request_type: record.request_type,
      lead_id: record.lead_id || null,
      model: record.model,
      input_tokens: record.input_tokens,
      output_tokens: record.output_tokens,
      cost_usd: record.cost_usd,
    });
  } catch {
    // Non-critical: don't break the pipeline if logging fails
    console.warn('[AI] Failed to log usage record');
  }
}

// ── Core API ──

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Send a prompt to Claude and get a raw text response.
 * Handles rate limiting, caching, retries, and cost tracking.
 */
export async function analyzeWithAI(
  prompt: string,
  requestType: string,
  options?: AIRequestOptions & { leadId?: string }
): Promise<string> {
  const model = options?.model || DEFAULT_MODEL;
  const cacheTTL = options?.cacheTTL ?? DEFAULT_CACHE_TTL;
  const systemPrompt = options?.systemPrompt;
  const useCache = options?.useCache !== false;

  // ── Local LRU cache (response-level — dedupes identical prompts) ──
  const cacheKey = await hashKey(`${model}:${systemPrompt || ''}:${prompt}`);
  if (useCache) {
    const cached = getCached(cacheKey, cacheTTL);
    if (cached) return cached;
  }

  // Rate limit
  await acquireToken();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const client = getAnthropicClient();

      // ── Anthropic Prompt Caching (90% discount on cached tokens) ──
      // Structure: system prompt is marked cacheable; user prompt stays fresh.
      // Anthropic will cache the system block for 5 minutes.
      // Minimum 1024 tokens required for caching.
      const requestBody: any = {
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      };

      if (systemPrompt && systemPrompt.length > 500) {
        // Only cache system prompts that are substantial (worth caching)
        requestBody.system = [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }, // 5-minute cache
          },
        ];
      } else if (systemPrompt) {
        // Small system prompts — just send without cache header
        requestBody.system = systemPrompt;
      }

      const response = await client.messages.create(requestBody);

      const text =
        response.content[0].type === 'text' ? response.content[0].text : '';

      // Cache the response
      if (useCache) setCache(cacheKey, text);

      // Log usage — include cache tokens separately
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const cacheCreationTokens = (response.usage as any).cache_creation_input_tokens || 0;
      const cacheReadTokens = (response.usage as any).cache_read_input_tokens || 0;

      await logUsage({
        request_type: requestType,
        lead_id: options?.leadId,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: estimateCost(model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens),
      });

      return text;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode;
      if ((status === 429 || status === 529) && attempt < MAX_RETRIES - 1) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('AI request failed after retries');
}

/**
 * Send a prompt to Claude and parse the response as JSON of type T.
 * Retries once on parse failure with a correction prompt.
 */
export async function analyzeStructured<T>(
  prompt: string,
  requestType: string,
  validate: (data: unknown) => T,
  options?: AIRequestOptions & { leadId?: string }
): Promise<T> {
  const raw = await analyzeWithAI(prompt, requestType, options);

  // Try to extract JSON from the response (handle potential markdown fences)
  const jsonStr = extractJSON(raw);

  try {
    const parsed = JSON.parse(jsonStr);
    return validate(parsed);
  } catch (firstError) {
    // Retry once with a correction prompt
    const correctionPrompt = `Your previous response was not valid JSON. Please try again.

Original request:
${prompt}

Your previous response:
${raw}

Please respond with ONLY a valid JSON object, no markdown, no code fences, no explanation.`;

    const retryRaw = await analyzeWithAI(correctionPrompt, `${requestType}_retry`, options);
    const retryJson = extractJSON(retryRaw);

    try {
      const parsed = JSON.parse(retryJson);
      return validate(parsed);
    } catch {
      throw new Error(
        `AI response is not valid JSON after retry. Request type: ${requestType}. Raw: ${retryRaw.slice(0, 200)}`
      );
    }
  }
}

/**
 * Extract JSON from a string that might contain markdown code fences.
 */
function extractJSON(text: string): string {
  // Try to find JSON in code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find a JSON object directly
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];

  return text.trim();
}

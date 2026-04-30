import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to your .env.local file.');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// AI_MODEL env var lets you swap models per environment (e.g. haiku for dev, sonnet for prod).
// To upgrade the default: set AI_MODEL=claude-sonnet-4-5 (or newer) in Vercel env vars.
export const DEFAULT_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-20250514';

/**
 * Unified input validation library for API routes.
 *
 * Principles:
 * - Fail fast with clear error messages
 * - Normalize strings (trim, lowercase where appropriate)
 * - Protect against common injection/overflow attacks via length caps
 * - Never return raw user input in error messages (XSS safety)
 */

// ── Primitive validators ────────────────────────────────────────────────────

export function requireString(
  value: unknown,
  field: string,
  opts: { minLength?: number; maxLength?: number; trim?: boolean } = {}
): string {
  const { minLength = 1, maxLength = 10000, trim = true } = opts;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  const out = trim ? value.trim() : value;
  if (out.length < minLength) throw new ValidationError(`${field} too short`);
  if (out.length > maxLength) throw new ValidationError(`${field} exceeds max length ${maxLength}`);
  return out;
}

export function optionalString(
  value: unknown,
  field: string,
  opts: { maxLength?: number; trim?: boolean } = {}
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, field, { minLength: 0, ...opts });
}

export function requireUuid(value: unknown, field: string): string {
  const s = requireString(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new ValidationError(`${field} must be a valid UUID`);
  }
  return s;
}

export function requireEmail(value: unknown, field: string = 'email'): string {
  const s = requireString(value, field, { maxLength: 320 }).toLowerCase();
  // RFC 5322 simplified — catches most invalid emails
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(s)) {
    throw new ValidationError(`${field} is not a valid email`);
  }
  return s;
}

export function requireInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {}
): number {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = opts;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (!Number.isInteger(n)) throw new ValidationError(`${field} must be an integer`);
  if (n < min) throw new ValidationError(`${field} must be >= ${min}`);
  if (n > max) throw new ValidationError(`${field} must be <= ${max}`);
  return n;
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  const s = requireString(value, field);
  if (!allowed.includes(s as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return s as T;
}

// ── Domain-specific helpers ────────────────────────────────────────────────

/**
 * Returns true if email is a generic/role-based address (info@, sales@, etc.).
 * Such addresses should not be enrolled in cold outreach sequences.
 */
export function isGenericEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
  const GENERIC = new Set([
    'info', 'hello', 'hi', 'hey', 'contact', 'sales', 'support', 'help',
    'customerservice', 'service', 'care', 'team', 'admin', 'office',
    'noreply', 'noreply', 'donotreply',
    'mail', 'email', 'post', 'webmaster', 'feedback',
    'press', 'media', 'pr', 'marketing', 'orders', 'billing',
    'accounts', 'accounting', 'hr', 'jobs', 'careers', 'hiring',
    'legal', 'compliance', 'privacy', 'security',
    'shop', 'store', 'wholesale', 'buy', 'purchasing',
  ]);
  return GENERIC.has(local);
}

/**
 * Normalize a URL — strip tracking params, trailing slashes, protocol gotchas.
 */
export function normalizeUrl(input: unknown): string | undefined {
  if (!input || typeof input !== 'string') return undefined;
  let s = input.trim();
  if (!s) return undefined;
  if (!s.startsWith('http://') && !s.startsWith('https://')) s = 'https://' + s;
  try {
    const u = new URL(s);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ref', 'mc_cid', 'mc_eid'].forEach(p => u.searchParams.delete(p));
    const out = u.toString();
    return out.endsWith('/') && u.pathname === '/' ? out.slice(0, -1) : out;
  } catch {
    return undefined;
  }
}

// ── Error class ─────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Wrap an API handler so ValidationError becomes a proper 400 response.
 * Usage:
 *   export const POST = handleValidation(async (request) => { ... });
 */
export function handleValidation<T>(handler: (request: Request) => Promise<T>) {
  return async (request: Request): Promise<Response> => {
    try {
      const result = await handler(request);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: err.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      console.error('[API Error]', err);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  };
}

import crypto from 'crypto';

/**
 * Verify a Resend webhook signature.
 *
 * Resend uses Svix under the hood. Each webhook request carries:
 *   - svix-id: unique message ID
 *   - svix-timestamp: Unix timestamp (seconds)
 *   - svix-signature: base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`))
 *     Format: "v1,<base64sig>"   (may contain multiple space-separated versions)
 *
 * Security properties:
 *   - Rejects requests older than 5 minutes (replay protection)
 *   - Uses timingSafeEqual (prevents timing attacks)
 *   - Requires exact secret match
 *
 * Set RESEND_WEBHOOK_SECRET in env. Resend dashboard → Webhooks → "Signing Secret".
 */
export function verifyResendWebhook(
  rawBody: string,
  headers: { svixId?: string | null; svixTimestamp?: string | null; svixSignature?: string | null },
  secret: string
): { valid: boolean; reason?: string } {
  if (!secret) return { valid: false, reason: 'RESEND_WEBHOOK_SECRET not configured' };

  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: 'Missing svix-* headers' };
  }

  // Replay protection — reject timestamps older than 5 minutes or more than 5 min in the future
  const ts = Number(svixTimestamp);
  if (!ts || Number.isNaN(ts)) return { valid: false, reason: 'Invalid timestamp' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 5 * 60) {
    return { valid: false, reason: 'Timestamp outside allowed window' };
  }

  // Svix secret may have "whsec_" prefix — strip it if present
  const cleanSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(cleanSecret, 'base64');
  } catch {
    return { valid: false, reason: 'Secret is not valid base64' };
  }

  // Compute expected signature
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // svix-signature header may contain multiple signatures: "v1,abc v1,def"
  const sigs = svixSignature.split(' ').map(s => {
    const [version, value] = s.split(',');
    return { version, value };
  });

  for (const { version, value } of sigs) {
    if (version !== 'v1' || !value) continue;
    try {
      const got = Buffer.from(value, 'base64');
      const exp = Buffer.from(expected, 'base64');
      if (got.length === exp.length && crypto.timingSafeEqual(got, exp)) {
        return { valid: true };
      }
    } catch {
      // Continue to next signature
    }
  }

  return { valid: false, reason: 'Signature mismatch' };
}

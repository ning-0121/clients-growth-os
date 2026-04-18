import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { handleEmailEvent } from '@/lib/outreach/sequence-engine';
import { verifyResendWebhook } from '@/lib/webhooks/verify-resend';

/**
 * POST /api/outreach/webhook
 * Resend webhook endpoint: receives email delivery/open/bounce events.
 *
 * Security: Signature verified via Svix HMAC-SHA256.
 * Set RESEND_WEBHOOK_SECRET in .env (Resend Dashboard → Webhooks → Signing Secret).
 *
 * If RESEND_WEBHOOK_SECRET is not configured, the endpoint refuses all requests
 * to prevent event spoofing.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Resend Webhook] RESEND_WEBHOOK_SECRET not set — rejecting all webhooks');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }

  // Must read raw body text for signature verification
  const rawBody = await request.text();

  const verification = verifyResendWebhook(rawBody, {
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
    svixSignature: request.headers.get('svix-signature'),
  }, secret);

  if (!verification.valid) {
    console.warn('[Resend Webhook] Invalid signature:', verification.reason);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);

    if (!body.type || !body.data) {
      return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
    }

    const supabase = createServiceClient();
    await handleEmailEvent(body, supabase);

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[Resend Webhook] Error processing:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

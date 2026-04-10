import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { handleEmailEvent } from '@/lib/outreach/sequence-engine';

/**
 * POST /api/outreach/webhook
 * Resend webhook endpoint: receives email delivery/open/bounce events.
 * Configure in Resend Dashboard → Webhooks → add this URL.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Resend sends events as { type: "email.delivered", data: { email_id: "..." } }
    if (!body.type || !body.data) {
      return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
    }

    const supabase = createServiceClient();
    await handleEmailEvent(body, supabase);

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[Resend Webhook] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

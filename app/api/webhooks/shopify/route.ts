import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getOrCreateConversation, addMessage, escalateToHuman } from '@/lib/conversations/conversation-manager';
import { generateAIReply } from '@/lib/conversations/ai-responder';
import { sendEmail } from '@/lib/outreach/resend-client';

/**
 * POST /api/webhooks/shopify
 * Receives Shopify contact form submissions.
 * Generates an AI reply and sends it via email.
 *
 * Expected payload (Shopify webhook): contact form data
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate Shopify webhook (optional)
    const hmac = request.headers.get('x-shopify-hmac-sha256');
    // TODO: validate HMAC if SHOPIFY_WEBHOOK_SECRET is set

    // Extract contact info from Shopify form
    const customerEmail = body.email || body.contact?.email;
    const customerName = body.name || body.contact?.name || body.first_name;
    const messageBody = body.body || body.message || body.note || '';

    if (!customerEmail || !messageBody) {
      return NextResponse.json({ error: 'Missing email or message' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Get or create conversation
    const conversation = await getOrCreateConversation(supabase, 'shopify_form', customerEmail, {
      name: customerName,
      email: customerEmail,
    });

    // Store inbound message
    await addMessage(supabase, conversation.id, {
      direction: 'inbound',
      sender_type: 'customer',
      content: messageBody,
    });

    // Load lead context if linked
    let leadContext: Record<string, any> | undefined;
    if (conversation.lead_id) {
      const { data: lead } = await supabase
        .from('growth_leads')
        .select('company_name, product_match, source, ai_analysis')
        .eq('id', conversation.lead_id)
        .single();
      if (lead) leadContext = lead;
    }

    // Generate AI reply
    const aiReply = await generateAIReply(
      supabase,
      conversation.id,
      messageBody,
      'shopify_form',
      leadContext
    );

    // Send reply via email
    const emailResult = await sendEmail({
      to: customerEmail,
      subject: `Re: Your inquiry at Qimo Clothing`,
      html: `<p>Hi ${customerName || 'there'},</p><p>${aiReply.reply_text.replace(/\n/g, '</p><p>')}</p><p>Best,<br>Alex<br>Qimo Clothing<br>eomodm.com</p>`,
      text: `Hi ${customerName || 'there'},\n\n${aiReply.reply_text}\n\nBest,\nAlex\nQimo Clothing\neomodm.com`,
    });

    // Store outbound message
    await addMessage(supabase, conversation.id, {
      direction: 'outbound',
      sender_type: 'ai',
      content: aiReply.reply_text,
      ai_confidence: aiReply.confidence,
    });

    // Escalate if needed
    if (aiReply.should_escalate) {
      await escalateToHuman(supabase, conversation.id);
    }

    return NextResponse.json({ received: true, replied: true });
  } catch (err: any) {
    console.error('[Shopify Webhook] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

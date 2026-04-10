import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getOrCreateConversation, addMessage, escalateToHuman } from '@/lib/conversations/conversation-manager';
import { generateAIReply } from '@/lib/conversations/ai-responder';
import { sendWhatsAppMessage, markAsRead } from '@/lib/conversations/whatsapp-client';

/**
 * GET /api/webhooks/whatsapp — Meta webhook verification challenge.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * POST /api/webhooks/whatsapp — Receive incoming WhatsApp messages.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Extract message from Meta webhook payload
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages || value.messages.length === 0) {
      // Status update or other non-message event
      return NextResponse.json({ received: true });
    }

    const message = value.messages[0];
    const contact = value.contacts?.[0];

    // Only handle text messages for now
    if (message.type !== 'text') {
      return NextResponse.json({ received: true });
    }

    const fromPhone = message.from; // sender's phone number
    const messageText = message.text?.body || '';
    const messageId = message.id;
    const customerName = contact?.profile?.name || null;

    const supabase = createServiceClient();

    // Mark as read
    await markAsRead(messageId);

    // Get or create conversation
    const conversation = await getOrCreateConversation(supabase, 'whatsapp', fromPhone, {
      name: customerName,
      phone: fromPhone,
    });

    // Store inbound message
    await addMessage(supabase, conversation.id, {
      direction: 'inbound',
      sender_type: 'customer',
      content: messageText,
      whatsapp_message_id: messageId,
    });

    // Don't auto-reply if conversation is escalated (human handling)
    if (conversation.status === 'escalated') {
      return NextResponse.json({ received: true, escalated: true });
    }

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
      messageText,
      'whatsapp',
      leadContext
    );

    // Send reply via WhatsApp
    const sendResult = await sendWhatsAppMessage(fromPhone, aiReply.reply_text);

    // Store outbound message
    await addMessage(supabase, conversation.id, {
      direction: 'outbound',
      sender_type: 'ai',
      content: aiReply.reply_text,
      whatsapp_message_id: sendResult.messageId,
      ai_confidence: aiReply.confidence,
    });

    // Escalate if needed
    if (aiReply.should_escalate) {
      await escalateToHuman(supabase, conversation.id);
    }

    return NextResponse.json({ received: true, replied: true });
  } catch (err: any) {
    console.error('[WhatsApp Webhook] Error:', err);
    return NextResponse.json({ received: true }); // Always 200 to avoid Meta retries
  }
}

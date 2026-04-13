import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getOrCreateConversation, addMessage, escalateToHuman } from '@/lib/conversations/conversation-manager';
import { generateAIReply } from '@/lib/conversations/ai-responder';
import { sendEmail } from '@/lib/outreach/resend-client';
import { COMPANY } from '@/lib/config/company';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function verifyShopifyHmac(body: string, hmac: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return computed === hmac;
}

/**
 * POST /api/webhooks/shopify
 * Receives Shopify contact form submissions.
 * Generates an AI reply and sends it via email.
 */
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    // Validate Shopify HMAC signature
    const hmac = request.headers.get('x-shopify-hmac-sha256');
    const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (shopifySecret && hmac) {
      const valid = await verifyShopifyHmac(rawBody, hmac, shopifySecret);
      if (!valid) {
        return NextResponse.json({ error: '签名验证失败' }, { status: 401 });
      }
    }

    const body = JSON.parse(rawBody);

    // Extract and validate contact info
    const customerEmail = body.email || body.contact?.email;
    const customerName = body.name || body.contact?.name || body.first_name;
    const messageBody = body.body || body.message || body.note || '';

    if (!customerEmail || !messageBody) {
      return NextResponse.json({ error: '缺少邮箱或消息内容' }, { status: 400 });
    }

    if (!EMAIL_REGEX.test(customerEmail)) {
      return NextResponse.json({ error: '邮箱格式无效' }, { status: 400 });
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
      subject: `Re: Your inquiry at ${COMPANY.name}`,
      html: `<p>Hi ${customerName || 'there'},</p><p>${aiReply.reply_text.replace(/\n/g, '</p><p>')}</p><p>Best,<br>${COMPANY.salesPerson}<br>${COMPANY.name}<br>${COMPANY.domain}</p>`,
      text: `Hi ${customerName || 'there'},\n\n${aiReply.reply_text}\n\nBest,\n${COMPANY.salesPerson}\n${COMPANY.name}\n${COMPANY.domain}`,
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

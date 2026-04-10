import { analyzeStructured } from '@/lib/ai/ai-service';
import { SupabaseClient } from '@supabase/supabase-js';
import { getConversationHistory } from './conversation-manager';

export interface AIReply {
  reply_text: string;
  confidence: number;
  should_escalate: boolean;
  escalation_reason?: string;
}

const ESCALATION_KEYWORDS = [
  'price', 'pricing', 'quote', 'cost', 'discount', 'complaint', 'problem', 'issue',
  'human', 'real person', 'manager', 'supervisor', 'speak to someone',
  '价格', '报价', '投诉', '问题', '转人工', '找人',
];

function validateReply(data: unknown): AIReply {
  if (!data || typeof data !== 'object') throw new Error('Not an object');
  const d = data as Record<string, any>;

  return {
    reply_text: String(d.reply_text || ''),
    confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0.5)),
    should_escalate: Boolean(d.should_escalate),
    escalation_reason: d.escalation_reason ? String(d.escalation_reason) : undefined,
  };
}

/**
 * Generate an AI reply for an incoming message.
 * Returns reply text + confidence. Low confidence triggers escalation.
 */
export async function generateAIReply(
  supabase: SupabaseClient,
  conversationId: string,
  incomingMessage: string,
  channel: 'whatsapp' | 'shopify_form' | 'email',
  leadContext?: Record<string, any>
): Promise<AIReply> {
  // Check for escalation keywords first
  const lowerMsg = incomingMessage.toLowerCase();
  const hasEscalationKeyword = ESCALATION_KEYWORDS.some((k) => lowerMsg.includes(k));

  // Get conversation history
  const history = await getConversationHistory(supabase, conversationId, 10);

  const historyText = history
    .map((m) => `${m.sender_type === 'customer' ? 'Customer' : 'Alex (us)'}: ${m.content}`)
    .join('\n');

  const leadInfo = leadContext
    ? `\nKnown customer info: Company: ${leadContext.company_name || 'Unknown'}, Products: ${leadContext.product_match || 'Unknown'}, Source: ${leadContext.source || 'Unknown'}`
    : '';

  const prompt = `You are Alex from Qimo Clothing, responding to a ${channel === 'whatsapp' ? 'WhatsApp' : 'website inquiry'} message.

ABOUT US:
- Qimo Clothing: Chinese garment manufacturer specializing in activewear, sportswear, and custom apparel (ODM/OEM)
- Website: eomodm.com
- Capabilities: T-shirts, hoodies, jackets, pants, compression wear, yoga wear, cycling jerseys
- MOQ: 300-500 pieces per style per color (flexible for first orders)
- Lead time: 30-45 days for production, 25-35 days ocean shipping
- We handle: design support, fabric sourcing, sampling, production, QC, shipping
${leadInfo}

CONVERSATION HISTORY:
${historyText || '(new conversation)'}

NEW MESSAGE FROM CUSTOMER:
${incomingMessage}

RULES:
- Reply like a REAL person chatting, not a corporate bot
- Be warm, friendly, professional but casual
- Keep it SHORT — ${channel === 'whatsapp' ? '1-3 sentences max for WhatsApp' : '3-5 sentences for email'}
- If you know about their products (from lead context), reference them
- If they ask about price: give a general range ("depends on fabric and quantity, but usually $X-Y per piece for [category]"), then suggest discussing specifics
- If you're NOT SURE about something specific: say "let me check with our team and get back to you" and set should_escalate to true
- NEVER make up specific prices, delivery dates, or capabilities you're not sure about
- ${hasEscalationKeyword ? 'IMPORTANT: The customer message contains sensitive keywords. Consider escalating.' : ''}

Respond with JSON (no markdown, no code fences):
{
  "reply_text": string (the reply message),
  "confidence": number (0-1, how confident you are this reply is helpful and accurate),
  "should_escalate": boolean (true if a human should review/take over),
  "escalation_reason": string or null (why escalation is needed)
}`;

  try {
    const reply = await analyzeStructured<AIReply>(
      prompt,
      'conversation_reply',
      validateReply,
      { cacheTTL: 0 } // never cache conversation replies
    );

    // Force escalation on low confidence or keyword trigger
    if (reply.confidence < 0.7 || (hasEscalationKeyword && reply.confidence < 0.85)) {
      reply.should_escalate = true;
      reply.escalation_reason = reply.escalation_reason || '置信度低或触发关键词';
    }

    return reply;
  } catch (err) {
    // AI failed — always escalate
    return {
      reply_text: "Thanks for reaching out! Let me connect you with our team — someone will get back to you shortly.",
      confidence: 0,
      should_escalate: true,
      escalation_reason: 'AI generation failed',
    };
  }
}

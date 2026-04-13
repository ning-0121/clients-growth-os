/**
 * Auto-Responder Agent — Automatically replies to inbound inquiries.
 *
 * Flow: Receives inbound message (Shopify/WhatsApp/Email/Social)
 *       → Generates AI reply → Sends response → Triggers lead capture.
 *
 * Integrates with existing conversation manager for context-aware replies.
 */

import { Agent, AgentContext, AgentResult } from '../types';
import { generateAIReply } from '@/lib/conversations/ai-responder';
import { getOrCreateConversation, addMessage, escalateToHuman } from '@/lib/conversations/conversation-manager';

export const autoResponderAgent: Agent = {
  role: 'auto-responder',
  pipeline: 'inbound',
  description: '自动回复客户询盘，智能判断是否需要人工介入',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const channel = input.channel as 'whatsapp' | 'shopify_form' | 'email';
    const contactId = input.contactId as string;      // email or phone
    const contactName = input.contactName as string;
    const messageText = input.messageText as string;

    if (!channel || !contactId || !messageText) {
      return { success: false, error: '缺少渠道、联系人或消息内容' };
    }

    try {
      // Get or create conversation thread
      const conversation = await getOrCreateConversation(
        context.supabase,
        channel,
        contactId,
        { name: contactName, email: channel === 'email' ? contactId : undefined, phone: channel === 'whatsapp' ? contactId : undefined }
      );

      // Store inbound message
      await addMessage(context.supabase, conversation.id, {
        direction: 'inbound',
        sender_type: 'customer',
        content: messageText,
      });

      // Load lead context if conversation is linked to a lead
      let leadContext: Record<string, unknown> | undefined;
      if (conversation.lead_id) {
        const { data: lead } = await context.supabase
          .from('growth_leads')
          .select('company_name, product_match, source, ai_analysis')
          .eq('id', conversation.lead_id)
          .single();
        if (lead) leadContext = lead as Record<string, unknown>;
      }

      // Generate AI reply
      const aiReply = await generateAIReply(
        context.supabase,
        conversation.id,
        messageText,
        channel,
        leadContext
      );

      // Store outbound reply
      await addMessage(context.supabase, conversation.id, {
        direction: 'outbound',
        sender_type: 'ai',
        content: aiReply.reply_text,
        ai_confidence: aiReply.confidence,
      });

      // Escalate if AI is not confident
      if (aiReply.should_escalate) {
        await escalateToHuman(context.supabase, conversation.id);
      }

      return {
        success: true,
        data: {
          conversationId: conversation.id,
          leadId: conversation.lead_id,
          replyText: aiReply.reply_text,
          confidence: aiReply.confidence,
          escalated: aiReply.should_escalate,
          channel,
          contactId,
        },
        nextAgent: 'lead-capturer',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `自动回复失败: ${errorMsg}` };
    }
  },
};

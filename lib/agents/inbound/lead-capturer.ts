/**
 * Lead Capturer Agent — Captures inbound inquiries and routes them to the client pool.
 *
 * Flow: Receives conversation data → Extracts company info → Creates/links lead
 *       → Assigns to client pool → Triggers classification.
 */

import { Agent, AgentContext, AgentResult } from '../types';
import { COMPANY } from '@/lib/config/company';
import { analyzeStructured } from '@/lib/ai/ai-service';

const EXTRACT_PROMPT = (messages: string[], contactInfo: Record<string, string>) => `You are a lead extraction specialist for ${COMPANY.name}.

Extract business information from this inbound conversation.

Contact info:
- Name: ${contactInfo.name || 'Unknown'}
- Email: ${contactInfo.email || 'N/A'}
- Phone: ${contactInfo.phone || 'N/A'}
- Channel: ${contactInfo.channel}

Conversation messages:
${messages.map((m, i) => `${i + 1}. ${m}`).join('\n')}

Extract any business details mentioned in the conversation.

Respond with JSON (no markdown):
{
  "company_name": string | null,
  "products_mentioned": string[] (specific products they're looking for),
  "estimated_quantity": string | null (MOQ or order size mentioned),
  "urgency": "high" | "medium" | "low",
  "intent": "buying" | "inquiring" | "browsing" | "complaint",
  "key_requirements": string[] (specific requirements like material, certification, etc.),
  "notes": string (summary of what they need)
}`;

function validateExtraction(data: unknown): ExtractedLeadInfo {
  if (!data || typeof data !== 'object') throw new Error('Invalid');
  const d = data as Record<string, unknown>;
  return {
    company_name: d.company_name ? String(d.company_name) : null,
    products_mentioned: Array.isArray(d.products_mentioned) ? d.products_mentioned.map(String) : [],
    estimated_quantity: d.estimated_quantity ? String(d.estimated_quantity) : null,
    urgency: ['high', 'medium', 'low'].includes(String(d.urgency)) ? String(d.urgency) : 'medium',
    intent: ['buying', 'inquiring', 'browsing', 'complaint'].includes(String(d.intent)) ? String(d.intent) : 'inquiring',
    key_requirements: Array.isArray(d.key_requirements) ? d.key_requirements.map(String) : [],
    notes: String(d.notes || ''),
  };
}

interface ExtractedLeadInfo {
  company_name: string | null;
  products_mentioned: string[];
  estimated_quantity: string | null;
  urgency: string;
  intent: string;
  key_requirements: string[];
  notes: string;
}

export const leadCapturerAgent: Agent = {
  role: 'lead-capturer',
  pipeline: 'inbound',
  description: '捕获主动询盘的客户信息，导入客户池进行分类管理',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const conversationId = input.conversationId as string;
    const contactId = input.contactId as string;
    const channel = input.channel as string;
    let existingLeadId = input.leadId as string | undefined;

    if (!conversationId) {
      return { success: false, error: '缺少会话ID' };
    }

    try {
      // Fetch conversation messages for analysis
      const { data: messages } = await context.supabase
        .from('conversation_messages')
        .select('content, direction')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(20);

      const inboundMessages = (messages || [])
        .filter((m: { direction: string }) => m.direction === 'inbound')
        .map((m: { content: string }) => m.content);

      if (!inboundMessages.length) {
        return { success: true, data: { message: '无入站消息可分析' }, shouldStop: true };
      }

      // Fetch contact info from conversation
      const { data: conversation } = await context.supabase
        .from('conversations')
        .select('customer_email, customer_phone, customer_name, lead_id')
        .eq('id', conversationId)
        .single();

      existingLeadId = existingLeadId || conversation?.lead_id;

      const contactInfo = {
        name: conversation?.customer_name || '',
        email: conversation?.customer_email || '',
        phone: conversation?.customer_phone || '',
        channel,
      };

      // Extract business info using AI
      const extracted = await analyzeStructured(
        EXTRACT_PROMPT(inboundMessages, contactInfo),
        'lead_capture',
        validateExtraction
      );

      // Skip non-buying intents
      if (extracted.intent === 'complaint' || extracted.intent === 'browsing') {
        return {
          success: true,
          data: { intent: extracted.intent, message: '非购买意向，跳过' },
          shouldStop: true,
        };
      }

      let leadId = existingLeadId;

      if (!leadId) {
        // Try to find existing lead by email or phone
        if (contactInfo.email) {
          const { data: existing } = await context.supabase
            .from('growth_leads')
            .select('id')
            .eq('contact_email', contactInfo.email)
            .single();
          if (existing) leadId = existing.id;
        }
      }

      const leadData = {
        company_name: extracted.company_name || contactInfo.name || contactId,
        contact_name: contactInfo.name || null,
        contact_email: contactInfo.email || null,
        source: 'inbound',
        status: 'new',
        product_match: extracted.products_mentioned.join(', '),
        ai_analysis: {
          inbound_channel: channel,
          intent: extracted.intent,
          urgency: extracted.urgency,
          estimated_quantity: extracted.estimated_quantity,
          key_requirements: extracted.key_requirements,
          notes: extracted.notes,
          captured_at: new Date().toISOString(),
        },
      };

      if (leadId) {
        // Update existing lead with new info
        const { data: existingLead } = await context.supabase
          .from('growth_leads')
          .select('ai_analysis')
          .eq('id', leadId)
          .single();

        await context.supabase
          .from('growth_leads')
          .update({
            ...leadData,
            status: 'replied', // They initiated contact
            ai_analysis: {
              ...((existingLead?.ai_analysis as Record<string, unknown>) || {}),
              ...leadData.ai_analysis,
            },
          })
          .eq('id', leadId);
      } else {
        // Create new lead
        const { data: newLead } = await context.supabase
          .from('growth_leads')
          .insert(leadData)
          .select('id')
          .single();

        leadId = newLead?.id;

        // Link conversation to lead
        if (leadId) {
          await context.supabase
            .from('conversations')
            .update({ lead_id: leadId })
            .eq('id', conversationId);
        }
      }

      return {
        success: true,
        data: {
          leadId,
          isNew: !existingLeadId,
          extracted,
          leadIds: leadId ? [leadId] : [],
        },
        nextAgent: 'lead-classifier',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `线索捕获失败: ${errorMsg}` };
    }
  },
};

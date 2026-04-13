import { SupabaseClient } from '@supabase/supabase-js';

export interface ConversationInfo {
  id: string;
  channel: string;
  external_id: string;
  lead_id: string | null;
  customer_name: string | null;
  status: string;
}

/**
 * Find or create a conversation thread.
 */
export async function getOrCreateConversation(
  supabase: SupabaseClient,
  channel: 'whatsapp' | 'shopify_form' | 'email',
  externalId: string,
  customerInfo?: { name?: string; phone?: string; email?: string }
): Promise<ConversationInfo> {
  // Try to find existing active/escalated conversation
  const { data: existingRows } = await supabase
    .from('conversations')
    .select('id, channel, external_id, lead_id, customer_name, status')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .in('status', ['active', 'escalated'])
    .limit(1);

  if (existingRows && existingRows.length > 0) return existingRows[0];

  // Create new conversation
  const { data: created } = await supabase
    .from('conversations')
    .insert({
      channel,
      external_id: externalId,
      customer_name: customerInfo?.name || null,
      customer_phone: customerInfo?.phone || null,
      customer_email: customerInfo?.email || null,
    })
    .select('id, channel, external_id, lead_id, customer_name, status')
    .single();

  if (!created) throw new Error('Failed to create conversation');

  // Try to auto-link to a lead
  if (customerInfo?.email || customerInfo?.phone) {
    const matchField = customerInfo.email ? 'contact_email' : 'company_name';
    const matchValue = customerInfo.email || customerInfo.name || '';

    if (matchValue) {
      const { data: leads } = await supabase
        .from('growth_leads')
        .select('id')
        .ilike(matchField, `%${matchValue}%`)
        .limit(1);

      const lead = leads?.[0];
      if (lead) {
        await supabase
          .from('conversations')
          .update({ lead_id: lead.id })
          .eq('id', created.id);
        created.lead_id = lead.id;
      }
    }
  }

  return created;
}

/**
 * Add a message to a conversation.
 */
export async function addMessage(
  supabase: SupabaseClient,
  conversationId: string,
  message: {
    direction: 'inbound' | 'outbound';
    sender_type: 'customer' | 'ai' | 'human';
    content: string;
    whatsapp_message_id?: string;
    ai_confidence?: number;
  }
) {
  await supabase.from('conversation_messages').insert({
    conversation_id: conversationId,
    ...message,
  });

  // Update conversation timestamp
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}

/**
 * Get recent messages for AI context.
 */
export async function getConversationHistory(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 10
): Promise<{ direction: string; sender_type: string; content: string; created_at: string }[]> {
  const { data } = await supabase
    .from('conversation_messages')
    .select('direction, sender_type, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []).reverse(); // chronological order
}

/**
 * Escalate a conversation to a human.
 */
export async function escalateToHuman(
  supabase: SupabaseClient,
  conversationId: string,
  assignTo?: string
) {
  await supabase
    .from('conversations')
    .update({
      status: 'escalated',
      escalated_to: assignTo || null,
      escalated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
}

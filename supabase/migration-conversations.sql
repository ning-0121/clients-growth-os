-- ============================================================
-- Growth OS — Conversations Schema (WhatsApp + Shopify)
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  channel         text NOT NULL CHECK (channel IN ('whatsapp', 'shopify_form', 'email')),
  external_id     text NOT NULL,
  lead_id         uuid REFERENCES growth_leads(id),
  customer_name   text,
  customer_phone  text,
  customer_email  text,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'escalated', 'resolved', 'archived')),
  escalated_to    uuid REFERENCES profiles(user_id),
  escalated_at    timestamptz,
  ai_context      jsonb DEFAULT '{}',
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_channel_ext ON conversations(channel, external_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)
  WHERE status IN ('active', 'escalated');

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_select_auth" ON conversations;
CREATE POLICY "conv_select_auth" ON conversations
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "conv_insert_auth" ON conversations;
CREATE POLICY "conv_insert_auth" ON conversations
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "conv_update_auth" ON conversations;
CREATE POLICY "conv_update_auth" ON conversations
  FOR UPDATE USING (true);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction           text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_type         text NOT NULL CHECK (sender_type IN ('customer', 'ai', 'human')),
  content             text NOT NULL,
  media_url           text,
  whatsapp_message_id text,
  ai_confidence       numeric,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_messages ON conversation_messages(conversation_id, created_at DESC);

ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "msg_select_auth" ON conversation_messages;
CREATE POLICY "msg_select_auth" ON conversation_messages
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "msg_insert_any" ON conversation_messages;
CREATE POLICY "msg_insert_any" ON conversation_messages
  FOR INSERT WITH CHECK (true);

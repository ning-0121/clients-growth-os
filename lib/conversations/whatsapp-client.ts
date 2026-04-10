/**
 * Meta Cloud API (WhatsApp Business) client.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const GRAPH_API = 'https://graph.facebook.com/v18.0';

function getConfig() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.');
  }

  return { phoneNumberId, accessToken };
}

/**
 * Send a text message via WhatsApp.
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { phoneNumberId, accessToken } = getConfig();

  try {
    const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error?.message || 'WhatsApp API error' };
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Mark a message as read.
 */
export async function markAsRead(messageId: string): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  try {
    await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch {
    // Non-critical
  }
}

/**
 * Validate WhatsApp webhook signature.
 */
export function validateWebhookSignature(
  payload: string,
  signature: string
): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return false;

  try {
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');
    return `sha256=${expected}` === signature;
  } catch {
    return false;
  }
}

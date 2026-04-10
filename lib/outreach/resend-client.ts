import { Resend } from 'resend';

let client: Resend | null = null;

export function getResendClient(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set. Sign up at https://resend.com and add the key to .env.local.');
    }
    client = new Resend(apiKey);
  }
  return client;
}

export interface SendEmailParams {
  to: string;
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

/**
 * Send a single email via Resend.
 * Returns the Resend message ID on success.
 */
export async function sendEmail(params: SendEmailParams): Promise<{ id: string } | { error: string }> {
  const resend = getResendClient();
  const from = params.from || 'Alex <sales@qimoclothing.com>';

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      replyTo: params.replyTo || 'alex@qimoclothing.com',
    });

    if (error) {
      return { error: error.message };
    }

    return { id: data?.id || '' };
  } catch (err: any) {
    return { error: err.message || 'Failed to send email' };
  }
}

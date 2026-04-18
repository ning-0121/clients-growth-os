import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/outreach/resend-client';
import { COMPANY } from '@/lib/config/company';

/**
 * POST /api/test/send-email
 * Test endpoint to verify email sending works.
 * Sends a test email to the specified address.
 *
 * Body: { to: "your@email.com" }
 * Auth: CRON_SECRET
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Require explicit recipient — no hardcoded default
  let to: string | undefined;
  try {
    const body = await request.json();
    to = body.to;
  } catch {}

  if (!to || !to.includes('@')) {
    return NextResponse.json({
      error: 'Missing recipient. POST body must include { "to": "test@example.com" }',
    }, { status: 400 });
  }

  const result = await sendEmail({
    to,
    subject: `[Growth OS Test] Email System Working ✓`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">Growth OS Email Test</h2>
        <p>This is a test email from Growth OS.</p>
        <ul>
          <li><strong>From:</strong> ${COMPANY.salesPerson} &lt;${COMPANY.sendingEmail}&gt;</li>
          <li><strong>Reply-To:</strong> ${COMPANY.replyToEmail}</li>
          <li><strong>Sent via:</strong> Resend API</li>
          <li><strong>Time:</strong> ${new Date().toISOString()}</li>
        </ul>
        <p>If you received this email (not in spam), the email system is working correctly.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">
          ${COMPANY.name} | ${COMPANY.domain}
        </p>
      </div>
    `,
    text: `Growth OS Email Test\n\nThis is a test email from Growth OS.\nFrom: ${COMPANY.sendingEmail}\nReply-To: ${COMPANY.replyToEmail}\nTime: ${new Date().toISOString()}\n\nIf you received this, the email system is working.`,
  });

  if ('error' in result) {
    return NextResponse.json({
      success: false,
      error: result.error,
      config: {
        sending_email: COMPANY.sendingEmail,
        reply_to: COMPANY.replyToEmail,
        resend_key_set: !!process.env.RESEND_API_KEY,
      },
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message_id: result.id,
    sent_to: to,
    from: `${COMPANY.salesPerson} <${COMPANY.sendingEmail}>`,
    reply_to: COMPANY.replyToEmail,
  });
}

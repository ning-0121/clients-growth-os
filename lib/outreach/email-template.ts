/**
 * Professional HTML email template for cold outreach.
 *
 * Designed for maximum deliverability and readability:
 * - Inline CSS only (Gmail/Outlook strip <style> blocks)
 * - Simple layout — no images, no heavy graphics (triggers spam filters)
 * - Plain-looking but professional (looks like a real person wrote it)
 * - Dark mode compatible via color choices
 * - Mobile-responsive via percentage widths
 */

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Convert a plain-text email body into clean, email-safe HTML.
 *
 * Rules:
 * - Blank lines → paragraph breaks
 * - Single newlines within a paragraph → preserved as <br>
 * - Lines that start with "–" or "-" → styled as subtle dividers
 * - Sign-off (last block, usually 3-4 lines starting with a name) → styled signature
 */
function textToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const htmlParts: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (!para) continue;

    // Detect signature block (last para, short lines, no question mark)
    const isSignature = i === paragraphs.length - 1 && para.split('\n').length <= 5 && !para.includes('?');

    if (isSignature) {
      const sigLines = para.split('\n').map(l => l.trim());
      const sigHtml = sigLines
        .map((line, idx) => {
          if (idx === 0) {
            // Name line
            return `<div style="font-weight:600;color:#1a1a1a;margin-bottom:2px;">${escHtml(line)}</div>`;
          }
          return `<div style="color:#666;font-size:13px;line-height:1.5;">${escHtml(line)}</div>`;
        })
        .join('');
      htmlParts.push(`
        <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e8e8e8;">
          ${sigHtml}
        </div>`);
      continue;
    }

    // Regular paragraph — convert single newlines to <br>
    const lineHtml = para.split('\n')
      .map(line => escHtml(line.trim()))
      .join('<br>');
    htmlParts.push(`<p style="margin:0 0 16px 0;line-height:1.65;">${lineHtml}</p>`);
  }

  return htmlParts.join('\n');
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface EmailTemplateOptions {
  subject: string;
  bodyText: string;       // Plain text from AI (source of truth)
  companyName?: string;   // Sender company (optional, shown in footer)
  unsubscribeUrl?: string;
}

/**
 * Render a full HTML email. Returns the complete <html>…</html> document.
 */
export function renderEmailHtml(opts: EmailTemplateOptions): string {
  const { bodyText, companyName, unsubscribeUrl } = opts;
  const bodyHtml = textToHtml(bodyText);

  const footerLines: string[] = [];
  if (companyName) {
    footerLines.push(`Sent by ${escHtml(companyName)}`);
  }
  if (unsubscribeUrl) {
    footerLines.push(`<a href="${escHtml(unsubscribeUrl)}" style="color:#999;text-decoration:underline;">Unsubscribe</a>`);
  }
  const footerHtml = footerLines.length > 0
    ? `<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e8e8e8;font-size:12px;color:#aaa;text-align:center;">
        ${footerLines.join(' · ')}
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:${FONT_STACK};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f5f5f5;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:580px;">
          <tr>
            <td style="background-color:#ffffff;border-radius:8px;padding:40px 44px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
              <!-- Email body -->
              <div style="font-family:${FONT_STACK};font-size:15px;color:#1a1a1a;line-height:1.65;">
                ${bodyHtml}
              </div>
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

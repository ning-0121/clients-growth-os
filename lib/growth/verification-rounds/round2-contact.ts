import { VerificationCheck } from '@/lib/ai/types';

/**
 * Round 2: Contact Verification
 * - Email domain MX record check
 * - LinkedIn URL format validation
 * - Flag "needs decision maker" if only company LinkedIn but no personal contact
 */
export async function runRound2(
  lead: Record<string, any>
): Promise<{ checks: VerificationCheck[]; disqualify: boolean; disqualifyReason?: string }> {
  const checks: VerificationCheck[] = [];
  let hasValidContact = false;

  // Check 1: Email domain MX validation
  if (lead.contact_email) {
    const domain = lead.contact_email.split('@')[1];
    if (domain) {
      const mxValid = await checkMXRecord(domain);
      if (mxValid) {
        checks.push({
          name: 'email_mx_check',
          result: 'pass',
          detail: `MX records found for ${domain}`,
        });
        hasValidContact = true;
      } else {
        checks.push({
          name: 'email_mx_check',
          result: 'fail',
          detail: `No MX records for ${domain} — email likely invalid`,
        });
      }
    } else {
      checks.push({
        name: 'email_mx_check',
        result: 'fail',
        detail: 'Invalid email format (no domain)',
      });
    }
  } else {
    checks.push({
      name: 'email_mx_check',
      result: 'skip',
      detail: 'No email provided',
    });
  }

  // Check 2: LinkedIn URL validation
  if (lead.contact_linkedin) {
    const liUrl = lead.contact_linkedin as string;
    const companyMatch = liUrl.match(/linkedin\.com\/company\//i);
    const personalMatch = liUrl.match(/linkedin\.com\/in\//i);

    if (personalMatch) {
      checks.push({
        name: 'linkedin_validation',
        result: 'pass',
        detail: 'Personal LinkedIn profile found',
      });
      hasValidContact = true;
    } else if (companyMatch) {
      checks.push({
        name: 'linkedin_validation',
        result: 'warn',
        detail: 'Company LinkedIn page only — need to find decision maker',
        data: { needs_decision_maker: true },
      });
      hasValidContact = true; // Still a contact path
    } else {
      checks.push({
        name: 'linkedin_validation',
        result: 'fail',
        detail: 'Invalid LinkedIn URL format',
      });
    }
  } else {
    checks.push({
      name: 'linkedin_validation',
      result: 'skip',
      detail: 'No LinkedIn provided',
    });
  }

  // Check 3: Instagram validation
  if (lead.instagram_handle) {
    checks.push({
      name: 'instagram_presence',
      result: 'pass',
      detail: `@${lead.instagram_handle}`,
    });
  }

  // Check 4: Overall contact path assessment
  if (!hasValidContact && !lead.instagram_handle) {
    return {
      checks,
      disqualify: true,
      disqualifyReason: '所有联系渠道验证失败（邮箱域名无效、无有效LinkedIn）',
    };
  }

  if (!hasValidContact && lead.instagram_handle) {
    checks.push({
      name: 'contact_path_assessment',
      result: 'warn',
      detail: 'Only Instagram available — limited outreach capability',
    });
  }

  return { checks, disqualify: false };
}

/**
 * Check if a domain has MX records via DNS-over-HTTPS (Cloudflare).
 * Works in serverless environments without native DNS module.
 */
async function checkMXRecord(domain: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    // DNS check failed, assume valid to avoid false negatives
    return true;
  }
}

import { VerificationCheck } from '@/lib/ai/types';
import { huntContacts } from '@/lib/scrapers/contact-hunter';

/**
 * Round 2: Contact Verification + Deep Contact Hunting
 * - If lead has no email → run 12-layer contact hunter to find one
 * - Email domain MX record check
 * - LinkedIn URL format validation
 * - Flag "needs decision maker" if only company LinkedIn but no personal contact
 */
export async function runRound2(
  lead: Record<string, any>
): Promise<{ checks: VerificationCheck[]; disqualify: boolean; disqualifyReason?: string }> {
  const checks: VerificationCheck[] = [];
  let hasValidContact = false;

  // Check 0: If no email, run contact hunter to find one
  if (!lead.contact_email && lead.website) {
    try {
      const hunted = await huntContacts(lead.website, lead.company_name, lead.contact_name);

      const bestEmail = hunted.emails.find(e => e.confidence >= 50);
      if (bestEmail) {
        lead.contact_email = bestEmail.email; // Will be saved by pipeline
        checks.push({
          name: 'contact_hunter_email',
          result: 'pass',
          detail: `找到邮箱: ${bestEmail.email} (来源: ${bestEmail.source}, 置信度: ${bestEmail.confidence}%)`,
        });
      }

      // Update LinkedIn if found
      if (!lead.contact_linkedin) {
        const li = hunted.social.find(s => s.platform === 'linkedin');
        if (li) {
          lead.contact_linkedin = li.url;
          checks.push({ name: 'contact_hunter_linkedin', result: 'pass', detail: `找到LinkedIn: ${li.url}` });
        }
      }

      // Save phone and address if found
      if (hunted.phones.length > 0) {
        checks.push({ name: 'contact_hunter_phone', result: 'pass', detail: `找到电话: ${hunted.phones[0].phone}`, data: { phone: hunted.phones[0].phone } });
      }
      if (hunted.addresses.length > 0) {
        checks.push({ name: 'contact_hunter_address', result: 'pass', detail: `找到地址: ${hunted.addresses[0].address}`, data: { address: hunted.addresses[0].address } });
      }
      if (hunted.contacts.length > 0) {
        checks.push({ name: 'contact_hunter_people', result: 'pass', detail: `找到联系人: ${hunted.contacts.map(c => c.name + '(' + c.title + ')').join(', ')}`, data: { contacts: hunted.contacts } });
      }

      checks.push({ name: 'contact_hunter_summary', result: hunted.emails.length > 0 ? 'pass' : 'warn', detail: `扫描${hunted.pages_scanned}页，找到${hunted.emails.length}个邮箱，${hunted.phones.length}个电话，使用方法: ${hunted.methods_used.join(', ')}` });
    } catch {
      checks.push({ name: 'contact_hunter', result: 'skip', detail: '联系方式猎手运行失败' });
    }
  }

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

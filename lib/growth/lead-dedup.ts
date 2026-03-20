import { normalizeCompanyName, extractDomain } from './lead-engine';
import { RawLeadInput } from '@/lib/types';

interface ExistingLead {
  id: string;
  company_name: string;
  website: string | null;
  instagram_handle: string | null;
}

/**
 * Build a dedup index from existing leads for fast lookup.
 */
export function buildDedupIndex(existingLeads: ExistingLead[]) {
  const byName = new Set<string>();
  const byDomain = new Set<string>();
  const byInstagram = new Set<string>();

  for (const lead of existingLeads) {
    byName.add(normalizeCompanyName(lead.company_name));
    if (lead.website) {
      byDomain.add(extractDomain(lead.website));
    }
    if (lead.instagram_handle) {
      byInstagram.add(lead.instagram_handle.toLowerCase().trim());
    }
  }

  return { byName, byDomain, byInstagram };
}

/**
 * Check if a raw lead is a duplicate against the index.
 * Returns the match reason or null if not a duplicate.
 */
export function isDuplicate(
  lead: RawLeadInput,
  index: ReturnType<typeof buildDedupIndex>
): string | null {
  // 1. Normalized company name
  const normalized = normalizeCompanyName(lead.company_name);
  if (index.byName.has(normalized)) {
    return `公司名重复: ${lead.company_name}`;
  }

  // 2. Website domain
  if (lead.website) {
    const domain = extractDomain(lead.website);
    if (domain && index.byDomain.has(domain)) {
      return `网站域名重复: ${domain}`;
    }
  }

  // 3. Instagram handle
  if (lead.instagram_handle) {
    const handle = lead.instagram_handle.toLowerCase().trim();
    if (handle && index.byInstagram.has(handle)) {
      return `Instagram重复: ${handle}`;
    }
  }

  return null;
}

/**
 * Register a lead into the dedup index (call after successful insert).
 */
export function registerInIndex(
  lead: RawLeadInput,
  index: ReturnType<typeof buildDedupIndex>
) {
  index.byName.add(normalizeCompanyName(lead.company_name));
  if (lead.website) {
    index.byDomain.add(extractDomain(lead.website));
  }
  if (lead.instagram_handle) {
    index.byInstagram.add(lead.instagram_handle.toLowerCase().trim());
  }
}

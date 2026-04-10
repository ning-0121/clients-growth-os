import { RawLeadInput, LeadSource } from '@/lib/types';

/**
 * PhantomBuster Instagram Scraper output format.
 */
interface PBInstagramProfile {
  profileUrl?: string;
  fullName?: string;
  biography?: string;
  website?: string;
  email?: string;
  username?: string;
  followersCount?: number;
}

/**
 * PhantomBuster LinkedIn Scraper output format.
 */
interface PBLinkedInProfile {
  profileUrl?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  companyUrl?: string;
  title?: string;
  email?: string;
  website?: string;
}

/**
 * Transform PhantomBuster Instagram scrape results into RawLeadInput[].
 */
export function transformInstagramResults(results: PBInstagramProfile[]): RawLeadInput[] {
  const leads: RawLeadInput[] = [];

  for (const r of results) {
    // Skip profiles without usable data
    if (!r.fullName && !r.username) continue;

    // Try to extract company name from full name or username
    const companyName = r.fullName || r.username || 'Unknown';

    leads.push({
      company_name: companyName,
      contact_name: r.fullName || undefined,
      source: 'ig' as LeadSource,
      website: r.website || undefined,
      contact_email: r.email || undefined,
      instagram_handle: r.username || extractIGHandle(r.profileUrl),
      product_match: extractProductHint(r.biography),
    });
  }

  return leads;
}

/**
 * Transform PhantomBuster LinkedIn scrape results into RawLeadInput[].
 */
export function transformLinkedInResults(results: PBLinkedInProfile[]): RawLeadInput[] {
  const leads: RawLeadInput[] = [];

  for (const r of results) {
    if (!r.company && !r.firstName) continue;

    const companyName = r.company || `${r.firstName || ''} ${r.lastName || ''}`.trim();
    const contactName = `${r.firstName || ''} ${r.lastName || ''}`.trim() || undefined;

    leads.push({
      company_name: companyName,
      contact_name: contactName,
      source: 'linkedin' as LeadSource,
      website: r.website || r.companyUrl || undefined,
      contact_email: r.email || undefined,
      contact_linkedin: r.profileUrl || undefined,
    });
  }

  return leads;
}

/**
 * Auto-detect PhantomBuster output format and transform accordingly.
 */
export function transformPhantomBusterOutput(
  data: any[],
  sourceType: 'ig' | 'linkedin'
): RawLeadInput[] {
  if (sourceType === 'ig') return transformInstagramResults(data);
  if (sourceType === 'linkedin') return transformLinkedInResults(data);
  return [];
}

function extractIGHandle(profileUrl?: string): string | undefined {
  if (!profileUrl) return undefined;
  const match = profileUrl.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  return match ? match[1].toLowerCase() : undefined;
}

function extractProductHint(biography?: string): string | undefined {
  if (!biography) return undefined;
  // Check if bio mentions apparel-related terms
  const terms = ['clothing', 'apparel', 'fashion', 'wear', 'garment', 'activewear', 'sportswear',
    'streetwear', 'athleisure', 'yoga', 'fitness', 'gym', 'brand', 'boutique', 'retail'];
  const lower = biography.toLowerCase();
  const found = terms.filter((t) => lower.includes(t));
  return found.length > 0 ? found.join(', ') : biography.slice(0, 200);
}

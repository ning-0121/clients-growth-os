import { RawLeadInput } from '@/lib/types';

/**
 * Lead source interface — plug in real scrapers here.
 * Each source returns normalized RawLeadInput[].
 *
 * To add a real source:
 *   1. Implement this interface
 *   2. Register in SOURCES below
 *   3. Call via runIntakePipeline() with the appropriate trigger_type
 */
export interface LeadSource {
  name: string;
  triggerType: 'auto_scrape' | 'api' | 'manual';
  fetch(): Promise<RawLeadInput[]>;
}

/**
 * Mock Instagram source — placeholder for real IG scraper.
 * Replace fetch() with actual API call when ready.
 */
export const instagramSource: LeadSource = {
  name: 'instagram',
  triggerType: 'auto_scrape',
  async fetch() {
    // TODO: Replace with real Instagram API / scraper
    // Expected: search by hashtag/follower criteria,
    // extract: company_name, instagram_handle, website (from bio), contact_email (from bio)
    const { getMockLeads } = await import('@/scripts/lead-scraper');
    return getMockLeads().filter((l) => l.source === 'ig');
  },
};

/**
 * Website list source — enriches a list of URLs into leads.
 * Reads from data/seed-urls.txt by default.
 */
export const websiteSource: LeadSource = {
  name: 'website',
  triggerType: 'auto_scrape',
  async fetch() {
    const fs = await import('fs');
    const path = await import('path');
    const { enrichBatch, parseTxtInput } = await import('@/lib/growth/website-enricher');

    const filePath = path.join(process.cwd(), 'data', 'seed-urls.txt');
    if (!fs.existsSync(filePath)) return [];

    const text = fs.readFileSync(filePath, 'utf-8');
    const entries = parseTxtInput(text);
    if (entries.length === 0) return [];

    const { results } = await enrichBatch(entries.slice(0, 50));
    return results.map((r) => ({
      company_name: r.company_name,
      source: 'website' as const,
      website: r.website,
      contact_email: r.contact_email || undefined,
      instagram_handle: r.instagram_handle || undefined,
      contact_linkedin: r.contact_linkedin || undefined,
      product_match: r.product_match || undefined,
    }));
  },
};

/**
 * Registry of all available sources.
 * Add new sources here as they are built.
 */
export const LEAD_SOURCES: Record<string, LeadSource> = {
  instagram: instagramSource,
  website: websiteSource,
};

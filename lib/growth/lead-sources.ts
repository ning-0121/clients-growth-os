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
 * Mock website source — placeholder for real website crawler.
 * Replace fetch() with actual crawler when ready.
 */
export const websiteSource: LeadSource = {
  name: 'website',
  triggerType: 'auto_scrape',
  async fetch() {
    // TODO: Replace with real website crawler
    // Expected: crawl target directories / trade shows,
    // extract: company_name, website, contact_email, product_match
    const { getMockLeads } = await import('@/scripts/lead-scraper');
    return getMockLeads().filter((l) => l.source === 'website');
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

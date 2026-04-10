/**
 * Lightweight product category mapper.
 * Scans page text for known apparel categories.
 * Returns matched category or falls back to truncated meta description.
 */

const CATEGORIES = [
  'activewear',
  'sportswear',
  'streetwear',
  'fashion brand',
  'apparel',
  'loungewear',
  'swimwear',
  'yoga wear',
] as const;

// Additional keywords that map to a category
const KEYWORD_MAP: Record<string, string> = {
  athletic: 'activewear',
  workout: 'activewear',
  fitness: 'activewear',
  gym: 'activewear',
  running: 'sportswear',
  sport: 'sportswear',
  outdoor: 'sportswear',
  street: 'streetwear',
  urban: 'streetwear',
  skate: 'streetwear',
  lounge: 'loungewear',
  comfort: 'loungewear',
  sleep: 'loungewear',
  swim: 'swimwear',
  beach: 'swimwear',
  surf: 'swimwear',
  yoga: 'yoga wear',
  pilates: 'yoga wear',
  fashion: 'fashion brand',
  clothing: 'apparel',
  garment: 'apparel',
  textile: 'apparel',
};

/**
 * Scan text content and return a product category match.
 * @param texts - Array of text sources to scan (title, meta desc, body text)
 * @param metaDescription - Raw meta description for fallback
 * @returns product_match string
 */
export function mapCategory(
  texts: string[],
  metaDescription?: string
): string | null {
  const combined = texts.join(' ').toLowerCase();

  // Direct category match
  for (const cat of CATEGORIES) {
    if (combined.includes(cat)) {
      return cat;
    }
  }

  // Keyword-based mapping
  for (const [keyword, category] of Object.entries(KEYWORD_MAP)) {
    // Word boundary check to avoid partial matches
    const re = new RegExp(`\\b${keyword}\\b`, 'i');
    if (re.test(combined)) {
      return category;
    }
  }

  // Fallback: truncated meta description
  if (metaDescription && metaDescription.trim().length > 0) {
    return metaDescription.trim().slice(0, 200);
  }

  return null;
}

import { RawLeadInput, LeadGrade, SalesTier } from '@/lib/types';

const STRIP_SUFFIXES = /\b(inc|llc|ltd|co|company|corp|gmbh|sa|sl|plc|group)\b\.?/g;

/**
 * Normalize company name for dedup: lowercase, trim, strip common suffixes.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(STRIP_SUFFIXES, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract bare domain from a URL for dedup.
 * "https://www.acme.com/about" → "acme.com"
 */
export function extractDomain(url: string): string {
  try {
    let domain = url.toLowerCase().trim();
    domain = domain.replace(/^https?:\/\//, '');
    domain = domain.replace(/^www\./, '');
    domain = domain.split('/')[0];
    domain = domain.split('?')[0];
    return domain;
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Compute final_score: weighted average of three scores.
 * quality 30%, opportunity 40%, reachability 30%
 */
export function computeFinalScore(quality: number, opportunity: number, reachability: number): number {
  return Math.round(quality * 0.3 + opportunity * 0.4 + reachability * 0.3);
}

/**
 * Determine which sales_tier should handle this lead.
 * Returns null for C-grade leads (not assigned).
 */
export function requiredTier(grade: LeadGrade, opportunityScore: number): SalesTier | null {
  if (grade === 'A') return 'top';
  if (grade === 'B+' && opportunityScore >= 60) return 'top';
  if (grade === 'B+') return 'mid';
  if (grade === 'B') return 'mid';
  return null; // C-grade: not assigned
}

/**
 * V1.2 Filtering: must have website + product match + contact path.
 * Contact path = has email OR linkedin.
 * Returns disqualified_reason if filtered out, null if passes.
 */
export function filterLead(lead: RawLeadInput): string | null {
  if (!lead.website) {
    return '缺少网站';
  }
  if (!lead.product_match) {
    return '缺少产品匹配';
  }
  if (!lead.contact_email && !lead.contact_linkedin) {
    return '无联系路径（无邮箱且无LinkedIn）';
  }
  return null;
}

/**
 * Quality score (0-100): source reliability + website + product match depth.
 */
export function scoreQuality(lead: RawLeadInput): number {
  let score = 0;

  // Source quality
  const sourceScores: Record<string, number> = {
    referral: 35,
    customs: 30,
    linkedin: 25,
    website: 20,
    ig: 15,
    test_batch: 10,
  };
  score += sourceScores[lead.source] || 10;

  // Website present
  if (lead.website) score += 25;

  // Product match present and non-trivial
  if (lead.product_match) {
    score += lead.product_match.length > 10 ? 30 : 20;
  }

  // Contact name present
  if (lead.contact_name) score += 10;

  return Math.min(score, 100);
}

/**
 * Opportunity score (0-100): how likely this lead converts to revenue.
 */
export function scoreOpportunity(lead: RawLeadInput): number {
  let score = 0;

  // Product match is the strongest signal
  if (lead.product_match) {
    const pm = lead.product_match.toLowerCase();
    // Multiple product keywords = higher opportunity
    const keywords = ['t恤', '卫衣', '外套', '裤', '衬衫', 'shirt', 'hoodie', 'jacket', 'pants', 'dress', 'polo'];
    const matches = keywords.filter((k) => pm.includes(k)).length;
    score += Math.min(matches * 15, 45);
    // Has any product match at all
    if (matches === 0) score += 15;
  }

  // Referral source = warm lead
  if (lead.source === 'referral') score += 30;
  else if (lead.source === 'customs') score += 25;
  else if (lead.source === 'linkedin') score += 15;
  else score += 10;

  // Website = established business
  if (lead.website) score += 20;

  return Math.min(score, 100);
}

/**
 * Reachability score (0-100): how easy to reach this lead.
 */
export function scoreReachability(lead: RawLeadInput): number {
  let score = 0;

  if (lead.contact_email) score += 40;
  if (lead.contact_linkedin) score += 35;
  if (lead.contact_name) score += 15;
  if (lead.website) score += 10;

  return Math.min(score, 100);
}

/**
 * Calculate grade from final_score.
 */
export function calculateGrade(finalScore: number): LeadGrade {
  if (finalScore >= 70) return 'A';
  if (finalScore >= 55) return 'B+';
  if (finalScore >= 40) return 'B';
  return 'C';
}

/**
 * Process a raw lead: filter → score → grade → tier.
 * Returns the processed fields to merge into the insert.
 */
export function processLead(lead: RawLeadInput) {
  const disqualifiedReason = filterLead(lead);

  if (disqualifiedReason) {
    return {
      status: 'disqualified' as const,
      disqualified_reason: disqualifiedReason,
      quality_score: 0,
      opportunity_score: 0,
      reachability_score: 0,
      final_score: 0,
      grade: 'C' as LeadGrade,
      tier: null as SalesTier | null,
    };
  }

  const quality = scoreQuality(lead);
  const opportunity = scoreOpportunity(lead);
  const reachability = scoreReachability(lead);
  const finalScore = computeFinalScore(quality, opportunity, reachability);
  const grade = calculateGrade(finalScore);
  const tier = requiredTier(grade, opportunity);

  return {
    status: 'new' as const,
    disqualified_reason: null,
    quality_score: quality,
    opportunity_score: opportunity,
    reachability_score: reachability,
    final_score: finalScore,
    grade,
    tier,
  };
}

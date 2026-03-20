import { SalesTier } from '@/lib/types';

interface StaffMember {
  user_id: string;
  sales_tier: SalesTier;
  load: number;
}

/**
 * Tier-based assignment: pick the staff member in the required tier
 * with the fewest active leads.
 *
 * Eligibility: role = '销售' AND sales_tier IN ('top', 'mid').
 * sales_tier = null means not eligible.
 *
 * Fallback: if required tier has no staff, try the other tier.
 * If no eligible staff at all, returns null.
 */
export function assignLeadByTier(
  staff: StaffMember[],
  requiredTier: SalesTier | null
): string | null {
  if (!requiredTier) return null; // C-grade, no assignment

  // Filter to required tier
  let candidates = staff.filter((s) => s.sales_tier === requiredTier);

  // Fallback to other tier if empty
  if (candidates.length === 0) {
    const fallback = requiredTier === 'top' ? 'mid' : 'top';
    candidates = staff.filter((s) => s.sales_tier === fallback);
  }

  if (candidates.length === 0) return null;

  // Pick lowest load
  let minLoad = Infinity;
  let assignee = '';
  for (const c of candidates) {
    if (c.load < minLoad) {
      minLoad = c.load;
      assignee = c.user_id;
    }
  }

  return assignee || null;
}

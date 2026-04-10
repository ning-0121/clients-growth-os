import { createClient } from '@/lib/supabase/server';
import { VerificationCheck, CustomsTradeProfile } from '@/lib/ai/types';
import { normalizeCompanyName, extractDomain } from '@/lib/growth/lead-engine';

/**
 * Round 3: Customs Data Cross-Validation
 * - Match lead against customs records
 * - Build trade profile if matches found
 * - Auto-skip if no customs data in system
 */
export async function runRound3(
  lead: Record<string, any>,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ checks: VerificationCheck[]; tradeProfile: CustomsTradeProfile | null }> {
  const checks: VerificationCheck[] = [];

  // Check if any customs data exists
  const { count } = await supabase
    .from('growth_customs_records')
    .select('id', { count: 'exact', head: true });

  if (!count || count === 0) {
    checks.push({
      name: 'customs_data_available',
      result: 'skip',
      detail: 'No customs data in system — skipping cross-validation',
    });
    return { checks, tradeProfile: null };
  }

  checks.push({
    name: 'customs_data_available',
    result: 'pass',
    detail: `${count} customs records available for matching`,
  });

  // Strategy 1: Domain match
  let matchedRecordIds: string[] = [];

  if (lead.website) {
    const domain = extractDomain(lead.website);
    // Search for importers whose name contains the domain root
    const domainRoot = domain.split('.')[0]; // e.g., "acme" from "acme.com"
    if (domainRoot.length >= 3) {
      const { data: domainMatches } = await supabase
        .from('growth_customs_records')
        .select('id')
        .ilike('importer_name', `%${domainRoot}%`)
        .limit(50);

      if (domainMatches && domainMatches.length > 0) {
        matchedRecordIds.push(...domainMatches.map((r: any) => r.id));
        checks.push({
          name: 'customs_domain_match',
          result: 'pass',
          detail: `${domainMatches.length} potential matches via domain "${domainRoot}"`,
        });
      }
    }
  }

  // Strategy 2: Exact normalized name match
  const normalizedName = normalizeCompanyName(lead.company_name);
  if (normalizedName.length >= 3) {
    const { data: nameMatches } = await supabase
      .from('growth_customs_records')
      .select('id')
      .ilike('importer_name', `%${normalizedName}%`)
      .limit(50);

    if (nameMatches && nameMatches.length > 0) {
      const newIds = nameMatches.map((r: any) => r.id).filter((id: string) => !matchedRecordIds.includes(id));
      matchedRecordIds.push(...newIds);
      checks.push({
        name: 'customs_name_match',
        result: 'pass',
        detail: `${nameMatches.length} potential matches via company name`,
      });
    }
  }

  if (matchedRecordIds.length === 0) {
    checks.push({
      name: 'customs_match_result',
      result: 'skip',
      detail: 'No customs matches found for this company',
    });
    return { checks, tradeProfile: null };
  }

  // Deduplicate IDs
  matchedRecordIds = [...new Set(matchedRecordIds)];

  // Load full records and build trade profile
  const { data: records } = await supabase
    .from('growth_customs_records')
    .select('*')
    .in('id', matchedRecordIds.slice(0, 100));

  if (!records || records.length === 0) {
    return { checks, tradeProfile: null };
  }

  const tradeProfile = buildTradeProfile(records);

  // Save matches to growth_customs_matches
  const matchInserts = matchedRecordIds.slice(0, 100).map((customs_record_id) => ({
    lead_id: lead.id,
    customs_record_id,
    match_type: 'exact_name' as const,
    confidence: 'medium' as const,
  }));

  await supabase.from('growth_customs_matches').upsert(matchInserts, {
    onConflict: 'lead_id,customs_record_id',
  });

  // Save trade profile on lead
  await supabase
    .from('growth_leads')
    .update({ customs_summary: tradeProfile })
    .eq('id', lead.id);

  checks.push({
    name: 'customs_match_result',
    result: 'pass',
    detail: `Trade profile built from ${records.length} records: ${tradeProfile.is_apparel_importer ? 'Apparel importer confirmed' : 'Non-apparel imports'}`,
    data: {
      total_records: tradeProfile.total_records,
      total_value_usd: tradeProfile.total_value_usd,
      is_apparel: tradeProfile.is_apparel_importer,
    },
  });

  return { checks, tradeProfile };
}

// HS codes for apparel (Chapters 61, 62, 63)
const APPAREL_HS_PREFIXES = ['61', '62', '63'];

function buildTradeProfile(records: any[]): CustomsTradeProfile {
  const totalValue = records.reduce((sum: number, r: any) => sum + (Number(r.value_usd) || 0), 0);

  // Count by HS code
  const hsMap = new Map<string, number>();
  for (const r of records) {
    if (r.hs_code) {
      const code = r.hs_code.slice(0, 4);
      hsMap.set(code, (hsMap.get(code) || 0) + 1);
    }
  }
  const topHsCodes = [...hsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({ code, description: describeHSCode(code), count }));

  // Origin countries
  const countries = [...new Set(records.map((r: any) => r.origin_country).filter(Boolean))];

  // Date range
  const dates = records.map((r: any) => r.import_date).filter(Boolean).sort();
  const dateRange = dates.length > 0
    ? { first: dates[0], last: dates[dates.length - 1] }
    : { first: '', last: '' };

  // Monthly average
  let avgMonthly = 0;
  if (dates.length >= 2) {
    const firstDate = new Date(dates[0]);
    const lastDate = new Date(dates[dates.length - 1]);
    const months = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
    avgMonthly = Math.round(records.length / months * 10) / 10;
  }

  // Check if apparel importer
  const apparelRecordCount = records.filter((r: any) =>
    r.hs_code && APPAREL_HS_PREFIXES.some((p) => r.hs_code.startsWith(p))
  ).length;
  const isApparelImporter = apparelRecordCount > records.length * 0.3; // >30% apparel

  return {
    total_records: records.length,
    total_value_usd: totalValue,
    avg_monthly_imports: avgMonthly,
    top_hs_codes: topHsCodes,
    origin_countries: countries,
    date_range: dateRange,
    is_apparel_importer: isApparelImporter,
  };
}

function describeHSCode(code: string): string {
  const descriptions: Record<string, string> = {
    '6101': 'Men\'s overcoats, knitted',
    '6102': 'Women\'s overcoats, knitted',
    '6103': 'Men\'s suits, knitted',
    '6104': 'Women\'s suits, knitted',
    '6105': 'Men\'s shirts, knitted',
    '6106': 'Women\'s blouses, knitted',
    '6107': 'Men\'s underwear, knitted',
    '6108': 'Women\'s underwear, knitted',
    '6109': 'T-shirts, knitted',
    '6110': 'Sweaters/pullovers, knitted',
    '6111': 'Babies\' garments, knitted',
    '6112': 'Track suits/ski suits, knitted',
    '6114': 'Other garments, knitted',
    '6201': 'Men\'s overcoats, woven',
    '6202': 'Women\'s overcoats, woven',
    '6203': 'Men\'s suits, woven',
    '6204': 'Women\'s suits, woven',
    '6205': 'Men\'s shirts, woven',
    '6206': 'Women\'s blouses, woven',
    '6207': 'Men\'s underwear, woven',
    '6208': 'Women\'s underwear, woven',
    '6209': 'Babies\' garments, woven',
    '6210': 'Garments of felt/coated fabric',
    '6211': 'Track suits/ski suits, woven',
    '6301': 'Blankets',
    '6302': 'Bed/table/kitchen linen',
    '6303': 'Curtains/blinds',
    '6305': 'Sacks and bags',
  };
  return descriptions[code] || `HS ${code}`;
}

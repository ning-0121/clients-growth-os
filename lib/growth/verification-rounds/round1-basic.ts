import { createClient } from '@/lib/supabase/server';
import { analyzeWebsite } from '@/lib/ai/website-analyzer';
import { VerificationCheck } from '@/lib/ai/types';

/**
 * Round 1: Basic Validation + AI Website Analysis
 * - Website reachable check
 * - AI website analysis (if not already done during intake)
 * - Disqualify non-apparel companies with high confidence
 */
export async function runRound1(
  lead: Record<string, any>,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ checks: VerificationCheck[]; disqualify: boolean; disqualifyReason?: string }> {
  const checks: VerificationCheck[] = [];

  // Check 1: Website reachable
  if (lead.website) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(lead.website, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthOS/1.0)' },
      });
      clearTimeout(timer);

      if (res.ok) {
        checks.push({ name: 'website_reachable', result: 'pass', detail: `HTTP ${res.status}` });
      } else {
        checks.push({ name: 'website_reachable', result: 'warn', detail: `HTTP ${res.status}` });
      }
    } catch {
      checks.push({ name: 'website_reachable', result: 'fail', detail: 'Website unreachable (timeout or error)' });
    }
  } else {
    checks.push({ name: 'website_reachable', result: 'skip', detail: 'No website provided' });
  }

  // Check 2: AI website analysis
  if (lead.ai_analysis) {
    // Already analyzed during intake
    const analysis = lead.ai_analysis;
    checks.push({
      name: 'ai_website_analysis',
      result: analysis.is_apparel_company ? 'pass' : 'fail',
      detail: `Apparel: ${analysis.is_apparel_company} (confidence: ${analysis.confidence}%)`,
      data: { product_fit_score: analysis.product_fit_score, company_type: analysis.company_type },
    });

    // Disqualify if AI is confident this is NOT an apparel company
    if (!analysis.is_apparel_company && analysis.confidence >= 80) {
      return {
        checks,
        disqualify: true,
        disqualifyReason: `AI判定非服装公司 (置信度${analysis.confidence}%: ${analysis.company_type})`,
      };
    }
  } else if (lead.website) {
    // Try to run AI analysis now
    try {
      const cheerio = await import('cheerio');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(lead.website, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthOS/1.0)' },
      });
      clearTimeout(timer);

      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        const titleText = $('title').text();
        const metaDesc = $('meta[name="description"]').attr('content') || '';
        const bodyText = $('body').text().slice(0, 5000);
        const navItems: string[] = [];
        $('nav a, header a').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length < 50) navItems.push(text);
        });
        const headings: string[] = [];
        $('h1, h2').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length < 200) headings.push(text);
        });

        const analysis = await analyzeWebsite({
          url: lead.website,
          title: titleText,
          metaDescription: metaDesc,
          bodyText,
          navItems: navItems.slice(0, 20),
          headings: headings.slice(0, 10),
        }, lead.id);

        if (analysis) {
          // Store analysis on the lead
          await supabase
            .from('growth_leads')
            .update({ ai_analysis: analysis })
            .eq('id', lead.id);

          checks.push({
            name: 'ai_website_analysis',
            result: analysis.is_apparel_company ? 'pass' : 'fail',
            detail: `Apparel: ${analysis.is_apparel_company} (confidence: ${analysis.confidence}%)`,
            data: { product_fit_score: analysis.product_fit_score, company_type: analysis.company_type },
          });

          if (!analysis.is_apparel_company && analysis.confidence >= 80) {
            return {
              checks,
              disqualify: true,
              disqualifyReason: `AI判定非服装公司 (置信度${analysis.confidence}%: ${analysis.company_type})`,
            };
          }
        } else {
          checks.push({ name: 'ai_website_analysis', result: 'skip', detail: 'AI analysis returned null' });
        }
      }
    } catch {
      checks.push({ name: 'ai_website_analysis', result: 'skip', detail: 'AI analysis unavailable' });
    }
  }

  // Check 3: Company name quality
  if (lead.company_name && lead.company_name.trim().length >= 2) {
    checks.push({ name: 'company_name_quality', result: 'pass', detail: lead.company_name });
  } else {
    checks.push({ name: 'company_name_quality', result: 'warn', detail: 'Company name too short or missing' });
  }

  return { checks, disqualify: false };
}

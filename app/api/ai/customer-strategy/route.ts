import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deepResearchCustomer } from '@/lib/ai/customer-research';
import { generateCustomerStrategy } from '@/lib/ai/customer-strategy';

/**
 * POST /api/ai/customer-strategy
 *
 * Step 1: Deep research (website scan + Google + LinkedIn + customs)
 * Step 2: AI strategy generation based on ALL research data
 *
 * Body: { leadId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let leadId: string;
  try {
    const body = await request.json();
    leadId = body.leadId;
  } catch {
    return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });
  }

  const { data: lead } = await supabase
    .from('growth_leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (!lead) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 });
  }

  // Step 1: Deep research from multiple sources
  let research = null;
  try {
    research = await deepResearchCustomer(lead, supabase);
  } catch (err) {
    console.warn('[Research] Deep research partially failed:', err);
    // Continue with whatever data we have
  }

  // Step 2: Generate strategy with research data
  const strategy = await generateCustomerStrategy(lead, research);

  if (!strategy) {
    return NextResponse.json({ error: 'AI 策略生成失败，请稍后重试' }, { status: 500 });
  }

  const researchSummary = research ? {
    pages_scanned: research.website_pages_scanned,
    products_found: research.products_found.length,
    has_google_intel: research.google_mentions.length > 0,
    has_linkedin_intel: !!research.linkedin_summary,
    has_customs_data: !!research.customs_summary,
    price_range: research.price_range,
    employee_estimate: research.employee_count_estimate,
  } : null;

  // ── PERSIST the strategy to lead.ai_analysis so email generator can use it ──
  try {
    const existingAi = (lead.ai_analysis as Record<string, any>) || {};
    await supabase.from('growth_leads').update({
      ai_analysis: {
        ...existingAi,
        outreach_strategy: strategy,                // full bundle
        strategy_generated_at: new Date().toISOString(),
        research_summary: researchSummary,
      },
    }).eq('id', leadId);
  } catch (err) {
    console.warn('[Strategy] Failed to persist strategy:', err);
  }

  return NextResponse.json({
    ...strategy,
    research_summary: researchSummary,
    strategy_persisted: true,
  });
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import { generateColdEmail } from '@/lib/outreach/email-generator';
import { classifyEmailQuality } from '@/lib/outreach/sequence-engine';
import type { EmailType } from '@/lib/ai/prompts';

/**
 * POST /api/leads/preview-email
 * Generate an AI email preview for a lead WITHOUT sending it.
 * Used in the outreach review queue so sales can see what will be sent.
 */
export async function POST(request: Request) {
  await requireAuth();

  try {
    const body = await request.json();
    const { lead_id, step_number = 1, email_type = 'intro' } = body;

    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id required' }, { status: 400 });
    }

    const supabase = await createClient();

    // Fetch lead
    const { data: lead } = await supabase
      .from('growth_leads')
      .select('id, company_name, contact_name, contact_email, website, ai_analysis, customs_summary')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // ── WORKFLOW GATE: Strategy must exist before generating email ──
    // This ensures the email is built on top of customer analysis, not generic templates.
    const aiAnalysis = (lead.ai_analysis as Record<string, any>) || {};
    const hasStrategy = !!(aiAnalysis.outreach_strategy?.strategy?.first_touch_angle);

    if (!hasStrategy) {
      return NextResponse.json({
        error: 'missing_strategy',
        error_message: '请先在「开发策略」Tab 生成客户策略，邮件需要基于策略撰写',
        action_required: 'generate_strategy_first',
      }, { status: 428 }); // 428 Precondition Required
    }

    // Check email quality
    const emailQuality = classifyEmailQuality(lead.contact_email || '');

    // Generate email preview (uses strategy from lead.ai_analysis.outreach_strategy)
    const email = await generateColdEmail(
      lead,
      step_number,
      email_type as EmailType,
      []
    );

    if (!email) {
      return NextResponse.json({ error: 'AI email generation failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      lead: {
        id: lead.id,
        company_name: lead.company_name,
        contact_name: lead.contact_name,
        contact_email: lead.contact_email,
        email_quality: emailQuality,
      },
      email: {
        subject: email.subject,
        body_text: email.body_text,
        body_html: email.body_html,
        step_number,
        email_type,
        angle_used: email.angle_used,
      },
      strategy_used: {
        first_touch_angle: aiAnalysis.outreach_strategy?.strategy?.first_touch_angle,
        approach: aiAnalysis.outreach_strategy?.strategy?.approach,
      },
      warnings: [
        ...(emailQuality === 'generic' ? [`⚠️ Generic email (${lead.contact_email}) — will likely go to spam or wrong person`] : []),
        ...(!lead.contact_name ? ['⚠️ No contact name — email will be impersonal'] : []),
        ...(!lead.website ? ['⚠️ No website — limited personalization possible'] : []),
      ],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

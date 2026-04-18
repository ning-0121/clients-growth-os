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

    // Check email quality
    const emailQuality = classifyEmailQuality(lead.contact_email || '');

    // Generate email preview
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

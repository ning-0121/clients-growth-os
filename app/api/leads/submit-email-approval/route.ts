import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { classifyEmailQuality } from '@/lib/outreach/sequence-engine';

/**
 * POST /api/leads/submit-email-approval
 *
 * Submits an AI-generated email for manual review.
 * - A/B grade leads → must be approved by admin before send
 * - C/D grade leads → queued directly for auto-send (after basic quality check)
 *
 * Body: { lead_id, subject, body_text, body_html?, step_number?, email_type? }
 */
export async function POST(request: Request) {
  const user = await requireAuth();
  const profile = await getCurrentProfile();

  try {
    const body = await request.json();
    const { lead_id, subject, body_text, body_html, step_number = 1, email_type = 'intro' } = body;

    if (!lead_id || !subject || !body_text) {
      return NextResponse.json({ error: 'lead_id, subject, body_text required' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: lead } = await supabase
      .from('growth_leads')
      .select('id, company_name, contact_name, contact_email, grade, category, ai_analysis')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    if (!lead.contact_email) {
      return NextResponse.json({ error: 'Lead has no email' }, { status: 400 });
    }

    // Block generic emails
    const quality = classifyEmailQuality(lead.contact_email);
    if (quality === 'generic') {
      return NextResponse.json({
        error: `拒绝提交：${lead.contact_email} 是泛型邮箱，无人会处理。请先找真实联系人。`
      }, { status: 400 });
    }

    // Determine category — use lead.category if set, else derive from grade + email quality
    const category = lead.category || inferCategory(lead);
    const requiresApproval = category === 'A' || category === 'B';

    // Check if already has pending approval for this lead
    const { data: existing } = await supabase
      .from('pending_email_approvals')
      .select('id, status')
      .eq('lead_id', lead_id)
      .in('status', ['pending', 'approved'])
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        error: `该客户已有待处理的邮件（状态：${existing.status}），请先处理或等待审批结果。`
      }, { status: 409 });
    }

    // Insert into approval queue
    const { data: approval, error: insertErr } = await supabase
      .from('pending_email_approvals')
      .insert({
        lead_id,
        lead_category: category,
        to_email: lead.contact_email,
        subject,
        body_text,
        body_html: body_html || `<p>${body_text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
        step_number,
        email_type,
        submitted_by: user.id,
        submitted_by_name: profile?.name || user.email,
        status: requiresApproval ? 'pending' : 'approved', // C/D auto-approved
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      approval_id: approval.id,
      status: approval.status,
      message: requiresApproval
        ? `A/B级客户，已提交审批（需管理员批准）`
        : `${category}级客户，已自动批准，加入发送队列`,
      requires_approval: requiresApproval,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Simple category inference when lead.category is missing.
 * Matches the logic in app/growth/deals/page.tsx categorize().
 */
function inferCategory(lead: any): string {
  const email = lead.contact_email || '';
  const local = email.split('@')[0]?.toLowerCase() || '';
  const isPersonal = email && !['info', 'sales', 'hello', 'contact', 'support', 'help', 'admin'].includes(local);

  if (isPersonal && lead.grade === 'A') return 'A';
  if (isPersonal && lead.grade === 'B') return 'B';
  if (lead.grade === 'A' || lead.grade === 'B') return 'B';
  if (lead.grade === 'C') return 'C';
  return 'D';
}

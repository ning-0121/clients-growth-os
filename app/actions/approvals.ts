'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { sendEmail } from '@/lib/outreach/resend-client';
import { revalidatePath } from 'next/cache';

/**
 * Approve a pending email and immediately send it.
 * Admin only.
 */
export async function approveAndSendEmail(approvalId: string, notes?: string) {
  const user = await requireAuth();
  const profile = await getCurrentProfile();

  if (profile?.role !== '管理员') {
    return { error: '只有管理员可以批准邮件' };
  }

  const supabase = await createClient();

  // Fetch the approval record
  const { data: approval, error: fetchErr } = await supabase
    .from('pending_email_approvals')
    .select('*')
    .eq('id', approvalId)
    .eq('status', 'pending')
    .single();

  if (fetchErr || !approval) {
    return { error: '邮件不存在或已处理' };
  }

  // Send via Resend immediately (use service client to bypass RLS for update)
  const sendResult = await sendEmail({
    to: approval.to_email,
    subject: approval.subject,
    html: approval.body_html,
    text: approval.body_text,
  });

  const now = new Date().toISOString();
  const service = createServiceClient();

  if ('error' in sendResult) {
    await service.from('pending_email_approvals').update({
      status: 'failed',
      reviewed_by: user.id,
      reviewed_at: now,
      review_notes: notes,
      send_error: sendResult.error,
    }).eq('id', approvalId);

    return { error: `发送失败：${sendResult.error}` };
  }

  // Mark as sent + log to outreach_emails for tracking
  await service.from('pending_email_approvals').update({
    status: 'sent',
    reviewed_by: user.id,
    reviewed_at: now,
    review_notes: notes,
    sent_at: now,
    resend_message_id: sendResult.id,
  }).eq('id', approvalId);

  // Also log to outreach_emails so it shows up in the email history
  await service.from('outreach_emails').insert({
    lead_id: approval.lead_id,
    step_number: approval.step_number,
    subject: approval.subject,
    body_text: approval.body_text,
    body_html: approval.body_html,
    to_email: approval.to_email,
    resend_message_id: sendResult.id,
    status: 'sent',
    sent_at: now,
  });

  // Update lead status
  await service.from('growth_leads').update({
    outreach_status: 'sequence_active',
    last_action_at: now,
  }).eq('id', approval.lead_id);

  revalidatePath('/growth/outreach');
  revalidatePath('/growth/deals');

  return { success: true, message: '已批准并发送' };
}

/**
 * Reject a pending email.
 */
export async function rejectEmail(approvalId: string, notes: string) {
  const user = await requireAuth();
  const profile = await getCurrentProfile();

  if (profile?.role !== '管理员') {
    return { error: '只有管理员可以拒绝邮件' };
  }

  if (!notes || notes.trim().length === 0) {
    return { error: '请填写拒绝原因' };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('pending_email_approvals')
    .update({
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes,
    })
    .eq('id', approvalId)
    .eq('status', 'pending');

  if (error) return { error: error.message };

  revalidatePath('/growth/outreach');
  revalidatePath('/growth/deals');

  return { success: true };
}

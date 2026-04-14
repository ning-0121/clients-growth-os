/**
 * 社媒内容审批工作流 — 确保每条内容真正落地
 *
 * 状态流: draft → pending_review → approved → scheduled → published
 *                       ↓
 *                   rejected → draft (修改后重新提交)
 *
 * 审批逻辑:
 * 1. AI 生成内容 → 自动进入 pending_review
 * 2. 管理员审核 → 批准/拒绝/修改
 * 3. 批准后自动排入发布队列
 * 4. 全程留痕：谁创建、谁审批、何时审批、修改了什么
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ── 内容状态 ──

export type ContentStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'scheduled' | 'published' | 'failed';

// ── 审批记录 ──

export interface ApprovalRecord {
  content_id: string;
  action: 'submit' | 'approve' | 'reject' | 'edit' | 'publish';
  actor_id: string;
  actor_name: string;
  notes?: string;
  changes?: { field: string; from: string; to: string }[];
  timestamp: string;
}

// ── 内容详情 ──

export interface ContentItem {
  id: string;
  platform: string;
  content_type: string;
  topic: string;
  caption: string;
  hashtags: string[];
  image_prompt?: string;
  image_url?: string;
  call_to_action?: string;
  scheduled_at?: string;
  status: ContentStatus;
  created_by: string;
  approval_history: ApprovalRecord[];
}

// ── 提交审核 ──

/**
 * 将 AI 生成的内容提交审核
 */
export async function submitForReview(
  supabase: SupabaseClient,
  contentId: string,
  submitterId: string,
  submitterName: string
): Promise<{ success: boolean; error?: string }> {
  // 获取当前内容
  const { data: content, error } = await supabase
    .from('social_content')
    .select('*')
    .eq('id', contentId)
    .single();

  if (error || !content) {
    return { success: false, error: '内容不存在' };
  }

  if (content.status !== 'draft' && content.status !== 'rejected') {
    return { success: false, error: `当前状态 "${content.status}" 不可提交审核` };
  }

  // 更新状态
  const approvalRecord: ApprovalRecord = {
    content_id: contentId,
    action: 'submit',
    actor_id: submitterId,
    actor_name: submitterName,
    notes: '提交审核',
    timestamp: new Date().toISOString(),
  };

  const history = Array.isArray(content.approval_history) ? content.approval_history : [];

  await supabase
    .from('social_content')
    .update({
      status: 'pending_review',
      approval_history: [...history, approvalRecord],
    })
    .eq('id', contentId);

  return { success: true };
}

// ── 审批通过 ──

/**
 * 管理员审批通过内容
 */
export async function approveContent(
  supabase: SupabaseClient,
  contentId: string,
  approverId: string,
  approverName: string,
  notes?: string,
  scheduledAt?: string
): Promise<{ success: boolean; error?: string }> {
  const { data: content, error } = await supabase
    .from('social_content')
    .select('*')
    .eq('id', contentId)
    .single();

  if (error || !content) {
    return { success: false, error: '内容不存在' };
  }

  if (content.status !== 'pending_review') {
    return { success: false, error: `当前状态 "${content.status}" 不可审批` };
  }

  const approvalRecord: ApprovalRecord = {
    content_id: contentId,
    action: 'approve',
    actor_id: approverId,
    actor_name: approverName,
    notes: notes || '审批通过',
    timestamp: new Date().toISOString(),
  };

  const history = Array.isArray(content.approval_history) ? content.approval_history : [];

  await supabase
    .from('social_content')
    .update({
      status: scheduledAt ? 'scheduled' : 'approved',
      scheduled_at: scheduledAt || content.scheduled_at,
      approval_history: [...history, approvalRecord],
    })
    .eq('id', contentId);

  return { success: true };
}

// ── 审批拒绝 ──

/**
 * 管理员拒绝内容（附带修改意见）
 */
export async function rejectContent(
  supabase: SupabaseClient,
  contentId: string,
  reviewerId: string,
  reviewerName: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const { data: content, error } = await supabase
    .from('social_content')
    .select('*')
    .eq('id', contentId)
    .single();

  if (error || !content) {
    return { success: false, error: '内容不存在' };
  }

  if (content.status !== 'pending_review') {
    return { success: false, error: `当前状态 "${content.status}" 不可拒绝` };
  }

  const approvalRecord: ApprovalRecord = {
    content_id: contentId,
    action: 'reject',
    actor_id: reviewerId,
    actor_name: reviewerName,
    notes: reason,
    timestamp: new Date().toISOString(),
  };

  const history = Array.isArray(content.approval_history) ? content.approval_history : [];

  await supabase
    .from('social_content')
    .update({
      status: 'rejected',
      approval_history: [...history, approvalRecord],
    })
    .eq('id', contentId);

  return { success: true };
}

// ── 编辑内容（带变更记录）──

/**
 * 编辑内容并记录变更
 */
export async function editContent(
  supabase: SupabaseClient,
  contentId: string,
  editorId: string,
  editorName: string,
  updates: { caption?: string; hashtags?: string[]; scheduled_at?: string; call_to_action?: string }
): Promise<{ success: boolean; error?: string }> {
  const { data: content, error } = await supabase
    .from('social_content')
    .select('*')
    .eq('id', contentId)
    .single();

  if (error || !content) {
    return { success: false, error: '内容不存在' };
  }

  // 记录变更
  const changes: { field: string; from: string; to: string }[] = [];
  if (updates.caption && updates.caption !== content.caption) {
    changes.push({ field: 'caption', from: content.caption.slice(0, 50) + '...', to: updates.caption.slice(0, 50) + '...' });
  }
  if (updates.hashtags) {
    changes.push({ field: 'hashtags', from: (content.hashtags || []).join(', '), to: updates.hashtags.join(', ') });
  }
  if (updates.scheduled_at && updates.scheduled_at !== content.scheduled_at) {
    changes.push({ field: 'scheduled_at', from: content.scheduled_at || '', to: updates.scheduled_at });
  }

  const approvalRecord: ApprovalRecord = {
    content_id: contentId,
    action: 'edit',
    actor_id: editorId,
    actor_name: editorName,
    notes: `修改了 ${changes.map((c) => c.field).join(', ')}`,
    changes,
    timestamp: new Date().toISOString(),
  };

  const history = Array.isArray(content.approval_history) ? content.approval_history : [];

  await supabase
    .from('social_content')
    .update({
      ...updates,
      // 编辑后回到草稿状态，需要重新审批
      status: 'draft',
      approval_history: [...history, approvalRecord],
    })
    .eq('id', contentId);

  return { success: true };
}

// ── 标记发布 ──

/**
 * 标记内容已发布
 */
export async function markPublished(
  supabase: SupabaseClient,
  contentId: string,
  publisherId: string,
  publisherName: string,
  publishedUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const { data: content, error } = await supabase
    .from('social_content')
    .select('*')
    .eq('id', contentId)
    .single();

  if (error || !content) {
    return { success: false, error: '内容不存在' };
  }

  if (content.status !== 'approved' && content.status !== 'scheduled') {
    return { success: false, error: `当前状态 "${content.status}" 不可标记发布` };
  }

  const approvalRecord: ApprovalRecord = {
    content_id: contentId,
    action: 'publish',
    actor_id: publisherId,
    actor_name: publisherName,
    notes: publishedUrl ? `已发布: ${publishedUrl}` : '已发布',
    timestamp: new Date().toISOString(),
  };

  const history = Array.isArray(content.approval_history) ? content.approval_history : [];

  await supabase
    .from('social_content')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      image_url: publishedUrl || content.image_url,
      approval_history: [...history, approvalRecord],
    })
    .eq('id', contentId);

  return { success: true };
}

// ── 获取待审核列表 ──

/**
 * 获取所有待审核的内容
 */
export async function getPendingReview(
  supabase: SupabaseClient
): Promise<ContentItem[]> {
  const { data } = await supabase
    .from('social_content')
    .select('*')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false });

  return (data || []) as ContentItem[];
}

/**
 * 获取内容的完整审批历史
 */
export async function getApprovalHistory(
  supabase: SupabaseClient,
  contentId: string
): Promise<ApprovalRecord[]> {
  const { data } = await supabase
    .from('social_content')
    .select('approval_history')
    .eq('id', contentId)
    .single();

  return (data?.approval_history || []) as ApprovalRecord[];
}

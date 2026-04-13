import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth';
import {
  approveContent,
  rejectContent,
  editContent,
  markPublished,
  submitForReview,
  getPendingReview,
} from '@/lib/social/approval-workflow';

/**
 * GET /api/social/approve
 * 获取所有待审核的社媒内容
 */
export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile || profile.role !== '管理员') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const supabase = await createClient();
    const pending = await getPendingReview(supabase);

    return NextResponse.json({ success: true, pending, count: pending.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/social/approve
 * 审批操作: approve / reject / edit / publish / submit
 *
 * Body: {
 *   action: "approve" | "reject" | "edit" | "publish" | "submit",
 *   contentId: string,
 *   notes?: string,
 *   reason?: string,        // reject 时必填
 *   scheduledAt?: string,   // approve 时可选
 *   updates?: { caption?, hashtags?, scheduled_at? }  // edit 时必填
 * }
 */
export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 只有管理员可以审批，销售可以提交
    const body = await request.json();
    const { action, contentId } = body;

    if (!contentId) {
      return NextResponse.json({ error: '缺少 contentId' }, { status: 400 });
    }

    const supabase = await createClient();
    const userId = profile.user_id;
    const userName = profile.name || '未知';

    let result: { success: boolean; error?: string };

    switch (action) {
      case 'submit':
        result = await submitForReview(supabase, contentId, userId, userName);
        break;

      case 'approve':
        if (profile.role !== '管理员') {
          return NextResponse.json({ error: '只有管理员可以审批' }, { status: 403 });
        }
        result = await approveContent(supabase, contentId, userId, userName, body.notes, body.scheduledAt);
        break;

      case 'reject':
        if (profile.role !== '管理员') {
          return NextResponse.json({ error: '只有管理员可以拒绝' }, { status: 403 });
        }
        if (!body.reason) {
          return NextResponse.json({ error: '拒绝时必须填写原因' }, { status: 400 });
        }
        result = await rejectContent(supabase, contentId, userId, userName, body.reason);
        break;

      case 'edit':
        if (!body.updates) {
          return NextResponse.json({ error: '缺少修改内容 (updates)' }, { status: 400 });
        }
        result = await editContent(supabase, contentId, userId, userName, body.updates);
        break;

      case 'publish':
        result = await markPublished(supabase, contentId, userId, userName, body.publishedUrl);
        break;

      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, action, contentId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

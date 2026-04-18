import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { requireString, requireEnum, requireEmail, ValidationError } from '@/lib/validation';

/**
 * GET /api/admin/users — list all users (admin only)
 * POST /api/admin/users — invite a new user (admin only)
 *   Body: { email, name, role, sales_tier? }
 * PATCH /api/admin/users — update a user's role (admin only)
 *   Body: { user_id, role, sales_tier? }
 */

const ALLOWED_ROLES = ['销售', '财务', '采购', '生产', '质检', '管理员'] as const;
const ALLOWED_TIERS = ['top', 'mid'] as const;

export async function GET() {
  await requireAuth();
  const profile = await getCurrentProfile();
  if (profile?.role !== '管理员') {
    return NextResponse.json({ error: '仅管理员' }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('user_id, name, role, sales_tier, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Count leads assigned to each user
  const { data: leadCounts } = await supabase
    .from('growth_leads')
    .select('assigned_to')
    .not('assigned_to', 'is', null);

  const leadMap: Record<string, number> = {};
  (leadCounts || []).forEach((l: any) => {
    if (l.assigned_to) leadMap[l.assigned_to] = (leadMap[l.assigned_to] || 0) + 1;
  });

  const enriched = (profiles || []).map((p: any) => ({
    ...p,
    lead_count: leadMap[p.user_id] || 0,
  }));

  return NextResponse.json({ users: enriched });
}

export async function POST(request: Request) {
  await requireAuth();
  const profile = await getCurrentProfile();
  if (profile?.role !== '管理员') {
    return NextResponse.json({ error: '仅管理员' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const email = requireEmail(body.email);
    const name = requireString(body.name, 'name', { maxLength: 80 });
    const role = requireEnum(body.role, 'role', ALLOWED_ROLES);
    const sales_tier = body.sales_tier ? requireEnum(body.sales_tier, 'sales_tier', ALLOWED_TIERS) : null;

    // Use service client to create auth user + profile
    const service = createServiceClient();

    // Create auth user via admin API
    // Note: This requires Supabase Admin API (service role has it)
    const { data: authUser, error: createErr } = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createErr || !authUser?.user) {
      return NextResponse.json({
        error: `创建失败：${createErr?.message || 'unknown'}`,
      }, { status: 500 });
    }

    // Create profile
    const { error: profileErr } = await service.from('profiles').insert({
      user_id: authUser.user.id,
      name,
      role,
      sales_tier,
    });

    if (profileErr) {
      // Try to roll back auth user
      await service.auth.admin.deleteUser(authUser.user.id).catch(() => {});
      return NextResponse.json({ error: `档案创建失败：${profileErr.message}` }, { status: 500 });
    }

    // Generate a temp password reset link so the user can set their own password
    const { data: linkData } = await service.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    return NextResponse.json({
      success: true,
      user_id: authUser.user.id,
      email,
      invite_link: linkData?.properties?.action_link || null,
      message: '用户已创建，请把 invite_link 转给对方完成密码设置',
    });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  await requireAuth();
  const profile = await getCurrentProfile();
  if (profile?.role !== '管理员') {
    return NextResponse.json({ error: '仅管理员' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const user_id = requireString(body.user_id, 'user_id');
    const role = requireEnum(body.role, 'role', ALLOWED_ROLES);
    const sales_tier = body.sales_tier === null ? null : body.sales_tier ? requireEnum(body.sales_tier, 'sales_tier', ALLOWED_TIERS) : undefined;

    const service = createServiceClient();
    const update: Record<string, any> = { role };
    if (sales_tier !== undefined) update.sales_tier = sales_tier;

    const { error } = await service.from('profiles').update(update).eq('user_id', user_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

'use server';

import { createClient } from '@/lib/supabase/server';

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // 返回成功状态，让客户端处理跳转
  return { success: true };
}

export async function signup(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const name = formData.get('name') as string;
  const role = (formData.get('role') as string) || '销售';

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (data.user) {
    // 创建用户 profile
    await supabase.from('profiles').insert({
      user_id: data.user.id,
      name,
      role: role as any,
    });
  }

  // 返回成功状态，让客户端处理跳转
  return { success: true };
}


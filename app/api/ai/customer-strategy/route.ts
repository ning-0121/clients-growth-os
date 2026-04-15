import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateCustomerStrategy } from '@/lib/ai/customer-strategy';

/**
 * POST /api/ai/customer-strategy
 * Generate AI customer analysis + development strategy + phone script
 * Body: { leadId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // Auth check
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

  // Fetch lead
  const { data: lead } = await supabase
    .from('growth_leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (!lead) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 });
  }

  const strategy = await generateCustomerStrategy(lead);

  if (!strategy) {
    return NextResponse.json({ error: 'AI 策略生成失败，请稍后重试' }, { status: 500 });
  }

  return NextResponse.json(strategy);
}

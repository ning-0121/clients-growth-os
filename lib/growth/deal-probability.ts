import { SupabaseClient } from '@supabase/supabase-js';

// ── Probability Stages ──

export type ProbabilityStage = 'cold' | 'slight_interest' | 'interested' | 'high_interest' | 'hot';

export function getStage(probability: number): ProbabilityStage {
  if (probability >= 81) return 'hot';
  if (probability >= 61) return 'high_interest';
  if (probability >= 41) return 'interested';
  if (probability >= 21) return 'slight_interest';
  return 'cold';
}

export const STAGE_CONFIG: Record<ProbabilityStage, { label: string; labelCn: string; color: string; bgColor: string }> = {
  cold:             { label: 'Cold',           labelCn: '冷客户',   color: 'text-gray-600',   bgColor: 'bg-gray-100' },
  slight_interest:  { label: 'Slight Interest', labelCn: '微兴趣',   color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  interested:       { label: 'Interested',     labelCn: '有兴趣',   color: 'text-blue-700',   bgColor: 'bg-blue-100' },
  high_interest:    { label: 'High Interest',  labelCn: '高兴趣',   color: 'text-orange-700', bgColor: 'bg-orange-100' },
  hot:              { label: 'Hot',            labelCn: '高概率成交', color: 'text-green-700',  bgColor: 'bg-green-100' },
};

// ── Behavior Scoring Factors ──

interface ScoringEvent {
  type: string;
  delta: number;
  reason: string;
}

/**
 * Calculate all scoring events for a lead based on its current data.
 * Returns the total engagement score (sum of all positive factors).
 */
export function calculateEngagementScore(lead: Record<string, any>, actions: any[], emails: any[], conversations: any[]): {
  score: number;
  events: ScoringEvent[];
} {
  const events: ScoringEvent[] = [];

  // ── Background factors (don't decay) ──
  const ai = lead.ai_analysis;
  if (ai) {
    if (ai.is_apparel_company && ai.product_fit_score > 70) {
      events.push({ type: 'ai_fit', delta: 8, reason: `AI匹配度${ai.product_fit_score}%` });
    }
    if (ai.scale_estimate === 'large') {
      events.push({ type: 'scale_large', delta: 10, reason: '大型企业' });
    } else if (ai.scale_estimate === 'medium') {
      events.push({ type: 'scale_medium', delta: 5, reason: '中型企业' });
    }
    if (ai.company_type === 'brand' || ai.company_type === 'retailer') {
      events.push({ type: 'company_type', delta: 5, reason: `${ai.company_type}类型` });
    }
  }

  if (lead.website) {
    events.push({ type: 'has_website', delta: 5, reason: '有品牌网站' });
  }

  // Customs data
  const customs = lead.customs_summary;
  if (customs) {
    events.push({ type: 'has_customs', delta: 10, reason: '有海关采购记录' });
    if (customs.is_apparel_importer) {
      events.push({ type: 'apparel_importer', delta: 15, reason: '确认服装进口商' });
    }
    if (customs.total_value_usd > 100000) {
      events.push({ type: 'high_value_importer', delta: 10, reason: `年进口>$100k` });
    }
  }

  // ── Action-based factors ──
  const actionTypes = actions.map((a: any) => a.action_type);
  const actionCount = actions.length;
  const replyCount = actionTypes.filter((t: string) => t === 'reply').length;

  if (actionTypes.includes('reply')) {
    events.push({ type: 'has_reply', delta: 15, reason: '客户已回复' });
  }
  if (replyCount >= 3) {
    events.push({ type: 'multi_reply', delta: 10, reason: `多次回复(${replyCount}轮)` });
  }
  if (actionTypes.includes('call')) {
    events.push({ type: 'has_call', delta: 10, reason: '有通话记录' });
  }
  if (actionTypes.includes('promote')) {
    events.push({ type: 'promoted', delta: 20, reason: '已转为Deal' });
  }

  // Check action evidence for specific signals
  for (const action of actions) {
    const evidence = action.evidence_json || {};
    const note = (action.note || '').toLowerCase();
    const content = JSON.stringify(evidence).toLowerCase();
    const combined = note + ' ' + content;

    if (combined.includes('moq') || combined.includes('minimum order')) {
      events.push({ type: 'asked_moq', delta: 12, reason: '问了MOQ' });
      break;
    }
  }
  for (const action of actions) {
    const note = (action.note || '').toLowerCase();
    const content = JSON.stringify(action.evidence_json || {}).toLowerCase();
    const combined = note + ' ' + content;

    if (combined.includes('sample') || combined.includes('样品')) {
      events.push({ type: 'asked_sample', delta: 20, reason: '索要样品' });
      break;
    }
  }
  for (const action of actions) {
    const note = (action.note || '').toLowerCase();
    const content = JSON.stringify(action.evidence_json || {}).toLowerCase();
    const combined = note + ' ' + content;

    if (combined.includes('quote') || combined.includes('price') || combined.includes('报价')) {
      events.push({ type: 'asked_quote', delta: 18, reason: '索要报价' });
      break;
    }
  }
  for (const action of actions) {
    const note = (action.note || '').toLowerCase();
    const content = JSON.stringify(action.evidence_json || {}).toLowerCase();
    const combined = note + ' ' + content;

    if (combined.includes('payment') || combined.includes('付款') || combined.includes('t/t') || combined.includes('l/c')) {
      events.push({ type: 'asked_payment', delta: 15, reason: '讨论付款条件' });
      break;
    }
  }
  for (const action of actions) {
    const note = (action.note || '').toLowerCase();
    const content = JSON.stringify(action.evidence_json || {}).toLowerCase();
    const combined = note + ' ' + content;

    if (combined.includes('tech pack') || combined.includes('specification')) {
      events.push({ type: 'provided_techpack', delta: 25, reason: '提供了tech pack' });
      break;
    }
  }
  for (const action of actions) {
    const note = (action.note || '').toLowerCase();
    const content = JSON.stringify(action.evidence_json || {}).toLowerCase();
    const combined = note + ' ' + content;

    if (combined.includes('lead time') || combined.includes('delivery') || combined.includes('交期')) {
      events.push({ type: 'asked_leadtime', delta: 12, reason: '问了交期' });
      break;
    }
  }

  // ── Deal stage milestones ──
  // Check if there's a linked deal
  if (lead.deal_stage) {
    const stageScores: Record<string, number> = { '报价': 20, '样品': 30, '试单': 40, '大货': 50 };
    const stageScore = stageScores[lead.deal_stage] || 0;
    if (stageScore > 0) {
      events.push({ type: 'deal_stage', delta: stageScore, reason: `Deal阶段: ${lead.deal_stage}` });
    }
  }

  // ── Email engagement ──
  const openedEmails = emails.filter((e: any) => e.status === 'opened' || e.opened_at);
  const clickedEmails = emails.filter((e: any) => e.status === 'clicked');

  if (openedEmails.length > 0) {
    events.push({ type: 'email_opened', delta: 5, reason: `邮件已打开(${openedEmails.length}封)` });
  }
  if (clickedEmails.length > 0) {
    events.push({ type: 'email_clicked', delta: 8, reason: `邮件链接被点击` });
  }

  // ── Conversation engagement ──
  const inboundMessages = conversations.filter((m: any) => m.direction === 'inbound');
  if (inboundMessages.length > 0) {
    events.push({ type: 'has_conversation', delta: 12, reason: `客户主动联系(${inboundMessages.length}条消息)` });
  }

  // ── Order value ──
  if (lead.estimated_order_value) {
    const val = Number(lead.estimated_order_value);
    if (val > 50000) events.push({ type: 'high_value', delta: 15, reason: `订单>$50k` });
    else if (val > 10000) events.push({ type: 'medium_value', delta: 10, reason: `订单>$10k` });
  }

  // Deduplicate by type (keep first of each type)
  const seen = new Set<string>();
  const uniqueEvents = events.filter(e => {
    if (seen.has(e.type)) return false;
    seen.add(e.type);
    return true;
  });

  const score = uniqueEvents.reduce((sum, e) => sum + e.delta, 0);
  return { score, events: uniqueEvents };
}

// ── Time Decay ──

export function calculateTimeDecay(lastEngagement: Date | null, now: Date): number {
  if (!lastEngagement) return -25; // Never engaged

  const daysSince = Math.floor((now.getTime() - lastEngagement.getTime()) / (86400000));

  if (daysSince <= 3) return 0;
  if (daysSince <= 7) return -3;
  if (daysSince <= 14) return -8;
  if (daysSince <= 30) return -15;
  return -25;
}

// ── Probability Calculation ──

export function calculateProbability(
  engagementScore: number,
  timeDecay: number
): number {
  // Base probability from engagement
  const raw = engagementScore + timeDecay;
  return Math.max(0, Math.min(100, raw));
}

// ── Next Action Recommendation ──

export interface ActionRecommendation {
  action: string;
  actionCn: string;
  reason: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

export function recommendNextAction(
  lead: Record<string, any>,
  probability: number,
  stage: ProbabilityStage,
  engagementEvents: ScoringEvent[],
  daysSinceEngagement: number
): ActionRecommendation {
  const eventTypes = new Set(engagementEvents.map(e => e.type));

  // P0: Urgent actions
  if (eventTypes.has('asked_sample')) {
    return { action: 'confirm_sample', actionCn: '确认样品细节+寄样', reason: '客户索要样品，趁热打铁', priority: 'P0' };
  }
  if (eventTypes.has('asked_quote') && daysSinceEngagement > 7) {
    return { action: 'follow_up_quote', actionCn: '跟进报价（调整角度）', reason: '报价后7天未回复，可能价格卡住', priority: 'P0' };
  }
  if (eventTypes.has('asked_moq')) {
    return { action: 'send_quote', actionCn: '发报价方案', reason: '客户问了MOQ，该报价了', priority: 'P0' };
  }
  if (lead.deal_stage === '试单') {
    return { action: 'push_bulk', actionCn: '推进大货排期', reason: '试单阶段，距离赢单一步之遥', priority: 'P0' };
  }
  if (lead.deal_stage === '样品' && daysSinceEngagement > 14) {
    return { action: 'call_sample_feedback', actionCn: '电话跟进样品反馈', reason: '样品寄出14天无反馈', priority: 'P0' };
  }
  if (probability > 60 && (lead.estimated_order_value || 0) > 20000) {
    return { action: 'escalate', actionCn: '升级给高级销售/老板', reason: '高概率+大金额，需要高层介入', priority: 'P0' };
  }

  // P1: Important actions
  if (eventTypes.has('email_opened') && !eventTypes.has('has_reply')) {
    return { action: 'social_follow_up', actionCn: 'LinkedIn/IG/WhatsApp跟进', reason: '邮件已打开但未回复，换渠道突破', priority: 'P1' };
  }
  if (eventTypes.has('has_reply') && !eventTypes.has('asked_quote')) {
    return { action: 'send_lookbook', actionCn: '发lookbook/产品目录', reason: '已回复但未问价格，激发兴趣', priority: 'P1' };
  }
  if (eventTypes.has('multi_reply') && daysSinceEngagement > 7) {
    return { action: 'video_meeting', actionCn: '约视频会议', reason: '多次回复但拖延，面对面加速决策', priority: 'P1' };
  }

  // P2: Follow-up actions
  if (daysSinceEngagement > 14 && daysSinceEngagement <= 30) {
    return { action: 'reactivate', actionCn: '发送重新激活模板', reason: '沉默超14天，温和唤醒', priority: 'P2' };
  }

  // P3: Nurture
  if (daysSinceEngagement > 30) {
    return { action: 'nurture', actionCn: '进入nurture池', reason: '沉默超30天，降低频率长期培养', priority: 'P3' };
  }

  // Default
  if (stage === 'cold') {
    return { action: 'initial_outreach', actionCn: '首次开发信', reason: '新线索，需要首次触达', priority: 'P2' };
  }

  return { action: 'follow_up', actionCn: '常规跟进', reason: '保持联系', priority: 'P2' };
}

// ── Escalation Logic ──

export function calculateEscalation(
  lead: Record<string, any>,
  probability: number,
  engagementEvents: ScoringEvent[]
): number {
  const eventTypes = new Set(engagementEvents.map(e => e.type));
  let triggers = 0;

  // High-weight triggers
  if (lead.customs_summary?.total_value_usd > 50000) triggers++;
  if (lead.customs_summary?.total_records > 12) triggers++; // Long-term importer
  if (lead.deal_stage === '样品' || lead.deal_stage === '试单' || lead.deal_stage === '大货') triggers++;
  if (eventTypes.has('asked_payment')) triggers++;
  if ((lead.estimated_order_value || 0) > 30000) triggers++;

  // Medium-weight triggers
  if (lead.ai_analysis?.scale_estimate === 'large') triggers++;
  if (eventTypes.has('multi_reply')) triggers++;
  if (probability > 70) triggers++;

  if (triggers >= 4) return 2; // Boss/Su level
  if (triggers >= 2) return 1; // Senior sales
  return 0;
}

// ── Full Probability Calculation for a Single Lead ──

export async function recalculateLeadProbability(
  leadId: string,
  supabase: SupabaseClient
): Promise<{ probability: number; stage: ProbabilityStage; changed: boolean }> {
  // Fetch lead with deal info
  const { data: lead } = await supabase
    .from('growth_leads')
    .select('*, growth_deals(deal_stage, status, estimated_order_value)')
    .eq('id', leadId)
    .single();

  if (!lead) return { probability: 0, stage: 'cold', changed: false };

  // Attach deal info to lead for scoring
  const deal = (lead as any).growth_deals?.[0];
  if (deal) {
    lead.deal_stage = deal.deal_stage;
    lead.estimated_order_value = lead.estimated_order_value || deal.estimated_order_value;
  }

  // Fetch actions
  const { data: actions } = await supabase
    .from('growth_lead_actions')
    .select('action_type, note, evidence_json, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch outreach emails
  const { data: emails } = await supabase
    .from('outreach_emails')
    .select('status, opened_at, sent_at')
    .eq('lead_id', leadId);

  // Fetch conversation messages
  const { data: convos } = await supabase
    .from('conversations')
    .select('id')
    .eq('lead_id', leadId);

  let messages: any[] = [];
  if (convos && convos.length > 0) {
    const { data: msgs } = await supabase
      .from('conversation_messages')
      .select('direction, created_at')
      .in('conversation_id', convos.map((c: any) => c.id));
    messages = msgs || [];
  }

  // Calculate engagement
  const { score: engagementScore, events } = calculateEngagementScore(
    lead, actions || [], emails || [], messages
  );

  // Determine last engagement time
  const lastEngagement = lead.last_engagement_at
    ? new Date(lead.last_engagement_at)
    : lead.last_action_at
    ? new Date(lead.last_action_at)
    : lead.first_touch_at
    ? new Date(lead.first_touch_at)
    : null;

  const now = new Date();
  const timeDecay = calculateTimeDecay(lastEngagement, now);
  const probability = calculateProbability(engagementScore, timeDecay);
  const stage = getStage(probability);
  const oldProbability = lead.deal_probability || 0;
  const oldStage = lead.probability_stage || 'cold';

  // Calculate days since engagement
  const daysSinceEngagement = lastEngagement
    ? Math.floor((now.getTime() - lastEngagement.getTime()) / 86400000)
    : 999;

  // Get recommended action
  const recommendation = recommendNextAction(lead, probability, stage, events, daysSinceEngagement);

  // Calculate escalation
  const escalationLevel = calculateEscalation(lead, probability, events);

  // Check if reactivation needed
  const reactivationNeeded = probability < 20 && oldProbability >= 40;

  const changed = probability !== oldProbability;

  // Update lead
  await supabase
    .from('growth_leads')
    .update({
      deal_probability: probability,
      probability_stage: stage,
      engagement_score: engagementScore,
      risk_score: Math.abs(timeDecay),
      next_recommended_action: recommendation.actionCn,
      next_action_reason: recommendation.reason,
      escalation_level: escalationLevel,
      reactivation_needed: reactivationNeeded,
      probability_updated_at: now.toISOString(),
    })
    .eq('id', leadId);

  // Log event if probability changed significantly (>= 5 points)
  if (Math.abs(probability - oldProbability) >= 5) {
    await supabase.from('deal_probability_events').insert({
      lead_id: leadId,
      event_type: probability > oldProbability ? 'increase' : 'decrease',
      score_delta: probability - oldProbability,
      old_probability: oldProbability,
      new_probability: probability,
      old_stage: oldStage,
      new_stage: stage,
      reason: events.slice(0, 3).map(e => e.reason).join(', ') || (timeDecay < -10 ? '长时间无互动' : '概率重算'),
      metadata: { engagement_score: engagementScore, time_decay: timeDecay, recommendation },
    });
  }

  return { probability, stage, changed };
}

// ── Batch Recalculation ──

export async function recalculateAllProbabilities(
  supabase: SupabaseClient,
  batchSize = 50
): Promise<{ processed: number; changed: number }> {
  const { data: leads } = await supabase
    .from('growth_leads')
    .select('id')
    .in('status', ['new', 'qualified', 'converted'])
    .order('probability_updated_at', { ascending: true, nullsFirst: true })
    .limit(batchSize);

  if (!leads || leads.length === 0) return { processed: 0, changed: 0 };

  let changed = 0;
  for (const lead of leads) {
    const result = await recalculateLeadProbability(lead.id, supabase);
    if (result.changed) changed++;
  }

  return { processed: leads.length, changed };
}

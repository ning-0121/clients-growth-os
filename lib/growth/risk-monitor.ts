/**
 * 客户风险监控引擎
 *
 * 实时监控所有活跃客户和商机的风险信号:
 * 1. 客户冷掉风险 — 互动频率下降
 * 2. 丢单风险 — deal 停滞不前
 * 3. 竞争风险 — 客户在找其他供应商
 * 4. 信用风险 — 公司出现负面信息
 * 5. 跟进遗漏风险 — 销售没按时跟进
 * 6. 联系方式失效风险 — 邮箱退信/电话不通
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface RiskAlert {
  lead_id: string;
  company_name: string;
  risk_type: 'cooling' | 'stalling' | 'competition' | 'credit' | 'neglect' | 'contact_invalid' | 'deadline';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  suggested_action: string;
  days_since_activity: number | null;
  created_at: string;
}

/**
 * 扫描所有活跃线索和商机，检测风险信号
 */
export async function scanAllRisks(supabase: SupabaseClient): Promise<RiskAlert[]> {
  const alerts: RiskAlert[] = [];
  const now = new Date();

  // Get all active leads with their deal info
  const { data: leads } = await supabase
    .from('growth_leads')
    .select('id, company_name, status, last_action_at, next_action_due, action_count, first_touch_at, contact_email, outreach_status, deal_probability, assigned_to, verification_status')
    .in('status', ['new', 'qualified', 'converted']);

  // Get all active deals
  const { data: deals } = await supabase
    .from('growth_deals')
    .select('id, lead_id, customer_name, deal_stage, status, created_at, updated_at, estimated_order_value')
    .eq('status', 'active');

  // Get bounced emails
  const { data: bouncedEmails } = await supabase
    .from('outreach_emails')
    .select('lead_id')
    .eq('status', 'bounced');

  const bouncedLeadIds = new Set((bouncedEmails || []).map((e: any) => e.lead_id));

  for (const lead of (leads || [])) {
    const daysSinceAction = lead.last_action_at
      ? Math.floor((now.getTime() - new Date(lead.last_action_at).getTime()) / 86400000)
      : lead.first_touch_at
      ? Math.floor((now.getTime() - new Date(lead.first_touch_at).getTime()) / 86400000)
      : null;

    const daysSinceDue = lead.next_action_due
      ? Math.floor((now.getTime() - new Date(lead.next_action_due).getTime()) / 86400000)
      : null;

    // ── Risk 1: 客户冷掉 ──
    if (daysSinceAction !== null) {
      if (daysSinceAction >= 30) {
        alerts.push({
          lead_id: lead.id,
          company_name: lead.company_name,
          risk_type: 'cooling',
          severity: 'critical',
          title: `${lead.company_name} 已30天无互动`,
          detail: `最后互动在 ${daysSinceAction} 天前，客户正在冷掉`,
          suggested_action: '立即发送重新激活邮件或换人跟进',
          days_since_activity: daysSinceAction,
          created_at: now.toISOString(),
        });
      } else if (daysSinceAction >= 14) {
        alerts.push({
          lead_id: lead.id,
          company_name: lead.company_name,
          risk_type: 'cooling',
          severity: 'high',
          title: `${lead.company_name} 14天未互动`,
          detail: `最后互动在 ${daysSinceAction} 天前，再不跟进就冷了`,
          suggested_action: '换个渠道联系（电话/WhatsApp/LinkedIn），别再只发邮件',
          days_since_activity: daysSinceAction,
          created_at: now.toISOString(),
        });
      } else if (daysSinceAction >= 7 && lead.deal_probability > 40) {
        alerts.push({
          lead_id: lead.id,
          company_name: lead.company_name,
          risk_type: 'cooling',
          severity: 'medium',
          title: `${lead.company_name} 高潜客户7天未互动`,
          detail: `概率 ${lead.deal_probability}% 但已 ${daysSinceAction} 天没互动`,
          suggested_action: '这个客户有价值，赶紧跟进别丢了',
          days_since_activity: daysSinceAction,
          created_at: now.toISOString(),
        });
      }
    }

    // ── Risk 2: 跟进遗漏 ──
    if (daysSinceDue !== null && daysSinceDue > 0) {
      const severity = daysSinceDue >= 7 ? 'critical' : daysSinceDue >= 3 ? 'high' : 'medium';
      alerts.push({
        lead_id: lead.id,
        company_name: lead.company_name,
        risk_type: 'neglect',
        severity,
        title: `${lead.company_name} 跟进已逾期 ${daysSinceDue} 天`,
        detail: `计划跟进日期已过 ${daysSinceDue} 天，客户可能觉得我们不专业`,
        suggested_action: daysSinceDue >= 7 ? '立即联系并道歉延迟回复' : '今天必须跟进',
        days_since_activity: daysSinceAction,
        created_at: now.toISOString(),
      });
    }

    // ── Risk 3: 邮箱退信 ──
    if (bouncedLeadIds.has(lead.id)) {
      alerts.push({
        lead_id: lead.id,
        company_name: lead.company_name,
        risk_type: 'contact_invalid',
        severity: 'high',
        title: `${lead.company_name} 邮箱退信`,
        detail: '发送的开发信被退回，邮箱可能无效',
        suggested_action: '通过LinkedIn/IG/网站重新寻找有效联系方式',
        days_since_activity: daysSinceAction,
        created_at: now.toISOString(),
      });
    }

    // ── Risk 4: 首触太慢 ──
    if (!lead.first_touch_at && lead.action_count === 0) {
      const daysSinceAssign = lead.last_action_at ? null :
        Math.floor((now.getTime() - new Date(lead.created_at || now).getTime()) / 86400000);

      if (daysSinceAssign && daysSinceAssign >= 3) {
        alerts.push({
          lead_id: lead.id,
          company_name: lead.company_name,
          risk_type: 'neglect',
          severity: daysSinceAssign >= 7 ? 'high' : 'medium',
          title: `${lead.company_name} 分配后 ${daysSinceAssign} 天未首触`,
          detail: '线索分配后一直没有联系，热度在下降',
          suggested_action: '立即发送首次开发信或社交媒体触达',
          days_since_activity: daysSinceAssign,
          created_at: now.toISOString(),
        });
      }
    }
  }

  // ── Risk 5: Deal 停滞 ──
  for (const deal of (deals || [])) {
    const daysSinceUpdate = Math.floor((now.getTime() - new Date(deal.updated_at).getTime()) / 86400000);

    if (daysSinceUpdate >= 21) {
      alerts.push({
        lead_id: deal.lead_id || '',
        company_name: deal.customer_name,
        risk_type: 'stalling',
        severity: 'critical',
        title: `商机「${deal.customer_name}」停滞 ${daysSinceUpdate} 天`,
        detail: `${deal.deal_stage} 阶段已 ${daysSinceUpdate} 天没推进，金额 $${deal.estimated_order_value?.toLocaleString() || '?'}`,
        suggested_action: '约视频会议了解卡住的原因，或升级给老板介入',
        days_since_activity: daysSinceUpdate,
        created_at: now.toISOString(),
      });
    } else if (daysSinceUpdate >= 14) {
      alerts.push({
        lead_id: deal.lead_id || '',
        company_name: deal.customer_name,
        risk_type: 'stalling',
        severity: 'high',
        title: `商机「${deal.customer_name}」${deal.deal_stage}阶段停滞`,
        detail: `已 ${daysSinceUpdate} 天没推进`,
        suggested_action: '主动联系推进：发样品方案/调整报价/约视频会',
        days_since_activity: daysSinceUpdate,
        created_at: now.toISOString(),
      });
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

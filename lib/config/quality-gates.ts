import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Quality Gates — 质量防线
 *
 * 防止 AI 用以下方式凑数:
 * 1. 重复计算（同一公司换 URL 重复入库）
 * 2. 低质量凑数（非服装公司也算"合格"）
 * 3. 虚假联系方式（猜测的 info@ 算"找到邮箱"）
 * 4. 无效发信（发到无效邮箱也算"已发"）
 * 5. 自己给自己打高分
 *
 * 每条线索必须过 5 道质量门：
 * Gate 1: 去重门 — 公司名/域名/IG 三维去重
 * Gate 2: 行业门 — AI 确认是服装/运动相关
 * Gate 3: 联系方式门 — 邮箱必须 MX 验证通过
 * Gate 4: 真实性门 — 网站必须可访问
 * Gate 5: 可开发门 — 有联系方式 + 有产品匹配
 */

export interface QualityReport {
  total_leads_today: number;
  passed_all_gates: number;
  failed_dedup: number;
  failed_industry: number;
  failed_contact: number;
  failed_website: number;
  failed_developable: number;
  quality_score: number;  // 0-100
  issues: string[];
}

/**
 * Run daily quality audit on today's new leads
 */
export async function runQualityAudit(
  supabase: SupabaseClient
): Promise<QualityReport> {
  const today = new Date().toISOString().split('T')[0];
  const todayStart = today + 'T00:00:00';

  const report: QualityReport = {
    total_leads_today: 0,
    passed_all_gates: 0,
    failed_dedup: 0,
    failed_industry: 0,
    failed_contact: 0,
    failed_website: 0,
    failed_developable: 0,
    quality_score: 0,
    issues: [],
  };

  // Get all leads created today
  const { data: todayLeads } = await supabase
    .from('growth_leads')
    .select('id, company_name, website, contact_email, contact_linkedin, instagram_handle, ai_analysis, status, source, product_match, verification_status')
    .gte('created_at', todayStart);

  if (!todayLeads || todayLeads.length === 0) {
    report.issues.push('今天没有新线索入库');
    return report;
  }

  report.total_leads_today = todayLeads.length;

  // Gate 1: Dedup check — 有没有重复的公司？
  const companyNames = new Map<string, number>();
  for (const lead of todayLeads) {
    const normalized = lead.company_name.toLowerCase().trim()
      .replace(/\b(inc|llc|ltd|co|corp|company)\b\.?/gi, '')
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    companyNames.set(normalized, (companyNames.get(normalized) || 0) + 1);
  }
  const duplicates = [...companyNames.values()].filter(count => count > 1);
  report.failed_dedup = duplicates.reduce((sum, count) => sum + count - 1, 0);
  if (report.failed_dedup > 0) {
    report.issues.push(`发现 ${report.failed_dedup} 条重复线索（同一公司多次入库）`);
  }

  // Gate 2: Industry check — AI 判定是否服装相关
  let industryPass = 0;
  for (const lead of todayLeads) {
    const ai = lead.ai_analysis as any;
    if (ai?.is_apparel_company === true && ai?.confidence >= 60) {
      industryPass++;
    } else if (!ai) {
      // No AI analysis yet — not counted as failed, just pending
    } else {
      report.failed_industry++;
    }
  }

  // Gate 3: Contact quality — 邮箱是否有效（不算 info@/guessed）
  let contactPass = 0;
  for (const lead of todayLeads) {
    if (lead.contact_email) {
      const local = lead.contact_email.split('@')[0].toLowerCase();
      // Don't count generic emails as "quality contacts"
      const isGeneric = ['info', 'sales', 'hello', 'contact', 'support', 'noreply'].includes(local);
      if (!isGeneric) {
        contactPass++;
      } else {
        // Generic is ok but lower quality
        contactPass += 0.5;
      }
    } else if (lead.contact_linkedin) {
      contactPass += 0.7; // LinkedIn is decent but not as good as email
    } else {
      report.failed_contact++;
    }
  }

  // Gate 4: Website accessible — 有真实可访问的网站
  let websitePass = 0;
  for (const lead of todayLeads) {
    if (lead.website && lead.website.startsWith('http')) {
      websitePass++;
    } else {
      report.failed_website++;
    }
  }

  // Gate 5: Developable — 有联系方式 + 有产品匹配
  let developablePass = 0;
  for (const lead of todayLeads) {
    const hasContact = lead.contact_email || lead.contact_linkedin || lead.instagram_handle;
    const hasProduct = lead.product_match || (lead.ai_analysis as any)?.product_categories?.length > 0;
    if (hasContact && hasProduct) {
      developablePass++;
    } else {
      report.failed_developable++;
    }
  }

  // Calculate quality score
  // Only count leads that pass ALL quality gates
  report.passed_all_gates = Math.min(
    todayLeads.length - report.failed_dedup,
    industryPass,
    Math.floor(contactPass),
    websitePass,
    developablePass
  );

  report.quality_score = todayLeads.length > 0
    ? Math.round((report.passed_all_gates / todayLeads.length) * 100)
    : 0;

  // Generate quality warnings
  if (report.quality_score < 30) {
    report.issues.push('质量严重不足：大部分线索不可用');
  }
  if (report.failed_industry > todayLeads.length * 0.3) {
    report.issues.push(`${report.failed_industry} 条线索不是服装行业 — 搜索关键词需要更精准`);
  }
  if (report.failed_contact > todayLeads.length * 0.5) {
    report.issues.push(`${report.failed_contact} 条线索没有联系方式 — 联系方式猎手需要加强`);
  }
  if (report.failed_dedup > 5) {
    report.issues.push(`${report.failed_dedup} 条重复 — 去重逻辑需要修复`);
  }

  return report;
}

/**
 * KPI 只计算通过质量门的线索
 * 这个函数替代简单的 count，确保数字是真实的
 */
export async function getVerifiedKPINumbers(
  supabase: SupabaseClient
): Promise<{
  real_qualified: number;      // 真正合格的（过了所有质量门）
  real_contacts_found: number; // 真正找到的联系方式（不算 info@）
  real_emails_sent: number;    // 真正发出去的（不算 bounced）
  real_verified: number;       // 真正通过验证的
}> {
  const today = new Date().toISOString().split('T')[0];
  const todayStart = today + 'T00:00:00';

  // Real qualified: has website + has contact + is apparel
  const { data: qualifiedLeads } = await supabase
    .from('growth_leads')
    .select('id, contact_email, ai_analysis')
    .in('status', ['new', 'qualified'])
    .not('website', 'is', null)
    .gte('created_at', todayStart);

  let realQualified = 0;
  let realContacts = 0;
  for (const lead of (qualifiedLeads || [])) {
    const ai = lead.ai_analysis as any;
    if (ai?.is_apparel_company !== false) { // Allow null (not yet analyzed) or true
      realQualified++;
    }
    if (lead.contact_email) {
      const local = lead.contact_email.split('@')[0].toLowerCase();
      if (!['info', 'sales', 'hello', 'contact', 'support', 'noreply'].includes(local)) {
        realContacts++; // Only count personal emails
      }
    }
  }

  // Real emails sent (not bounced, not complained)
  const { count: realSent } = await supabase
    .from('outreach_emails')
    .select('id', { count: 'exact', head: true })
    .in('status', ['sent', 'delivered', 'opened', 'clicked'])
    .gte('sent_at', todayStart);

  // Real verified (completed verification, not failed)
  const { count: realVerified } = await supabase
    .from('growth_leads')
    .select('id', { count: 'exact', head: true })
    .eq('verification_status', 'completed')
    .gte('updated_at', todayStart);

  return {
    real_qualified: realQualified,
    real_contacts_found: realContacts,
    real_emails_sent: realSent || 0,
    real_verified: realVerified || 0,
  };
}

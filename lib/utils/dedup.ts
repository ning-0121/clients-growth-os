/**
 * 数据去重引擎 — 多字段模糊匹配、域名归一化、公司名近似匹配
 *
 * 三层去重策略：
 * 1. 精确匹配: 域名/邮箱完全一致
 * 2. 域名归一化: www.example.com = example.com = https://example.com/about
 * 3. 公司名模糊匹配: "Nike Inc" ≈ "Nike, Inc." ≈ "NIKE"
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ── 域名归一化 ──

/**
 * 将 URL/域名归一化为统一格式: "example.com"
 */
export function normalizeDomain(input: string): string {
  if (!input) return '';
  let domain = input.toLowerCase().trim();

  // 移除协议
  domain = domain.replace(/^https?:\/\//, '');
  // 移除 www.
  domain = domain.replace(/^www\./, '');
  // 移除路径和参数
  domain = domain.split('/')[0].split('?')[0].split('#')[0];
  // 移除端口
  domain = domain.split(':')[0];

  return domain;
}

// ── 公司名标准化 ──

const COMPANY_SUFFIXES = [
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'ag', 'sa', 'srl', 'pty', 'pvt',
  'group', 'holdings', 'international', 'intl',
];

/**
 * 标准化公司名称用于比较
 * "Nike, Inc." → "nike"
 * "ADIDAS GROUP" → "adidas"
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return '';
  let normalized = name.toLowerCase().trim();

  // 移除标点
  normalized = normalized.replace(/[.,\-_'"()&!@#$%^*+=[\]{}|\\/<>:;]/g, ' ');

  // 移除公司后缀
  const words = normalized.split(/\s+/).filter(Boolean);
  const filtered = words.filter((w) => !COMPANY_SUFFIXES.includes(w));

  return filtered.join(' ').trim();
}

/**
 * 计算两个字符串的相似度 (0-1)
 * 使用 Jaccard 系数（基于字符 bigram）
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();

  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

// ── 去重检查 ──

export interface DeduplicationResult {
  isDuplicate: boolean;
  matchType?: 'exact_email' | 'exact_domain' | 'similar_name' | 'exact_phone';
  existingLeadId?: string;
  confidence: number; // 0-100
  existingCompanyName?: string;
}

/**
 * 检查一个线索是否与数据库中已有线索重复
 */
export async function checkDuplicate(
  supabase: SupabaseClient,
  lead: {
    company_name?: string;
    website?: string;
    contact_email?: string;
    contact_phone?: string;
    instagram_handle?: string;
  }
): Promise<DeduplicationResult> {

  // 1. 精确邮箱匹配
  if (lead.contact_email) {
    const email = lead.contact_email.toLowerCase().trim();
    const { data } = await supabase
      .from('growth_leads')
      .select('id, company_name')
      .ilike('contact_email', email)
      .limit(1);

    if (data?.length) {
      return {
        isDuplicate: true,
        matchType: 'exact_email',
        existingLeadId: data[0].id,
        existingCompanyName: data[0].company_name,
        confidence: 100,
      };
    }
  }

  // 2. 域名匹配
  if (lead.website) {
    const domain = normalizeDomain(lead.website);
    if (domain) {
      // 搜索包含此域名的所有网站
      const { data } = await supabase
        .from('growth_leads')
        .select('id, company_name, website')
        .not('website', 'is', null);

      if (data?.length) {
        for (const existing of data) {
          if (normalizeDomain(existing.website) === domain) {
            return {
              isDuplicate: true,
              matchType: 'exact_domain',
              existingLeadId: existing.id,
              existingCompanyName: existing.company_name,
              confidence: 95,
            };
          }
        }
      }
    }
  }

  // 3. Instagram 匹配
  if (lead.instagram_handle) {
    const handle = lead.instagram_handle.toLowerCase().replace('@', '').trim();
    const { data } = await supabase
      .from('growth_leads')
      .select('id, company_name')
      .ilike('instagram_handle', handle)
      .limit(1);

    if (data?.length) {
      return {
        isDuplicate: true,
        matchType: 'exact_domain',
        existingLeadId: data[0].id,
        existingCompanyName: data[0].company_name,
        confidence: 90,
      };
    }
  }

  // 4. 公司名模糊匹配
  if (lead.company_name) {
    const normalizedName = normalizeCompanyName(lead.company_name);
    if (normalizedName.length >= 3) {
      // 搜索可能匹配的公司名
      const searchTerm = normalizedName.split(' ')[0]; // 用第一个词搜索
      const { data } = await supabase
        .from('growth_leads')
        .select('id, company_name')
        .ilike('company_name', `%${searchTerm}%`)
        .limit(20);

      if (data?.length) {
        for (const existing of data) {
          const existingNormalized = normalizeCompanyName(existing.company_name);
          const sim = similarity(normalizedName, existingNormalized);

          if (sim >= 0.85) {
            return {
              isDuplicate: true,
              matchType: 'similar_name',
              existingLeadId: existing.id,
              existingCompanyName: existing.company_name,
              confidence: Math.round(sim * 100),
            };
          }
        }
      }
    }
  }

  return { isDuplicate: false, confidence: 0 };
}

/**
 * 批量去重 — 返回去重后的新线索列表和跳过的重复项
 */
export async function deduplicateBatch(
  supabase: SupabaseClient,
  leads: {
    company_name?: string;
    website?: string;
    contact_email?: string;
    instagram_handle?: string;
  }[]
): Promise<{
  unique: typeof leads;
  duplicates: { lead: typeof leads[number]; match: DeduplicationResult }[];
}> {
  const unique: typeof leads = [];
  const duplicates: { lead: typeof leads[number]; match: DeduplicationResult }[] = [];

  // 内部去重（批次内互相比较）
  const seenDomains = new Set<string>();
  const seenEmails = new Set<string>();
  const seenNames = new Set<string>();

  for (const lead of leads) {
    // 批次内去重
    const domain = lead.website ? normalizeDomain(lead.website) : '';
    const email = lead.contact_email?.toLowerCase().trim() || '';
    const name = normalizeCompanyName(lead.company_name || '');

    if ((domain && seenDomains.has(domain)) ||
        (email && seenEmails.has(email))) {
      duplicates.push({ lead, match: { isDuplicate: true, matchType: 'exact_domain', confidence: 100 } });
      continue;
    }

    // 跟公司名做批次内模糊匹配
    let batchDup = false;
    for (const seen of seenNames) {
      if (similarity(name, seen) >= 0.85) {
        duplicates.push({ lead, match: { isDuplicate: true, matchType: 'similar_name', confidence: 90 } });
        batchDup = true;
        break;
      }
    }
    if (batchDup) continue;

    // 数据库去重
    const result = await checkDuplicate(supabase, lead);
    if (result.isDuplicate) {
      duplicates.push({ lead, match: result });
    } else {
      unique.push(lead);
      if (domain) seenDomains.add(domain);
      if (email) seenEmails.add(email);
      if (name) seenNames.add(name);
    }
  }

  return { unique, duplicates };
}

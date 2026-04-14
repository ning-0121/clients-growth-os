/**
 * 数据清洗管道 — 标准化、校验、过滤垃圾数据
 *
 * 流程:
 * 1. 格式标准化（URL、邮箱、电话、公司名）
 * 2. 字段校验（必填项、格式验证）
 * 3. 垃圾数据过滤（黑名单域名、一次性邮箱、明显假数据）
 * 4. 质量评分（数据完整度打分）
 */

import { normalizeDomain, normalizeCompanyName } from './dedup';

// ── 垃圾邮箱域名（一次性邮箱/无效域名）──

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'tempmail.com', 'throwaway.email', 'guerrillamail.com', 'sharklasers.com',
  'mailinator.com', 'yopmail.com', 'temp-mail.org', 'fakeinbox.com',
  'dispostable.com', 'trashmail.com', 'maildrop.cc', 'getairmail.com',
  '10minutemail.com', 'tempail.com', 'emailondeck.com',
]);

// ── 不可联系的邮箱前缀 ──

const NOREPLY_PREFIXES = [
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster', 'bounce', 'automated', 'info@',
  'hello@', 'support@', 'admin@', 'webmaster@', 'contact@',
];

// ── 明显不是真实公司的关键词 ──

const FAKE_COMPANY_SIGNALS = [
  'test', 'example', 'demo', 'sample', 'lorem', 'ipsum',
  'asdf', 'qwerty', '123', 'xxx', 'fake', 'null', 'undefined',
  'n/a', 'none', 'unknown', 'tbd', 'todo',
];

// ── 清洗结果 ──

export interface CleanedLead {
  company_name: string;
  website: string | null;
  contact_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  instagram_handle: string | null;
  contact_linkedin: string | null;
  product_match: string | null;
  source: string;
  dataQualityScore: number;        // 0-100 数据完整度
  cleaningNotes: string[];         // 清洗过程记录
  isValid: boolean;                // 是否通过基本校验
  rejectionReason?: string;        // 如果无效，原因
}

/**
 * 清洗单条线索数据
 */
export function cleanLead(raw: Record<string, unknown>): CleanedLead {
  const notes: string[] = [];
  let isValid = true;
  let rejectionReason: string | undefined;

  // ── 1. 公司名清洗 ──
  let companyName = String(raw.company_name || '').trim();

  // 移除多余空格
  companyName = companyName.replace(/\s+/g, ' ');

  // 检查是否为假数据
  const lowerName = companyName.toLowerCase();
  if (FAKE_COMPANY_SIGNALS.some((s) => lowerName === s || lowerName.startsWith(s + ' '))) {
    isValid = false;
    rejectionReason = `公司名疑似虚假: "${companyName}"`;
  }

  if (companyName.length < 2) {
    isValid = false;
    rejectionReason = '公司名过短或缺失';
  }

  // ── 2. 网站清洗 ──
  let website = raw.website ? String(raw.website).trim() : null;
  if (website) {
    // 补全协议
    if (!website.startsWith('http')) {
      website = `https://${website}`;
    }
    // 移除尾部斜杠
    website = website.replace(/\/+$/, '');

    // 检查域名有效性
    const domain = normalizeDomain(website);
    if (!domain || !domain.includes('.') || domain.length < 4) {
      notes.push(`网站无效已移除: ${website}`);
      website = null;
    }
  }

  // ── 3. 邮箱清洗 ──
  let contactEmail = raw.contact_email ? String(raw.contact_email).toLowerCase().trim() : null;
  if (contactEmail) {
    // 基本格式检查
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      notes.push(`邮箱格式无效已移除: ${contactEmail}`);
      contactEmail = null;
    } else {
      const emailDomain = contactEmail.split('@')[1];

      // 检查一次性邮箱
      if (DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
        notes.push(`一次性邮箱已移除: ${contactEmail}`);
        contactEmail = null;
      }

      // 检查 noreply 邮箱
      if (contactEmail && NOREPLY_PREFIXES.some((p) => contactEmail!.startsWith(p))) {
        notes.push(`通用邮箱标记: ${contactEmail}（非个人邮箱）`);
        // 不移除，但降低质量分
      }
    }
  }

  // ── 4. 联系人姓名清洗 ──
  let contactName = raw.contact_name ? String(raw.contact_name).trim() : null;
  if (contactName) {
    contactName = contactName.replace(/\s+/g, ' ');
    if (contactName.length < 2 || FAKE_COMPANY_SIGNALS.some((s) => contactName!.toLowerCase() === s)) {
      notes.push(`联系人姓名无效已移除: ${contactName}`);
      contactName = null;
    }
  }

  // ── 5. 电话清洗 ──
  let contactPhone = raw.contact_phone ? String(raw.contact_phone).trim() : null;
  if (contactPhone) {
    // 移除非数字字符（保留+号）
    contactPhone = contactPhone.replace(/[^\d+]/g, '');
    if (contactPhone.length < 7 || contactPhone.length > 15) {
      notes.push(`电话号码无效已移除: ${contactPhone}`);
      contactPhone = null;
    }
  }

  // ── 6. Instagram清洗 ──
  let instagram = raw.instagram_handle ? String(raw.instagram_handle).trim() : null;
  if (instagram) {
    instagram = instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
    if (instagram.length < 2) {
      instagram = null;
    }
  }

  // ── 7. LinkedIn清洗 ──
  let linkedin = raw.contact_linkedin ? String(raw.contact_linkedin).trim() : null;
  if (linkedin) {
    // 确保是 LinkedIn URL
    if (!linkedin.includes('linkedin.com')) {
      linkedin = `https://linkedin.com/company/${linkedin}`;
    }
  }

  // ── 8. 数据质量评分 ──
  let qualityScore = 0;
  if (companyName && companyName.length >= 3) qualityScore += 20;  // 有效公司名
  if (website) qualityScore += 20;                                  // 有网站
  if (contactEmail) qualityScore += 25;                             // 有邮箱
  if (contactName) qualityScore += 15;                              // 有联系人
  if (instagram || linkedin) qualityScore += 10;                    // 有社媒
  if (raw.product_match) qualityScore += 10;                        // 有产品匹配

  // 降分因素
  if (contactEmail && NOREPLY_PREFIXES.some((p) => contactEmail!.startsWith(p))) {
    qualityScore -= 10; // 通用邮箱扣分
  }
  if (!website && !contactEmail) {
    qualityScore -= 20; // 既没网站也没邮箱
  }

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  return {
    company_name: companyName,
    website,
    contact_email: contactEmail,
    contact_name: contactName,
    contact_phone: contactPhone,
    instagram_handle: instagram,
    contact_linkedin: linkedin,
    product_match: raw.product_match ? String(raw.product_match) : null,
    source: String(raw.source || 'unknown'),
    dataQualityScore: qualityScore,
    cleaningNotes: notes,
    isValid,
    rejectionReason,
  };
}

/**
 * 批量清洗线索 — 返回有效/无效两个列表
 */
export function cleanBatch(
  raws: Record<string, unknown>[]
): { valid: CleanedLead[]; rejected: CleanedLead[] } {
  const valid: CleanedLead[] = [];
  const rejected: CleanedLead[] = [];

  for (const raw of raws) {
    const cleaned = cleanLead(raw);
    if (cleaned.isValid && cleaned.dataQualityScore >= 20) {
      valid.push(cleaned);
    } else {
      if (!cleaned.rejectionReason) {
        cleaned.rejectionReason = `数据质量分过低: ${cleaned.dataQualityScore}/100`;
      }
      rejected.push(cleaned);
    }
  }

  // 按质量分降序排列
  valid.sort((a, b) => b.dataQualityScore - a.dataQualityScore);

  return { valid, rejected };
}

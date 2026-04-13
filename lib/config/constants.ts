/**
 * Shared UI constants — colors, labels, and mappings used across pages.
 */

// ── Lead Grade Colors ──
export const GRADE_COLORS: Record<string, string> = {
  S: 'bg-purple-100 text-purple-700 border-purple-300',
  A: 'bg-green-100 text-green-700 border-green-300',
  B: 'bg-blue-100 text-blue-700 border-blue-300',
  C: 'bg-amber-100 text-amber-700 border-amber-300',
  D: 'bg-red-100 text-red-700 border-red-300',
};

// ── Lead Source Labels ──
export const SOURCE_LABELS: Record<string, { text: string; color: string }> = {
  ig: { text: 'IG', color: 'bg-pink-100 text-pink-700' },
  linkedin: { text: 'LI', color: 'bg-indigo-100 text-indigo-700' },
  website: { text: 'Web', color: 'bg-sky-100 text-sky-700' },
  customs: { text: '海关', color: 'bg-amber-100 text-amber-700' },
  referral: { text: '推荐', color: 'bg-green-100 text-green-700' },
  test_batch: { text: '测试', color: 'bg-gray-100 text-gray-500' },
  google: { text: 'Google', color: 'bg-blue-100 text-blue-700' },
  social_media: { text: '社媒', color: 'bg-orange-100 text-orange-700' },
  inbound: { text: '主动询盘', color: 'bg-teal-100 text-teal-700' },
};

// ── Lead Status Labels ──
export const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  new: { text: '新线索', color: 'bg-blue-100 text-blue-700' },
  verifying: { text: '验证中', color: 'bg-amber-100 text-amber-700' },
  verified: { text: '已验证', color: 'bg-green-100 text-green-700' },
  outreach: { text: '开发中', color: 'bg-indigo-100 text-indigo-700' },
  replied: { text: '已回复', color: 'bg-teal-100 text-teal-700' },
  deal: { text: '商机', color: 'bg-purple-100 text-purple-700' },
  lost: { text: '已流失', color: 'bg-red-100 text-red-700' },
  archived: { text: '已归档', color: 'bg-gray-100 text-gray-500' },
};

// ── Deal Stage Colors ──
export const STAGE_COLORS: Record<string, string> = {
  '报价': 'bg-gray-100 text-gray-700',
  '样品': 'bg-blue-100 text-blue-700',
  '试单': 'bg-amber-100 text-amber-700',
  '大货': 'bg-green-100 text-green-700',
};

// ── Deal Status Colors ──
export const DEAL_STATUS_COLORS: Record<string, { text: string; color: string }> = {
  active: { text: '进行中', color: 'bg-blue-100 text-blue-700' },
  won: { text: '已赢单', color: 'bg-green-100 text-green-700' },
  lost: { text: '已丢单', color: 'bg-red-100 text-red-700' },
};

// ── Channel Labels ──
export const CHANNEL_LABELS: Record<string, string> = {
  shopify_form: 'Shopify',
  whatsapp: 'WhatsApp',
  email: '邮件',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
};

// ── Client Pool Categories (客户分类) ──
export const CLIENT_CATEGORIES: Record<string, { text: string; color: string; description: string }> = {
  hot: { text: '热门客户', color: 'bg-red-100 text-red-700', description: '高匹配度，需立即跟进' },
  warm: { text: '温暖客户', color: 'bg-orange-100 text-orange-700', description: '有意向，需培育' },
  cold: { text: '冷线索', color: 'bg-blue-100 text-blue-700', description: '低意向，长期培育' },
  vip: { text: 'VIP客户', color: 'bg-purple-100 text-purple-700', description: '高价值大客户' },
  nurture: { text: '培育中', color: 'bg-green-100 text-green-700', description: '持续内容培育' },
};

// ── API Limits ──
export const API_LIMITS = {
  MAX_LEADS_PER_INTAKE: 200,
  DEFAULT_PAGE_SIZE: 100,
  MAX_OUTREACH_BATCH: 20,
  DEFAULT_OUTREACH_BATCH: 10,
  MAX_IG_ENGAGEMENTS_PER_DAY: 10,
  MAX_LINKEDIN_ENGAGEMENTS_PER_DAY: 20,
} as const;

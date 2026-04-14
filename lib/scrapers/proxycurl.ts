/**
 * Proxycurl API — LinkedIn 数据深度查询（合法第三方 API）
 *
 * 费用: ~$0.01/条个人资料，~$0.01/条公司资料
 * 注册: https://nubela.co/proxycurl → 免费10个信用点试用
 *
 * 使用策略:
 * - 不对所有线索都用（太贵）
 * - 只对 Google 筛选后的高质量线索（Grade A/S）使用
 * - 用于验证关键决策者信息和获取直接邮箱
 */

// ── 个人资料 ──

export interface ProxycurlPerson {
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  fullName: string;
  headline: string;           // 职位标题
  summary: string;            // 个人简介
  city: string;
  country: string;
  currentCompany: string;
  currentTitle: string;
  personalEmails: string[];   // 个人邮箱（高价值！）
  workEmail: string | null;   // 工作邮箱
  phoneNumbers: string[];
  experiences: {
    company: string;
    title: string;
    startDate: string;
    endDate: string | null;    // null = 目前在职
    description: string;
    companyLinkedIn: string | null;
  }[];
  skills: string[];
  connections: number | null;
}

// ── 公司资料 ──

export interface ProxycurlCompany {
  linkedinUrl: string;
  name: string;
  description: string;
  website: string;
  industry: string;
  companySize: string;         // "11-50", "51-200"
  companyType: string;         // "privately held", "public"
  founded: number | null;
  headquarters: string;
  specialties: string[];
  followerCount: number;
}

// ── API 调用 ──

const PROXYCURL_BASE = 'https://nubela.co/proxycurl/api';

/**
 * 查询 LinkedIn 个人资料
 * 费用: 1 credit (~$0.01)
 */
export async function getPersonProfile(linkedinUrl: string): Promise<ProxycurlPerson | null> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) {
    console.warn('[Proxycurl] PROXYCURL_API_KEY 未配置，跳过深度查询');
    return null;
  }

  try {
    const url = new URL(`${PROXYCURL_BASE}/v2/linkedin`);
    url.searchParams.set('linkedin_profile_url', linkedinUrl);
    url.searchParams.set('personal_email', 'include');        // 获取个人邮箱
    url.searchParams.set('personal_contact_number', 'include'); // 获取电话
    url.searchParams.set('skills', 'include');

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 404) return null;
    if (response.status === 402) {
      console.warn('[Proxycurl] 信用点不足');
      return null;
    }
    if (!response.ok) {
      console.error(`[Proxycurl] Person API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // 提取当前工作经历
    const currentExp = (data.experiences || []).find((e: Record<string, unknown>) => !e.ends_at);

    return {
      linkedinUrl,
      firstName: data.first_name || '',
      lastName: data.last_name || '',
      fullName: data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
      headline: data.headline || '',
      summary: data.summary || '',
      city: data.city || '',
      country: data.country_full_name || data.country || '',
      currentCompany: currentExp?.company || data.experiences?.[0]?.company || '',
      currentTitle: currentExp?.title || data.occupation || '',
      personalEmails: data.personal_emails || [],
      workEmail: data.work_email || null,
      phoneNumbers: data.personal_numbers || [],
      experiences: (data.experiences || []).map((e: Record<string, unknown>) => ({
        company: String(e.company || ''),
        title: String(e.title || ''),
        startDate: formatProxycurlDate(e.starts_at as Record<string, number> | null),
        endDate: e.ends_at ? formatProxycurlDate(e.ends_at as Record<string, number>) : null,
        description: String(e.description || ''),
        companyLinkedIn: e.company_linkedin_profile_url ? String(e.company_linkedin_profile_url) : null,
      })),
      skills: (data.skills || []).map(String),
      connections: data.connections || null,
    };
  } catch (err) {
    console.error('[Proxycurl] Person fetch error:', err);
    return null;
  }
}

/**
 * 查询 LinkedIn 公司资料
 * 费用: 1 credit (~$0.01)
 */
export async function getCompanyProfile(linkedinUrl: string): Promise<ProxycurlCompany | null> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) return null;

  try {
    const url = new URL(`${PROXYCURL_BASE}/linkedin/company`);
    url.searchParams.set('url', linkedinUrl);

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    const data = await response.json();

    return {
      linkedinUrl,
      name: data.name || '',
      description: data.description || '',
      website: data.website || '',
      industry: data.industry || '',
      companySize: formatCompanySize(data.company_size_on_linkedin),
      companyType: data.company_type || '',
      founded: data.founded_year || null,
      headquarters: data.hq?.city ? `${data.hq.city}, ${data.hq.country}` : '',
      specialties: data.specialities || [],
      followerCount: data.follower_count || 0,
    };
  } catch (err) {
    console.error('[Proxycurl] Company fetch error:', err);
    return null;
  }
}

/**
 * 通过邮箱反查 LinkedIn 个人资料
 * 费用: 3 credits (~$0.03)
 */
export async function reverseEmailLookup(email: string): Promise<string | null> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) return null;

  try {
    const url = new URL(`${PROXYCURL_BASE}/linkedin/profile/resolve/email`);
    url.searchParams.set('work_email', email);

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.url || null;
  } catch {
    return null;
  }
}

// ── 工具函数 ──

function formatProxycurlDate(date: Record<string, number> | null): string {
  if (!date) return '';
  return `${date.year || '?'}-${String(date.month || 1).padStart(2, '0')}`;
}

function formatCompanySize(size: number | null): string {
  if (!size) return 'unknown';
  if (size <= 10) return '1-10';
  if (size <= 50) return '11-50';
  if (size <= 200) return '51-200';
  if (size <= 500) return '201-500';
  if (size <= 1000) return '501-1000';
  if (size <= 5000) return '1001-5000';
  return '5000+';
}

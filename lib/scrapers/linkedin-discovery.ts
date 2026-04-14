/**
 * LinkedIn 间接搜索系统 — 通过 Google 搜索 site:linkedin.com 获取真实数据
 *
 * 架构：
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 第一层: Google CSE 搜索 site:linkedin.com (免费)              │
 * │   → 获取: 姓名、职位、公司名、LinkedIn URL                     │
 * ├──────────────────────────────────────────────────────────────┤
 * │ 第二层: Google CSE 搜索公司官网 (免费)                         │
 * │   → 获取: 官网URL、邮箱、IG、产品信息                          │
 * ├──────────────────────────────────────────────────────────────┤
 * │ 第三层: Proxycurl API 深度查询 (可选，$0.01/条)                │
 * │   → 获取: 完整工作经历、公司规模、行业、技能                     │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 为什么不直接爬 LinkedIn:
 * - LinkedIn 反爬极严格（HTTP 999、账号封禁、IP封禁）
 * - 违反 LinkedIn TOS 有法律风险
 * - Google 已经索引了 LinkedIn 的公开页面，搜 Google = 间接获取 LinkedIn 数据
 */

import { googleSearch, GoogleSearchResult } from './google-search';
import { analyzeStructured } from '@/lib/ai/ai-service';
import { COMPANY } from '@/lib/config/company';

// ── LinkedIn 搜索结果解析 ──

export interface LinkedInPerson {
  fullName: string;
  title: string;             // 职位
  company: string;           // 公司名
  linkedinUrl: string;       // LinkedIn 个人主页 URL
  location?: string;
  snippet: string;           // Google 搜索摘要（包含丰富信息）
}

export interface LinkedInCompany {
  companyName: string;
  linkedinUrl: string;       // LinkedIn 公司主页 URL
  industry?: string;
  description?: string;
  employeeRange?: string;    // "11-50", "51-200" 等
  snippet: string;
}

export interface LinkedInSearchResult {
  persons: LinkedInPerson[];
  companies: LinkedInCompany[];
  query: string;
}

/**
 * 从 Google 搜索结果中解析 LinkedIn 个人资料
 *
 * Google 返回的 LinkedIn 结果格式:
 * Title: "John Smith - Founder - Activewear Brand | LinkedIn"
 * URL:   "https://www.linkedin.com/in/john-smith-12345"
 * Snippet: "View John Smith's profile on LinkedIn... Founder at Activewear Brand. 500+ connections..."
 */
function parsePersonResult(result: GoogleSearchResult): LinkedInPerson | null {
  const url = result.link;

  // 只处理个人主页 linkedin.com/in/
  if (!url.includes('linkedin.com/in/')) return null;

  // 解析 title: "姓名 - 职位 - 公司 | LinkedIn"
  const titleParts = result.title
    .replace(/\s*\|\s*LinkedIn\s*$/i, '')
    .replace(/\s*[-–—]\s*LinkedIn\s*$/i, '')
    .split(/\s*[-–—]\s*/);

  const fullName = titleParts[0]?.trim() || '';
  const title = titleParts[1]?.trim() || '';
  const company = titleParts[2]?.trim() || titleParts[1]?.trim() || '';

  if (!fullName || fullName.length < 2) return null;

  // 从 snippet 中提取位置信息
  const locationMatch = result.snippet.match(/(?:located in|based in|from)\s+([^.·,]+)/i);

  return {
    fullName,
    title,
    company: company !== title ? company : '', // 避免重复
    linkedinUrl: url.split('?')[0], // 清除追踪参数
    location: locationMatch?.[1]?.trim(),
    snippet: result.snippet,
  };
}

/**
 * 从 Google 搜索结果中解析 LinkedIn 公司页面
 *
 * Google 返回的公司页面格式:
 * Title: "Gymshark | LinkedIn"
 * URL:   "https://www.linkedin.com/company/gymshark"
 * Snippet: "Gymshark | 1,001-5,000 employees | Activewear brand..."
 */
function parseCompanyResult(result: GoogleSearchResult): LinkedInCompany | null {
  const url = result.link;

  // 只处理公司主页 linkedin.com/company/
  if (!url.includes('linkedin.com/company/')) return null;

  const companyName = result.title
    .replace(/\s*\|\s*LinkedIn\s*$/i, '')
    .replace(/\s*[-–—]\s*LinkedIn\s*$/i, '')
    .trim();

  if (!companyName || companyName.length < 2) return null;

  // 从 snippet 解析员工规模
  const employeeMatch = result.snippet.match(/([\d,]+-[\d,]+)\s*employees/i)
    || result.snippet.match(/([\d,]+\+?)\s*employees/i);

  // 从 snippet 解析行业
  const industryKeywords = [
    'apparel', 'fashion', 'clothing', 'sportswear', 'activewear', 'retail',
    'textile', 'garment', 'wear', 'athletic', 'lifestyle',
  ];
  const lowerSnippet = result.snippet.toLowerCase();
  const industry = industryKeywords.find((kw) => lowerSnippet.includes(kw));

  return {
    companyName,
    linkedinUrl: url.split('?')[0],
    industry: industry || undefined,
    description: result.snippet.slice(0, 200),
    employeeRange: employeeMatch?.[1],
    snippet: result.snippet,
  };
}

// ── 搜索策略 ──

/**
 * 搜索 LinkedIn 上的决策者（创始人、采购、品牌经理）
 *
 * 搜索模式:
 * - site:linkedin.com/in "activewear" "founder"
 * - site:linkedin.com/in "streetwear brand" "CEO"
 * - site:linkedin.com/in "clothing" "sourcing manager"
 */
export async function searchLinkedInPeople(
  productKeyword: string,
  roles: string[] = ['founder', 'CEO', 'owner', 'buyer', 'sourcing', 'purchasing'],
  maxResults = 10
): Promise<LinkedInPerson[]> {
  const allPersons: LinkedInPerson[] = [];
  const seenUrls = new Set<string>();

  // 每个角色搜一次，组合更精准
  for (const role of roles.slice(0, 3)) { // 最多搜3个角色（控制API配额）
    const query = `site:linkedin.com/in "${productKeyword}" "${role}"`;
    const searchResult = await googleSearch(query, Math.ceil(maxResults / roles.length));

    for (const result of searchResult.results) {
      const person = parsePersonResult(result);
      if (person && !seenUrls.has(person.linkedinUrl)) {
        seenUrls.add(person.linkedinUrl);
        allPersons.push(person);
      }
    }

    // Google API 速率控制
    await new Promise((r) => setTimeout(r, 1000));
  }

  return allPersons.slice(0, maxResults);
}

/**
 * 搜索 LinkedIn 上的公司主页
 *
 * 搜索模式:
 * - site:linkedin.com/company "activewear"
 * - site:linkedin.com/company "sportswear brand"
 */
export async function searchLinkedInCompanies(
  productKeyword: string,
  maxResults = 10
): Promise<LinkedInCompany[]> {
  const query = `site:linkedin.com/company "${productKeyword}"`;
  const searchResult = await googleSearch(query, maxResults);

  const companies: LinkedInCompany[] = [];
  const seenUrls = new Set<string>();

  for (const result of searchResult.results) {
    const company = parseCompanyResult(result);
    if (company && !seenUrls.has(company.linkedinUrl)) {
      seenUrls.add(company.linkedinUrl);
      companies.push(company);
    }
  }

  return companies;
}

/**
 * 综合搜索: 同时搜人 + 搜公司，然后 AI 交叉匹配
 */
export async function discoverLinkedInLeads(
  keywords: string[],
  options?: {
    roles?: string[];
    maxPeople?: number;
    maxCompanies?: number;
  }
): Promise<{
  persons: LinkedInPerson[];
  companies: LinkedInCompany[];
  matched: MatchedLinkedInLead[];
}> {
  const roles = options?.roles || ['founder', 'CEO', 'owner', 'buyer', 'sourcing manager'];
  const allPersons: LinkedInPerson[] = [];
  const allCompanies: LinkedInCompany[] = [];

  for (const keyword of keywords.slice(0, 3)) {
    const [persons, companies] = await Promise.all([
      searchLinkedInPeople(keyword, roles, options?.maxPeople || 10),
      searchLinkedInCompanies(keyword, options?.maxCompanies || 10),
    ]);
    allPersons.push(...persons);
    allCompanies.push(...companies);

    await new Promise((r) => setTimeout(r, 1500));
  }

  // AI 交叉匹配: 把人和公司关联起来
  const matched = await matchPeopleToCompanies(allPersons, allCompanies);

  return { persons: allPersons, companies: allCompanies, matched };
}

// ── AI 交叉匹配 ──

export interface MatchedLinkedInLead {
  personName: string;
  personTitle: string;
  personLinkedIn: string;
  companyName: string;
  companyLinkedIn: string | null;
  companyIndustry: string | null;
  companySize: string | null;
  confidence: number;
  isDecisionMaker: boolean;
  searchSource: 'google_linkedin';
}

const MATCH_PROMPT = (
  persons: LinkedInPerson[],
  companies: LinkedInCompany[]
) => `You are a B2B sales intelligence analyst for ${COMPANY.name}.

I have two lists from LinkedIn (found via Google search). Match people to their companies and identify decision makers.

PEOPLE found:
${persons.map((p, i) => `${i + 1}. ${p.fullName} | Title: "${p.title}" | Company: "${p.company}" | ${p.location || ''}`).join('\n')}

COMPANIES found:
${companies.map((c, i) => `${i + 1}. ${c.companyName} | Employees: ${c.employeeRange || 'unknown'} | Industry: ${c.industry || 'unknown'} | "${c.snippet.slice(0, 100)}"`).join('\n')}

Tasks:
1. Match each person to a company (from the company list, or from the person's own data)
2. Determine if the person is a decision maker for purchasing/sourcing
3. Filter out irrelevant people (consultants, recruiters, journalists, students)

Respond with JSON (no markdown):
{
  "matches": [
    {
      "personIndex": number (1-based),
      "companyIndex": number | null (1-based from company list, null if not in list),
      "companyName": string (best company name),
      "isDecisionMaker": boolean,
      "isRelevant": boolean (true = potential customer, false = skip),
      "confidence": number (0-100),
      "reason": string
    }
  ]
}`;

async function matchPeopleToCompanies(
  persons: LinkedInPerson[],
  companies: LinkedInCompany[]
): Promise<MatchedLinkedInLead[]> {
  if (persons.length === 0) return [];

  try {
    const result = await analyzeStructured(
      MATCH_PROMPT(persons, companies),
      'linkedin_matching',
      (data: unknown) => {
        const d = data as Record<string, unknown>;
        return {
          matches: Array.isArray(d.matches) ? d.matches.map((m: Record<string, unknown>) => ({
            personIndex: Number(m.personIndex),
            companyIndex: m.companyIndex ? Number(m.companyIndex) : null,
            companyName: String(m.companyName || ''),
            isDecisionMaker: Boolean(m.isDecisionMaker),
            isRelevant: Boolean(m.isRelevant),
            confidence: Number(m.confidence || 0),
            reason: String(m.reason || ''),
          })) : [],
        };
      }
    );

    const matched: MatchedLinkedInLead[] = [];

    for (const match of result.matches) {
      if (!match.isRelevant) continue;

      const person = persons[match.personIndex - 1];
      if (!person) continue;

      const company = match.companyIndex ? companies[match.companyIndex - 1] : null;

      matched.push({
        personName: person.fullName,
        personTitle: person.title,
        personLinkedIn: person.linkedinUrl,
        companyName: match.companyName || person.company || 'Unknown',
        companyLinkedIn: company?.linkedinUrl || null,
        companyIndustry: company?.industry || null,
        companySize: company?.employeeRange || null,
        confidence: match.confidence,
        isDecisionMaker: match.isDecisionMaker,
        searchSource: 'google_linkedin',
      });
    }

    // 按置信度排序，决策者优先
    matched.sort((a, b) => {
      if (a.isDecisionMaker !== b.isDecisionMaker) return a.isDecisionMaker ? -1 : 1;
      return b.confidence - a.confidence;
    });

    return matched;
  } catch (err) {
    console.error('[LinkedIn Match] AI matching failed:', err);
    // 降级: 直接返回人的数据，不做匹配
    return persons.map((p) => ({
      personName: p.fullName,
      personTitle: p.title,
      personLinkedIn: p.linkedinUrl,
      companyName: p.company || 'Unknown',
      companyLinkedIn: null,
      companyIndustry: null,
      companySize: null,
      confidence: 50,
      isDecisionMaker: /founder|ceo|owner|director|head|vp|president/i.test(p.title),
      searchSource: 'google_linkedin' as const,
    }));
  }
}

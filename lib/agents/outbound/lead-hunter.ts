/**
 * Lead Hunter Agent — 基于真实数据源搜索客户
 *
 * 数据源（全部合法、真实）:
 * 1. Google Custom Search API — 搜索关键词获取真实网站
 * 2. Google site:linkedin.com — 间接搜索 LinkedIn 决策者和公司
 * 3. Shopify 店铺识别 — 判断是否电商品牌，提取产品/联系方式
 * 4. Proxycurl API（可选）— LinkedIn 深度数据（$0.01/条，仅用于高质量线索）
 *
 * AI 的职责（不猜测、只分析）:
 * - 分析 Google 搜索结果，筛选真正的服装品牌/零售商
 * - 交叉匹配 LinkedIn 人员和公司
 * - 给每个搜索结果评分和排序
 */

import { Agent, AgentContext, AgentResult, SearchCriteria } from '../types';
import { COMPANY } from '@/lib/config/company';
import { analyzeStructured } from '@/lib/ai/ai-service';
import { googleSearch, GoogleSearchResult } from '@/lib/scrapers/google-search';
import { discoverShopifyStores, ShopifyStore } from '@/lib/scrapers/shopify-discovery';
import { discoverLinkedInLeads, MatchedLinkedInLead } from '@/lib/scrapers/linkedin-discovery';
import { getPersonProfile } from '@/lib/scrapers/proxycurl';
import { deduplicateBatch } from '@/lib/utils/dedup';
import { cleanBatch } from '@/lib/utils/data-cleaner';
import { normalizeDomain } from '@/lib/utils/dedup';

// AI 只分析真实搜索结果，不做猜测
const ANALYZE_RESULTS_PROMPT = (results: { title: string; link: string; snippet: string }[]) =>
  `You are a B2B lead qualification analyst for ${COMPANY.name}, a ${COMPANY.description}.

I have REAL Google search results. Analyze each one and determine if it's a potential B2B customer.

Search results:
${results.map((r, i) => `${i + 1}. Title: "${r.title}" | URL: ${r.link} | Snippet: "${r.snippet}"`).join('\n')}

For EACH result, determine:
- Is this a clothing/apparel brand, retailer, or wholesaler? (not a magazine, blog, school, manufacturer, or directory)
- Would they potentially need a garment manufacturer?

IMPORTANT: Only include results that are ACTUAL COMPANIES selling apparel. Exclude:
- News articles, blogs, magazines
- Fashion schools or courses
- Other manufacturers (they're competitors, not customers)
- Directories or listing sites
- Government or non-profit sites

Respond with JSON (no markdown):
{
  "qualified": [
    {
      "index": number (1-based, from the results above),
      "company_name": string (extracted from the search result),
      "website": string (the URL from results),
      "company_type": "brand" | "retailer" | "wholesaler" | "other",
      "products": string[] (what they appear to sell, from snippet/title),
      "confidence": number (0-100, how confident this is a real apparel company),
      "reason": string (why this is a good lead, based on REAL evidence from the snippet)
    }
  ],
  "excluded": [
    {
      "index": number,
      "reason": string (why excluded)
    }
  ]
}`;

interface QualifiedLead {
  index: number;
  company_name: string;
  website: string;
  company_type: string;
  products: string[];
  confidence: number;
  reason: string;
}

function validateAnalysis(data: unknown): { qualified: QualifiedLead[]; excluded: { index: number; reason: string }[] } {
  if (!data || typeof data !== 'object') throw new Error('Invalid');
  const d = data as Record<string, unknown>;
  return {
    qualified: Array.isArray(d.qualified)
      ? d.qualified.map((q: Record<string, unknown>) => ({
          index: Number(q.index),
          company_name: String(q.company_name || ''),
          website: String(q.website || ''),
          company_type: String(q.company_type || 'other'),
          products: Array.isArray(q.products) ? q.products.map(String) : [],
          confidence: Number(q.confidence || 0),
          reason: String(q.reason || ''),
        }))
      : [],
    excluded: Array.isArray(d.excluded)
      ? d.excluded.map((e: Record<string, unknown>) => ({
          index: Number(e.index),
          reason: String(e.reason || ''),
        }))
      : [],
  };
}

export const leadHunterAgent: Agent = {
  role: 'lead-hunter',
  pipeline: 'outbound',
  description: '基于真实数据源搜索目标客户（Google搜索+官网爬取+Shopify识别）',

  async execute(context: AgentContext): Promise<AgentResult> {
    const criteria = context.previousResults as unknown as SearchCriteria;

    if (!criteria?.keywords?.length) {
      return { success: false, error: '缺少搜索关键词' };
    }

    try {
      // ══════════════════════════════════════
      // Step 1: Google 搜索获取真实网站
      // ══════════════════════════════════════
      const allSearchResults: GoogleSearchResult[] = [];

      for (const keyword of criteria.keywords.slice(0, 5)) { // 最多搜5个关键词
        const searchResponse = await googleSearch(keyword, 10);
        allSearchResults.push(...searchResponse.results);

        // 速率控制
        if (criteria.keywords.indexOf(keyword) < criteria.keywords.length - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // 去重搜索结果（同一个域名只保留一条）
      const seenDomains = new Set<string>();
      const uniqueResults = allSearchResults.filter((r) => {
        const domain = normalizeDomain(r.link);
        if (seenDomains.has(domain)) return false;
        seenDomains.add(domain);
        return true;
      });

      if (uniqueResults.length === 0) {
        return {
          success: true,
          data: {
            message: 'Google 搜索无结果（请检查 GOOGLE_CSE_API_KEY 和 GOOGLE_CSE_ID 是否配置）',
            searchedKeywords: criteria.keywords,
          },
          shouldStop: true,
        };
      }

      // ══════════════════════════════════════
      // Step 2: AI 分析搜索结果 — 筛选真正的目标客户
      // ══════════════════════════════════════
      const analysis = await analyzeStructured(
        ANALYZE_RESULTS_PROMPT(uniqueResults),
        'lead_qualification',
        validateAnalysis
      );

      if (!analysis.qualified.length) {
        return {
          success: true,
          data: {
            totalSearchResults: uniqueResults.length,
            qualified: 0,
            excluded: analysis.excluded.length,
            excludeReasons: analysis.excluded.map((e) => e.reason),
            message: '搜索结果中无合格的目标客户',
          },
          shouldStop: true,
        };
      }

      // ══════════════════════════════════════
      // Step 3: Shopify 店铺识别 — 深度信息提取
      // ══════════════════════════════════════
      const qualifiedDomains = analysis.qualified.map((q) => q.website);
      const shopifyStores = await discoverShopifyStores(qualifiedDomains, 2);
      const shopifyMap = new Map<string, ShopifyStore>();
      for (const store of shopifyStores) {
        shopifyMap.set(normalizeDomain(store.domain), store);
      }

      // ══════════════════════════════════════
      // Step 4: LinkedIn 间接搜索 — 找到决策者
      // ══════════════════════════════════════
      let linkedInLeads: MatchedLinkedInLead[] = [];
      try {
        const linkedInKeywords = criteria.keywords.slice(0, 2); // 控制 API 配额
        const linkedInResult = await discoverLinkedInLeads(linkedInKeywords, {
          roles: ['founder', 'CEO', 'owner', 'buyer', 'sourcing manager', 'purchasing director'],
          maxPeople: 15,
          maxCompanies: 10,
        });
        linkedInLeads = linkedInResult.matched;
      } catch (err) {
        console.warn('[LeadHunter] LinkedIn discovery failed (non-critical):', err);
      }

      // 建立 LinkedIn 匹配索引: 公司名 → 决策者信息
      const linkedInByCompany = new Map<string, MatchedLinkedInLead>();
      for (const li of linkedInLeads) {
        const key = li.companyName.toLowerCase().trim();
        // 只保留决策者 or 高置信度的
        if (li.isDecisionMaker || li.confidence >= 70) {
          linkedInByCompany.set(key, li);
        }
      }

      // ══════════════════════════════════════
      // Step 5: 合并所有数据源 → 数据清洗 + 去重
      // ══════════════════════════════════════
      const rawLeads = analysis.qualified.map((q) => {
        const shopify = shopifyMap.get(normalizeDomain(q.website));
        // 尝试匹配 LinkedIn 数据（公司名模糊匹配）
        const companyKey = q.company_name.toLowerCase().trim();
        const linkedIn = linkedInByCompany.get(companyKey) || null;

        return {
          company_name: q.company_name,
          website: q.website,
          contact_email: shopify?.contactEmail || null,
          contact_name: linkedIn?.personName || null,
          contact_title: linkedIn?.personTitle || null,
          instagram_handle: shopify?.socialLinks.instagram || null,
          contact_linkedin: linkedIn?.personLinkedIn
            || (shopify?.socialLinks.linkedin ? `https://linkedin.com/company/${shopify.socialLinks.linkedin}` : null),
          source: 'google_search',
          product_match: q.products.join(', '),
          company_type: q.company_type,
          company_size: linkedIn?.companySize || null,
          confidence: q.confidence,
          fit_reason: q.reason,
          is_shopify: Boolean(shopify),
          is_decision_maker: linkedIn?.isDecisionMaker || false,
          shopify_products: shopify?.products.join(', ') || null,
          estimated_product_count: shopify?.estimatedProducts || 0,
        };
      });

      // 同时加入 LinkedIn 独立发现的线索（Google搜不到但LinkedIn有的公司）
      for (const li of linkedInLeads) {
        const alreadyHave = rawLeads.some(
          (r) => r.company_name.toLowerCase() === li.companyName.toLowerCase()
        );
        if (!alreadyHave && li.isDecisionMaker && li.confidence >= 60) {
          rawLeads.push({
            company_name: li.companyName,
            website: null as unknown as string, // 还没有官网，后续 Analyzer 会补充
            contact_email: null,
            contact_name: li.personName,
            contact_title: li.personTitle,
            instagram_handle: null,
            contact_linkedin: li.personLinkedIn,
            source: 'linkedin_search',
            product_match: li.companyIndustry || '',
            company_type: 'brand',
            company_size: li.companySize,
            confidence: li.confidence,
            fit_reason: `LinkedIn决策者: ${li.personTitle} at ${li.companyName}`,
            is_shopify: false,
            is_decision_maker: true,
            shopify_products: null,
            estimated_product_count: 0,
          });
        }
      }

      const { valid: cleanedLeads, rejected } = cleanBatch(rawLeads);
      const { unique: newLeads, duplicates } = await deduplicateBatch(context.supabase, cleanedLeads);

      // ══════════════════════════════════════
      // Step 6: Proxycurl 深度验证（仅高质量线索，可选）
      // ══════════════════════════════════════
      const proxycurlEnriched = new Map<string, { email?: string; phone?: string }>();
      if (process.env.PROXYCURL_API_KEY) {
        // 只对有 LinkedIn URL 且置信度高的线索使用 Proxycurl
        const highValueLeads = newLeads
          .filter((l) => {
            const raw = l as Record<string, unknown>;
            return l.contact_linkedin && Number(raw.confidence || 0) >= 70 && raw.is_decision_maker;
          })
          .slice(0, 5); // 最多5条，控制成本

        for (const lead of highValueLeads) {
          try {
            const profile = await getPersonProfile(lead.contact_linkedin!);
            if (profile) {
              const bestEmail = profile.workEmail || profile.personalEmails[0] || null;
              proxycurlEnriched.set(lead.contact_linkedin!, {
                email: bestEmail || undefined,
                phone: profile.phoneNumbers[0] || undefined,
              });
            }
            await new Promise((r) => setTimeout(r, 1000));
          } catch {
            // Proxycurl 失败不影响流程
          }
        }
      }

      // ══════════════════════════════════════
      // Step 7: 入库
      // ══════════════════════════════════════
      const insertedLeads: string[] = [];
      for (const lead of newLeads) {
        const raw = lead as Record<string, unknown>;
        // 用 Proxycurl 数据补充邮箱
        const proxycurl = lead.contact_linkedin ? proxycurlEnriched.get(lead.contact_linkedin) : undefined;
        const finalEmail = lead.contact_email || proxycurl?.email || null;

        const { data: inserted } = await context.supabase
          .from('growth_leads')
          .insert({
            company_name: lead.company_name,
            website: lead.website,
            contact_email: finalEmail,
            contact_name: raw.contact_name || null,
            instagram_handle: lead.instagram_handle,
            contact_linkedin: lead.contact_linkedin,
            source: String(raw.source || 'google_search'),
            status: 'new',
            product_match: lead.product_match,
            ai_analysis: {
              company_type: raw.company_type,
              company_size: raw.company_size,
              contact_title: raw.contact_title,
              is_decision_maker: raw.is_decision_maker,
              confidence: raw.confidence,
              fit_reason: raw.fit_reason,
              is_shopify: raw.is_shopify,
              shopify_products: raw.shopify_products,
              estimated_product_count: raw.estimated_product_count,
              proxycurl_enriched: Boolean(proxycurl),
              data_quality_score: raw.dataQualityScore,
              data_source: `google_cse + shopify + linkedin${proxycurl ? ' + proxycurl' : ''}`,
              hunted_at: new Date().toISOString(),
            },
          })
          .select('id')
          .single();

        if (inserted) {
          insertedLeads.push(inserted.id);
        }
      }

      return {
        success: true,
        data: {
          // 搜索阶段
          searchedKeywords: criteria.keywords.length,
          totalSearchResults: uniqueResults.length,
          // AI 筛选阶段
          aiQualified: analysis.qualified.length,
          aiExcluded: analysis.excluded.length,
          // Shopify 识别
          shopifyStoresFound: shopifyStores.length,
          // LinkedIn 搜索
          linkedInPeopleFound: linkedInLeads.length,
          linkedInDecisionMakers: linkedInLeads.filter((l) => l.isDecisionMaker).length,
          proxycurlEnriched: proxycurlEnriched.size,
          // 清洗阶段
          afterCleaning: cleanedLeads.length,
          rejectedByCleaning: rejected.length,
          // 去重阶段
          afterDedup: newLeads.length,
          duplicatesSkipped: duplicates.length,
          // 最终结果
          newLeadsInserted: insertedLeads.length,
          leadIds: insertedLeads,
          // 详细日志
          pipeline: `${uniqueResults.length} Google → ${analysis.qualified.length} AI筛选 → ${linkedInLeads.length} LinkedIn → ${cleanedLeads.length} 清洗 → ${newLeads.length} 去重 → ${insertedLeads.length} 入库`,
        },
        nextAgent: insertedLeads.length > 0 ? 'lead-classifier' : undefined,
        shouldStop: insertedLeads.length === 0,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `搜索失败: ${errorMsg}` };
    }
  },
};

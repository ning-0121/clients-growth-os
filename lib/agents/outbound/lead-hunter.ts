/**
 * Lead Hunter Agent — 基于真实数据源搜索客户
 *
 * 数据源优先级（全部合法、真实）:
 * 1. Google Custom Search API — 搜索关键词获取真实网站
 * 2. 网站直接爬取 — 从搜索结果中的官网提取信息
 * 3. Shopify 店铺识别 — 判断是否电商品牌
 * 4. Instagram 公开主页 — 验证社媒真实性
 *
 * AI 的职责（不猜测、只分析）:
 * - 分析网站内容判断是否目标客户
 * - 从真实数据中提取结构化信息
 * - 给搜索结果评分和排序
 */

import { Agent, AgentContext, AgentResult, SearchCriteria } from '../types';
import { COMPANY } from '@/lib/config/company';
import { analyzeStructured } from '@/lib/ai/ai-service';
import { googleSearch, GoogleSearchResult } from '@/lib/scrapers/google-search';
import { discoverShopifyStores, ShopifyStore } from '@/lib/scrapers/shopify-discovery';
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
      // Step 4: 数据清洗 + 去重
      // ══════════════════════════════════════
      const rawLeads = analysis.qualified.map((q) => {
        const shopify = shopifyMap.get(normalizeDomain(q.website));
        return {
          company_name: q.company_name,
          website: q.website,
          contact_email: shopify?.contactEmail || null,
          instagram_handle: shopify?.socialLinks.instagram || null,
          contact_linkedin: shopify?.socialLinks.linkedin
            ? `https://linkedin.com/company/${shopify.socialLinks.linkedin}`
            : null,
          source: 'google_search',
          product_match: q.products.join(', '),
          company_type: q.company_type,
          confidence: q.confidence,
          fit_reason: q.reason,
          is_shopify: Boolean(shopify),
          shopify_products: shopify?.products.join(', ') || null,
          estimated_product_count: shopify?.estimatedProducts || 0,
        };
      });

      const { valid: cleanedLeads, rejected } = cleanBatch(rawLeads);
      const { unique: newLeads, duplicates } = await deduplicateBatch(context.supabase, cleanedLeads);

      // ══════════════════════════════════════
      // Step 5: 入库
      // ══════════════════════════════════════
      const insertedLeads: string[] = [];
      for (const lead of newLeads) {
        const raw = lead as Record<string, unknown>;
        const { data: inserted } = await context.supabase
          .from('growth_leads')
          .insert({
            company_name: lead.company_name,
            website: lead.website,
            contact_email: lead.contact_email,
            instagram_handle: lead.instagram_handle,
            contact_linkedin: lead.contact_linkedin,
            source: 'google_search',
            status: 'new',
            product_match: lead.product_match,
            ai_analysis: {
              company_type: raw.company_type,
              confidence: raw.confidence,
              fit_reason: raw.fit_reason,
              is_shopify: raw.is_shopify,
              shopify_products: raw.shopify_products,
              estimated_product_count: raw.estimated_product_count,
              data_quality_score: raw.dataQualityScore,
              data_source: 'google_cse + website_scrape',
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
          pipeline: `${uniqueResults.length} 搜索结果 → ${analysis.qualified.length} AI筛选 → ${cleanedLeads.length} 清洗 → ${newLeads.length} 去重 → ${insertedLeads.length} 入库`,
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

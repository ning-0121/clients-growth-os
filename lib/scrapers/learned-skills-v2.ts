/**
 * Learned Skills V2 — 从 GitHub 开源项目学到的技术
 *
 * 来源:
 * - OpenOutreach: 贝叶斯学习 + LinkedIn Voyager API 技术
 * - awesome-ai-lead-generation: 新数据源 + intent 信号
 * - awesome-ai-agents-for-sales: SalesGPT 对话架构
 * - UN Comtrade: 免费全球贸易数据API
 * - warmer.ai: 基于网站内容的邮件个性化
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { extractDomain } from '@/lib/growth/lead-engine';
import { enqueueUrls } from './source-queue';

// ══════════════════════════════════════
// Skill 1: UN Comtrade API — 免费全球贸易数据
// 学自: tradedownloader (ejokeeffe/tradedownloader)
// 替代需要付费的特易数据，直接获取进口商数据
// ══════════════════════════════════════

export async function searchComtrade(
  hsCode: string = '6109', // Default: T-shirts
  importerCountry: string = '842' // Default: USA (ISO code)
): Promise<{ partner: string; value: number; year: number }[]> {
  try {
    // UN Comtrade API v1 (free, no key needed)
    const url = `https://comtradeapi.un.org/data/v1/get/C/A/HS?cmdCode=${hsCode}&flowCode=M&reporterCode=${importerCountry}&period=2024&partnerCode=156`; // 156 = China
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.data || []).slice(0, 20).map((r: any) => ({
      partner: r.partnerDesc || '',
      value: r.primaryValue || 0,
      year: r.period || 0,
    }));
  } catch {
    return [];
  }
}

// ══════════════════════════════════════
// Skill 2: Warmer.ai 技术 — 根据客户网站写个性化邮件开头
// 学自: warmer.ai pattern
// 核心: 爬客户网站 → 提取最近动态 → AI 写出针对性的开场白
// ══════════════════════════════════════

export function buildPersonalizedOpener(
  companyName: string,
  websiteContent: string,
  productCategories: string[]
): string {
  // Extract recent signals from website text
  const lower = websiteContent.toLowerCase();

  // Detect new collection launch
  if (lower.includes('new collection') || lower.includes('new arrival') || lower.includes('just launched')) {
    return `noticed your new collection drop — the designs look great`;
  }
  // Detect sustainability focus
  if (lower.includes('sustainable') || lower.includes('eco-friendly') || lower.includes('recycled')) {
    return `love that ${companyName} is going sustainable — we've been working with recycled poly and organic cotton`;
  }
  // Detect expansion
  if (lower.includes('now shipping') || lower.includes('expanding') || lower.includes('new market')) {
    return `saw that ${companyName} is expanding — congrats! Growing brands often need flexible production partners`;
  }
  // Detect specific product
  if (productCategories.length > 0) {
    const cat = productCategories[0];
    return `been following ${companyName}'s ${cat} line — the fit and fabric choices stand out`;
  }
  // Generic but still personal
  return `came across ${companyName} and really like what you're building`;
}

// ══════════════════════════════════════
// Skill 3: Apollo.io 免费搜索 — 265M+ 联系人
// 学自: awesome-ai-agents-for-sales
// Apollo 免费版可以搜索联系人（需要注册）
// ══════════════════════════════════════

export async function searchApollo(
  companyDomain: string
): Promise<{ name: string; title: string; email: string; linkedin: string }[]> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        q_organization_domains: companyDomain,
        person_titles: ['founder', 'CEO', 'owner', 'sourcing', 'buyer', 'purchasing', 'procurement', 'supply chain', 'head of product'],
        page: 1,
        per_page: 5,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.people || []).map((p: any) => ({
      name: p.name || '',
      title: p.title || '',
      email: p.email || '',
      linkedin: p.linkedin_url || '',
    }));
  } catch {
    return [];
  }
}

// ══════════════════════════════════════
// Skill 4: Google Maps 批量公司发现
// 学自: bizkite-co/cocli Google Maps import pattern
// 搜索 Google Maps 上的运动服品牌/店铺
// ══════════════════════════════════════

export async function discoverFromGoogleMaps(
  query: string,
  supabase: SupabaseClient
): Promise<number> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return 0;

  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}&engine=google_maps&type=search`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return 0;
    const data = await res.json();

    const places = data.local_results || [];
    const urlsToEnqueue: { url: string; source: string; priority: number; data: any }[] = [];

    for (const place of places) {
      if (place.website) {
        urlsToEnqueue.push({
          url: place.website,
          source: 'google',
          priority: 28,
          data: {
            from_google_maps: true,
            place_name: place.title,
            address: place.address,
            phone: place.phone,
            rating: place.rating,
          },
        });
      }
    }

    if (urlsToEnqueue.length > 0) {
      const { queued } = await enqueueUrls(urlsToEnqueue, supabase);
      return queued;
    }
  } catch {}

  return 0;
}

// ══════════════════════════════════════
// Skill 5: Apify 预建爬虫 (如果有 API Key)
// 学自: awesome-ai-lead-generation
// Apify 有现成的 IG/TikTok/Google Maps 爬虫
// ══════════════════════════════════════

export async function runApifyActor(
  actorId: string,
  input: Record<string, any>
): Promise<any[]> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) return [];

  try {
    // Start actor run
    const startRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10000),
    });
    if (!startRes.ok) return [];
    const startData = await startRes.json();

    // Wait for results (simplified — in production would poll)
    const runId = startData.data?.id;
    if (!runId) return [];

    // Wait a bit then check
    await new Promise(r => setTimeout(r, 5000));

    const resultRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${apiKey}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resultRes.ok) return [];
    return await resultRes.json();
  } catch {
    return [];
  }
}

// ══════════════════════════════════════
// Skill 6: Reddit/社区 Intent 监控
// 学自: F5Bot + GummySearch + Leado
// 搜索 Reddit/论坛上寻找服装制造商的帖子
// ══════════════════════════════════════

export async function searchRedditIntent(): Promise<{ title: string; url: string; subreddit: string }[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  const results: { title: string; url: string; subreddit: string }[] = [];

  const queries = [
    'site:reddit.com "looking for" activewear manufacturer',
    'site:reddit.com "need a" clothing manufacturer sportswear',
    'site:reddit.com "recommend" garment factory activewear',
    'site:reddit.com "where to find" apparel manufacturer OEM',
  ];

  // Pick 1 query per run
  const idx = new Date().getHours() % queries.length;
  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(queries[idx])}&num=5&engine=google`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return results;
    const data = await res.json();

    for (const r of (data.organic_results || []).slice(0, 5)) {
      if (r.link?.includes('reddit.com')) {
        const subreddit = r.link.match(/r\/([^\/]+)/)?.[1] || '';
        results.push({
          title: r.title || '',
          url: r.link,
          subreddit,
        });
      }
    }
  } catch {}

  return results;
}

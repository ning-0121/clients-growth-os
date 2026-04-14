/**
 * Shopify 店铺发现爬虫 — 识别使用 Shopify 的服装品牌
 *
 * 原理: Shopify 店铺都有固定特征，可以通过公开信息判断:
 * 1. /collections/all 页面存在
 * 2. HTML 中包含 "Shopify" 标识
 * 3. cdn.shopify.com 资源引用
 *
 * 这些是品牌的公开店面，不需要登录，不违反任何规定。
 */

export interface ShopifyStore {
  domain: string;
  storeName: string;
  products: string[];       // 产品页面标题
  hasCollections: boolean;
  estimatedProducts: number;
  contactEmail?: string;
  socialLinks: { instagram?: string; linkedin?: string; facebook?: string };
}

/**
 * 检测一个网站是否是 Shopify 店铺，并提取信息
 */
export async function analyzeShopifyStore(domain: string): Promise<ShopifyStore | null> {
  const url = domain.startsWith('http') ? domain : `https://${domain}`;

  try {
    // 1. 获取首页
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });

    if (!response.ok) return null;
    const html = await response.text();

    // 2. 检测是否是 Shopify
    const isShopify = html.includes('cdn.shopify.com') ||
                       html.includes('Shopify.theme') ||
                       html.includes('shopify-section');

    if (!isShopify) return null;

    // 3. 提取店名
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const storeName = titleMatch ? titleMatch[1].split('–')[0].split('|')[0].trim() : domain;

    // 4. 提取社媒链接
    const igMatch = html.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
    const liMatch = html.match(/linkedin\.com\/(company|in)\/([a-zA-Z0-9_-]+)/i);
    const fbMatch = html.match(/facebook\.com\/([a-zA-Z0-9_.]+)/i);

    // 5. 提取联系邮箱
    const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    const contactEmail = emailMatch
      ? emailMatch.find((e) => !e.startsWith('noreply') && !e.startsWith('no-reply'))
      : undefined;

    // 6. 尝试获取产品列表
    let products: string[] = [];
    let estimatedProducts = 0;
    try {
      const collectionsRes = await fetch(`${url}/collections/all.json?limit=10`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (collectionsRes.ok) {
        const data = await collectionsRes.json();
        if (data.products) {
          products = data.products.map((p: { title: string }) => p.title).slice(0, 10);
          estimatedProducts = data.products.length;
        }
      }
    } catch {
      // products.json 可能被禁用，没关系
    }

    // 7. 从 HTML 提取产品类目
    if (products.length === 0) {
      const productMatches = [...html.matchAll(/<a[^>]*href="\/collections\/([^"]+)"[^>]*>(.*?)<\/a>/gi)];
      products = productMatches
        .map((m) => m[2].replace(/<[^>]*>/g, '').trim())
        .filter((p) => p.length > 0 && p.length < 50)
        .slice(0, 10);
    }

    return {
      domain: new URL(response.url).hostname,
      storeName,
      products,
      hasCollections: html.includes('/collections/'),
      estimatedProducts,
      contactEmail,
      socialLinks: {
        instagram: igMatch ? igMatch[1] : undefined,
        linkedin: liMatch ? liMatch[2] : undefined,
        facebook: fbMatch ? fbMatch[1] : undefined,
      },
    };
  } catch {
    return null;
  }
}

/**
 * 从 Google 搜索结果中批量识别 Shopify 店铺
 */
export async function discoverShopifyStores(
  domains: string[],
  concurrency = 3
): Promise<ShopifyStore[]> {
  const stores: ShopifyStore[] = [];

  for (let i = 0; i < domains.length; i += concurrency) {
    const chunk = domains.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((d) => analyzeShopifyStore(d))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        stores.push(result.value);
      }
    }

    // 速率控制
    if (i + concurrency < domains.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return stores;
}

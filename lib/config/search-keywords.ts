/**
 * 行业搜索关键词系统 — 多维度、多语言、按品类/地区/规模细分
 *
 * 设计原则:
 * 1. 按产品品类精准搜索（不是泛搜"clothing"）
 * 2. 按买家类型区分（品牌/零售/批发）
 * 3. 按地区语言适配（英语/西语/法语/德语）
 * 4. 按公司规模区分（独立品牌/中型/大型零售）
 * 5. 组合搜索：品类 + 买家意图 + 地区
 */

// ── 核心产品关键词（按我们的制造能力精准分类）──

export const PRODUCT_KEYWORDS = {
  // 主力产品
  activewear: {
    primary: ['activewear brand', 'sportswear company', 'athletic wear brand', 'fitness clothing brand'],
    long_tail: ['custom activewear manufacturer', 'private label activewear', 'activewear startup looking for manufacturer'],
    chinese: ['运动服品牌', '健身服装品牌'],
  },
  streetwear: {
    primary: ['streetwear brand', 'urban clothing brand', 'streetwear startup', 'street fashion label'],
    long_tail: ['streetwear brand looking for manufacturer', 'custom streetwear production', 'small batch streetwear'],
    chinese: ['街头服饰品牌', '潮牌'],
  },
  athleisure: {
    primary: ['athleisure brand', 'athleisure clothing company', 'casual athletic wear'],
    long_tail: ['athleisure private label', 'athleisure manufacturer low MOQ'],
    chinese: ['运动休闲品牌'],
  },
  hoodies: {
    primary: ['custom hoodie brand', 'hoodie manufacturer', 'premium hoodie brand'],
    long_tail: ['custom cut and sew hoodies', 'blank hoodie supplier for brands', 'hoodie brand looking for factory'],
    chinese: ['卫衣品牌', '帽衫制造'],
  },
  tshirts: {
    primary: ['custom t-shirt brand', 't-shirt company', 'premium tee brand', 'graphic tee brand'],
    long_tail: ['cut and sew t-shirt manufacturer', 'oversized tshirt manufacturer', 't-shirt brand MOQ 300'],
    chinese: ['T恤品牌', '定制T恤'],
  },
  jackets: {
    primary: ['jacket brand', 'outerwear brand', 'bomber jacket brand', 'windbreaker manufacturer'],
    long_tail: ['custom jacket manufacturer China', 'private label outerwear', 'technical jacket production'],
    chinese: ['夹克品牌', '外套品牌'],
  },
  yoga: {
    primary: ['yoga wear brand', 'yoga clothing company', 'yoga pants brand', 'yoga leggings brand'],
    long_tail: ['yoga wear manufacturer low MOQ', 'custom yoga pants production', 'sustainable yoga wear'],
    chinese: ['瑜伽服品牌'],
  },
  workwear: {
    primary: ['workwear brand', 'uniform manufacturer', 'corporate clothing supplier'],
    long_tail: ['custom workwear manufacturer', 'branded uniform production'],
    chinese: ['工装品牌', '制服制造'],
  },
} as const;

// ── 买家意图关键词（寻找供应商的信号）──

export const BUYER_INTENT_KEYWORDS = [
  'looking for manufacturer',
  'looking for supplier',
  'need clothing manufacturer',
  'seeking garment factory',
  'sourcing apparel',
  'need production partner',
  'private label clothing',
  'OEM clothing',
  'ODM apparel',
  'contract manufacturing clothing',
  'cut and sew manufacturer',
  'white label clothing',
  'clothing manufacturer low MOQ',
  'small batch clothing production',
] as const;

// ── 目标地区 + 本地化搜索词 ──

export const REGION_KEYWORDS: Record<string, {
  markets: string[];
  language: string;
  search_suffix: string[];
  platforms: ('google' | 'instagram' | 'linkedin')[];
}> = {
  north_america: {
    markets: ['USA', 'Canada'],
    language: 'en',
    search_suffix: ['USA', 'US brand', 'American', 'Canadian'],
    platforms: ['google', 'instagram', 'linkedin'],
  },
  europe: {
    markets: ['UK', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Sweden'],
    language: 'en',
    search_suffix: ['UK', 'European', 'London', 'Berlin'],
    platforms: ['google', 'instagram', 'linkedin'],
  },
  australia: {
    markets: ['Australia', 'New Zealand'],
    language: 'en',
    search_suffix: ['Australia', 'Australian brand', 'NZ'],
    platforms: ['google', 'instagram'],
  },
  middle_east: {
    markets: ['UAE', 'Saudi Arabia', 'Qatar'],
    language: 'en',
    search_suffix: ['Dubai', 'UAE', 'Middle East'],
    platforms: ['instagram', 'linkedin'],
  },
  southeast_asia: {
    markets: ['Singapore', 'Malaysia', 'Thailand', 'Philippines'],
    language: 'en',
    search_suffix: ['Singapore', 'Southeast Asia', 'ASEAN'],
    platforms: ['instagram', 'linkedin'],
  },
};

// ── 公司规模筛选信号 ──

export const SCALE_SIGNALS = {
  startup: {
    keywords: ['startup', 'new brand', 'launching', 'indie brand', 'small brand', 'emerging brand'],
    moq_range: '100-500',
    priority: 'warm',
  },
  growing: {
    keywords: ['growing brand', 'DTC brand', 'direct to consumer', 'ecommerce brand', 'online brand'],
    moq_range: '300-2000',
    priority: 'hot',
  },
  established: {
    keywords: ['established brand', 'retail chain', 'department store', 'wholesale', 'multi-store'],
    moq_range: '1000-10000',
    priority: 'vip',
  },
} as const;

// ── 排除关键词（过滤无关结果）──

export const EXCLUDE_KEYWORDS = [
  'print on demand',
  'dropshipping',
  'screen printing shop',
  'embroidery shop',
  'thrift',
  'second hand',
  'vintage reseller',
  'MLM',
  'affiliate',
  'review blog',
  'fashion magazine',
  'fashion school',
  'design school',
] as const;

// ── 搜索计划生成器 ──

export interface SearchPlan {
  name: string;
  description: string;
  keywords: string[];
  platforms: ('google' | 'instagram' | 'linkedin')[];
  region: string;
  targetScale: string;
  maxResults: number;
  excludeKeywords: string[];
}

/**
 * 生成每日搜索计划 — 轮换不同品类和地区，避免重复搜索
 */
export function generateDailySearchPlans(dayOfWeek: number): SearchPlan[] {
  const categories = Object.keys(PRODUCT_KEYWORDS) as (keyof typeof PRODUCT_KEYWORDS)[];
  const regions = Object.keys(REGION_KEYWORDS);

  // 每天搜索 2 个品类 × 2 个地区 = 4 个搜索计划
  const catIndex = (dayOfWeek * 2) % categories.length;
  const regionIndex = (dayOfWeek * 2) % regions.length;

  const todayCategories = [
    categories[catIndex],
    categories[(catIndex + 1) % categories.length],
  ];
  const todayRegions = [
    regions[regionIndex],
    regions[(regionIndex + 1) % regions.length],
  ];

  const plans: SearchPlan[] = [];

  for (const cat of todayCategories) {
    for (const region of todayRegions) {
      const productKw = PRODUCT_KEYWORDS[cat];
      const regionKw = REGION_KEYWORDS[region];

      // 组合关键词: 品类 + 地区后缀
      const combinedKeywords = productKw.primary.flatMap((pk) =>
        regionKw.search_suffix.slice(0, 2).map((rs) => `${pk} ${rs}`)
      );

      // 加入长尾关键词
      const allKeywords = [...combinedKeywords, ...productKw.long_tail.slice(0, 2)];

      plans.push({
        name: `${cat}_${region}`,
        description: `搜索 ${region} 地区的 ${cat} 品牌`,
        keywords: allKeywords,
        platforms: regionKw.platforms,
        region,
        targetScale: 'growing',
        maxResults: 10,
        excludeKeywords: [...EXCLUDE_KEYWORDS],
      });
    }
  }

  return plans;
}

/**
 * 获取特定品类的完整搜索关键词列表
 */
export function getKeywordsForCategory(
  category: keyof typeof PRODUCT_KEYWORDS,
  region?: string
): string[] {
  const product = PRODUCT_KEYWORDS[category];
  const base = [...product.primary, ...product.long_tail];

  if (region && REGION_KEYWORDS[region]) {
    const suffixes = REGION_KEYWORDS[region].search_suffix;
    const localized = product.primary.flatMap((pk) =>
      suffixes.map((s) => `${pk} ${s}`)
    );
    return [...localized, ...product.long_tail];
  }

  return base;
}

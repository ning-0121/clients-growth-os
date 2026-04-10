/**
 * HS Code mapper for apparel trade data.
 * Covers Chapters 61 (knitted apparel), 62 (woven apparel), 63 (textiles).
 */

const HS_DESCRIPTIONS: Record<string, string> = {
  // Chapter 61: Knitted apparel
  '6101': '男式大衣/外套 (针织)',
  '6102': '女式大衣/外套 (针织)',
  '6103': '男式西装/套装 (针织)',
  '6104': '女式西装/套装 (针织)',
  '6105': '男式衬衫 (针织)',
  '6106': '女式衬衫 (针织)',
  '6107': '男式内衣 (针织)',
  '6108': '女式内衣 (针织)',
  '6109': 'T恤 (针织)',
  '6110': '毛衣/套头衫 (针织)',
  '6111': '婴儿服装 (针织)',
  '6112': '运动服/滑雪服 (针织)',
  '6113': '涂层针织服装',
  '6114': '其他针织服装',
  '6115': '袜类 (针织)',
  '6116': '手套 (针织)',
  '6117': '其他针织配件',

  // Chapter 62: Woven apparel
  '6201': '男式大衣/外套 (梭织)',
  '6202': '女式大衣/外套 (梭织)',
  '6203': '男式西装/套装 (梭织)',
  '6204': '女式西装/套装 (梭织)',
  '6205': '男式衬衫 (梭织)',
  '6206': '女式衬衫 (梭织)',
  '6207': '男式内衣 (梭织)',
  '6208': '女式内衣 (梭织)',
  '6209': '婴儿服装 (梭织)',
  '6210': '毡/涂层面料服装',
  '6211': '运动服/泳装 (梭织)',
  '6212': '胸罩/紧身衣等',
  '6213': '手帕',
  '6214': '披肩/围巾',
  '6215': '领带',
  '6216': '手套 (梭织)',
  '6217': '其他梭织配件',

  // Chapter 63: Textiles
  '6301': '毯子',
  '6302': '床上/餐桌/厨房用织物',
  '6303': '窗帘/百叶窗',
  '6304': '其他家用纺织品',
  '6305': '包袋',
  '6306': '帐篷/遮阳篷',
  '6307': '其他纺织制品',
  '6308': '纺织套件',
  '6309': '旧衣物',
  '6310': '碎布',
};

// Apparel-specific chapters/codes
const APPAREL_PREFIXES = ['61', '62'];
const TEXTILE_PREFIX = '63';

/**
 * Get human-readable description for an HS code.
 * Supports 2-digit (chapter), 4-digit (heading), 6+ digit (full code).
 */
export function mapHSCode(code: string): string {
  if (!code) return '未知';

  const cleaned = code.replace(/[.\s-]/g, '');

  // Try 4-digit match first
  const heading = cleaned.slice(0, 4);
  if (HS_DESCRIPTIONS[heading]) return HS_DESCRIPTIONS[heading];

  // Try chapter-level description
  const chapter = cleaned.slice(0, 2);
  if (chapter === '61') return '针织服装';
  if (chapter === '62') return '梭织服装';
  if (chapter === '63') return '纺织制品';

  return `HS ${code}`;
}

/**
 * Check if an HS code is for apparel (Chapters 61, 62).
 */
export function isApparelHSCode(code: string): boolean {
  if (!code) return false;
  const cleaned = code.replace(/[.\s-]/g, '');
  return APPAREL_PREFIXES.some((p) => cleaned.startsWith(p));
}

/**
 * Check if an HS code is for textiles (including apparel, Chapter 61-63).
 */
export function isTextileHSCode(code: string): boolean {
  if (!code) return false;
  const cleaned = code.replace(/[.\s-]/g, '');
  return [...APPAREL_PREFIXES, TEXTILE_PREFIX].some((p) => cleaned.startsWith(p));
}

/**
 * Categorize a list of HS codes into apparel, textile, and other.
 */
export function categorizeHSCodes(codes: string[]): {
  apparel: number;
  textile: number;
  other: number;
} {
  let apparel = 0;
  let textile = 0;
  let other = 0;

  for (const code of codes) {
    if (isApparelHSCode(code)) apparel++;
    else if (isTextileHSCode(code)) textile++;
    else other++;
  }

  return { apparel, textile, other };
}

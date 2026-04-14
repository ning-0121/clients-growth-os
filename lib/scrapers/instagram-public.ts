/**
 * Instagram 公开信息爬虫 — 只抓取无需登录的公开数据
 *
 * 能获取的（公开）:
 * - 头像、简介、外链
 * - 帖子数量
 * - 是否企业账号
 *
 * 不能获取的（需登录）:
 * - 粉丝数具体值（IG 已限制）
 * - 帖子内容详情
 * - 粉丝列表
 *
 * 反封策略:
 * - 限速: 每次请求间隔 3 秒+随机抖动
 * - User-Agent 轮换
 * - 超过速率限制自动停止
 */

export interface InstagramProfile {
  username: string;
  fullName: string;
  biography: string;
  externalUrl: string | null;
  isBusinessAccount: boolean;
  isVerified: boolean;
  profilePicUrl: string | null;
  postCount: number;
  // 注意: 粉丝数可能获取不到（IG 近期限制）
  followerCount: number | null;
  followingCount: number | null;
  // 从 bio 中提取的联系信息
  bioEmail: string | null;
  bioPhone: string | null;
  isApparel: boolean;       // 简介中是否提到服装相关词
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

const APPAREL_KEYWORDS = [
  'clothing', 'apparel', 'fashion', 'wear', 'brand', 'streetwear', 'activewear',
  'sportswear', 'athleisure', 'fitness', 'gym', 'hoodie', 'tee', 'shirt',
  'boutique', 'designer', 'collection', 'style', 'outfit', 'garment',
  'sustainable fashion', 'slow fashion', 'ethical fashion', 'made to order',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * 获取 Instagram 公开主页信息
 */
export async function getInstagramProfile(username: string): Promise<InstagramProfile | null> {
  const cleanUsername = username.replace('@', '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');

  try {
    // 尝试通过网页获取
    const response = await fetch(`https://www.instagram.com/${cleanUsername}/`, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });

    if (response.status === 404) {
      return null; // 账号不存在
    }

    if (response.status === 429) {
      console.warn('[IG] 速率限制，停止请求');
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // 提取 JSON-LD 或 meta 数据
    const nameMatch = html.match(/<meta property="og:title" content="([^"]*?)"/);
    const descMatch = html.match(/<meta property="og:description" content="([^"]*?)"/);
    const imgMatch = html.match(/<meta property="og:image" content="([^"]*?)"/);

    const fullName = nameMatch ? decodeHTMLEntities(nameMatch[1].split('(')[0].trim()) : cleanUsername;
    const description = descMatch ? decodeHTMLEntities(descMatch[1]) : '';

    // 从描述中提取信息
    const followerMatch = description.match(/([\d,.]+[KMkm]?)\s*Followers/i);
    const followingMatch = description.match(/([\d,.]+[KMkm]?)\s*Following/i);
    const postMatch = description.match(/([\d,.]+[KMkm]?)\s*Posts/i);

    // 提取 bio（在 description 中 "-" 后面的部分通常是 bio）
    const bioParts = description.split(' - ');
    const biography = bioParts.length > 1 ? bioParts.slice(1).join(' - ').trim() : '';

    // 从 bio 中提取邮箱
    const bioEmailMatch = biography.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    // 提取外部链接
    const linkMatch = html.match(/"external_url":"(https?:[^"]+)"/);
    const externalUrl = linkMatch ? linkMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '') : null;

    // 检查是否企业账号
    const isBusiness = html.includes('"is_business_account":true') || html.includes('is_business');
    const isVerified = html.includes('"is_verified":true');

    // 判断是否服装相关
    const lowerBio = (biography + ' ' + fullName).toLowerCase();
    const isApparel = APPAREL_KEYWORDS.some((kw) => lowerBio.includes(kw));

    return {
      username: cleanUsername,
      fullName,
      biography,
      externalUrl,
      isBusinessAccount: isBusiness,
      isVerified,
      profilePicUrl: imgMatch ? imgMatch[1] : null,
      postCount: postMatch ? parseCount(postMatch[1]) : 0,
      followerCount: followerMatch ? parseCount(followerMatch[1]) : null,
      followingCount: followingMatch ? parseCount(followingMatch[1]) : null,
      bioEmail: bioEmailMatch ? bioEmailMatch[0] : null,
      bioPhone: null, // 电话通常不在公开 bio 中
      isApparel,
    };
  } catch (err) {
    console.warn(`[IG] Failed to fetch @${cleanUsername}:`, err);
    return null;
  }
}

/**
 * 解析 "12.5K" / "1.2M" / "1,234" 这样的数字
 */
function parseCount(str: string): number {
  const clean = str.replace(/,/g, '').trim();
  const multiplier = clean.endsWith('K') || clean.endsWith('k') ? 1000
    : clean.endsWith('M') || clean.endsWith('m') ? 1000000
    : 1;
  return Math.round(parseFloat(clean) * multiplier);
}

function decodeHTMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * 批量获取 IG 主页（带严格速率控制）
 */
export async function batchGetProfiles(
  usernames: string[],
  delayMs = 3000  // 每个请求间隔 3 秒
): Promise<Map<string, InstagramProfile | null>> {
  const results = new Map<string, InstagramProfile | null>();

  for (let i = 0; i < usernames.length; i++) {
    const profile = await getInstagramProfile(usernames[i]);
    results.set(usernames[i], profile);

    // 严格速率控制 + 随机抖动
    if (i < usernames.length - 1) {
      const jitter = Math.random() * 2000; // 0-2秒随机抖动
      await new Promise((r) => setTimeout(r, delayMs + jitter));
    }
  }

  return results;
}

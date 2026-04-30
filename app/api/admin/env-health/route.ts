import { NextResponse } from 'next/server';
import { requireAuth, getCurrentProfile } from '@/lib/auth';

/**
 * GET /api/admin/env-health
 *
 * Admin-only endpoint: returns which environment variables are configured.
 * Shows capability status (what works, what's missing).
 * Never returns the actual secret values — only booleans.
 */

interface EnvCheck {
  key: string;
  required: boolean;
  configured: boolean;
  capability: string;
  impact: string;
  setup_url?: string;
}

export async function GET() {
  await requireAuth();
  const profile = await getCurrentProfile();
  if (profile?.role !== '管理员') {
    return NextResponse.json({ error: '仅管理员' }, { status: 403 });
  }

  const checks: EnvCheck[] = [
    // ── Critical (must have) ──
    {
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      required: true,
      configured: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      capability: 'Supabase 数据库连接',
      impact: '整个系统无法运行',
    },
    {
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      required: true,
      configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      capability: 'Cron 和后台任务',
      impact: 'AI 发现 / 审批发送 / 监工全部失败',
    },
    {
      key: 'ANTHROPIC_API_KEY',
      required: true,
      configured: !!process.env.ANTHROPIC_API_KEY,
      capability: 'AI 分析和邮件生成',
      impact: '客户分析、策略生成、开发信全失效',
    },
    {
      key: 'CRON_SECRET',
      required: true,
      configured: !!process.env.CRON_SECRET,
      capability: 'Cron 认证',
      impact: '定时任务无保护',
    },

    // ── Email ──
    {
      key: 'RESEND_API_KEY',
      required: true,
      configured: !!process.env.RESEND_API_KEY,
      capability: '邮件发送',
      impact: '无法发送任何开发信',
      setup_url: 'https://resend.com/api-keys',
    },
    {
      key: 'RESEND_WEBHOOK_SECRET',
      required: false,
      configured: !!process.env.RESEND_WEBHOOK_SECRET,
      capability: '邮件打开/点击/退信追踪',
      impact: '无法追踪邮件效果，数据中心打开率显示 0',
      setup_url: 'https://resend.com/webhooks',
    },

    // ── Discovery ──
    {
      key: 'SERPAPI_KEY',
      required: true,
      configured: !!process.env.SERPAPI_KEY,
      capability: 'Google/Bing/Maps 客户发现',
      impact: '瀑布流不会自动填充新客户',
      setup_url: 'https://serpapi.com/',
    },

    // ── Contact enrichment (high value) ──
    {
      key: 'APOLLO_API_KEY',
      required: false,
      configured: !!process.env.APOLLO_API_KEY,
      capability: 'Apollo 265M 联系人搜索（找决策人邮箱）',
      impact: '联系人命中率降低约 30%',
      setup_url: 'https://apollo.io/api',
    },
    {
      key: 'TOMBA_API_KEY',
      required: false,
      configured: !!(process.env.TOMBA_API_KEY && process.env.TOMBA_SECRET),
      capability: '邮箱查找 + 发送前验证（降低退信率）',
      impact: '退信率可能从 2% 飙到 15%',
      setup_url: 'https://tomba.io/api',
    },
    {
      key: 'PROXYCURL_API_KEY',
      required: false,
      configured: !!process.env.PROXYCURL_API_KEY,
      capability: 'LinkedIn 公司/员工深度查询',
      impact: 'LinkedIn 联系人信息精度下降',
      setup_url: 'https://nubela.co/proxycurl/',
    },
    {
      key: 'APIFY_API_KEY',
      required: false,
      configured: !!process.env.APIFY_API_KEY,
      capability: 'IG/TikTok/Google Maps 抓取',
      impact: '社交媒体客户发现失效',
      setup_url: 'https://apify.com/',
    },

    // ── Other enrichment ──
    {
      key: 'PHANTOMBUSTER_API_KEY',
      required: false,
      configured: !!process.env.PHANTOMBUSTER_API_KEY,
      capability: 'LinkedIn 批量抓取 webhook',
      impact: 'LinkedIn 渠道无法导入',
      setup_url: 'https://phantombuster.com/',
    },
    {
      key: 'GOOGLE_CSE_API_KEY',
      required: false,
      configured: !!(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID),
      capability: 'Google 自定义搜索（备用 SerpAPI）',
      impact: '搜索引擎只靠 SerpAPI 一条腿，配额用完就停',
      setup_url: 'https://programmablesearchengine.google.com/',
    },
    {
      key: 'GITHUB_TOKEN',
      required: false,
      configured: !!process.env.GITHUB_TOKEN,
      capability: 'Self-evolution（扫GitHub找新工具）',
      impact: 'AI 学习新技能会被 GitHub 限速',
      setup_url: 'https://github.com/settings/tokens',
    },

    // ── 新：搜索 provider 替代 ──
    {
      key: 'BRAVE_SEARCH_API_KEY',
      required: false,
      configured: !!process.env.BRAVE_SEARCH_API_KEY,
      capability: 'Brave Search API（独立索引，免费2000/月，$5/mo Pro）',
      impact: 'SerpAPI 主力降级为 fallback，月省 $40+',
      setup_url: 'https://brave.com/search/api/',
    },
    {
      key: 'DATAFORSEO_LOGIN',
      required: false,
      configured: !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
      capability: 'DataForSEO SERP API（$0.6/1000 vs SerpAPI $10/1000）',
      impact: '搜索成本降低 10-15x',
      setup_url: 'https://app.dataforseo.com/',
    },
    {
      key: 'SCRAPINGBEE_API_KEY',
      required: false,
      configured: !!process.env.SCRAPINGBEE_API_KEY,
      capability: 'ScrapingBee unblocker（Amazon/LinkedIn Cloudflare 绕过）',
      impact: '否则 Amazon 深度抓取 + LinkedIn 公开页抓取会失败',
      setup_url: 'https://www.scrapingbee.com/',
    },
    {
      key: 'OPENAI_API_KEY',
      required: false,
      configured: !!process.env.OPENAI_API_KEY,
      capability: 'OpenAI Embeddings（pgvector RAG，$0.02/百万tokens）',
      impact: '无 RAG 就没法用相似客户做 few-shot，分类精度降 20%',
      setup_url: 'https://platform.openai.com/api-keys',
    },

    // ── Config ──
    {
      key: 'SYSTEM_USER_ID',
      required: true,
      configured: !!process.env.SYSTEM_USER_ID,
      capability: '自动化任务归属用户',
      impact: '后台创建的数据没有归属',
    },

    // ── Webhooks (signature verification) ──
    {
      key: 'SHOPIFY_WEBHOOK_SECRET',
      required: false,
      configured: !!process.env.SHOPIFY_WEBHOOK_SECRET,
      capability: 'Shopify 联系表单 webhook 签名验证',
      impact: '不配 = webhook 直接返回 503（防伪造）',
      setup_url: 'https://shopify.dev/docs/apps/build/webhooks',
    },

    // ── Email sending identity ──
    {
      key: 'RESEND_SENDING_EMAIL',
      required: false,
      configured: !!process.env.RESEND_SENDING_EMAIL,
      capability: '发信邮箱地址（必须是 Resend 已验证域名下）',
      impact: '不配则使用代码默认值 alex@jojofashion.us',
    },

    // ── PhantomBuster social automation agents ──
    {
      key: 'PHANTOMBUSTER_IG_COMMENTER_AGENT_ID',
      required: false,
      configured: !!process.env.PHANTOMBUSTER_IG_COMMENTER_AGENT_ID,
      capability: 'IG 评论自动执行（social-execute cron）',
      impact: '队列里的 IG 评论不会真正发出去',
      setup_url: 'https://phantombuster.com/automations/instagram/',
    },
    {
      key: 'PHANTOMBUSTER_LINKEDIN_CONNECT_AGENT_ID',
      required: false,
      configured: !!process.env.PHANTOMBUSTER_LINKEDIN_CONNECT_AGENT_ID,
      capability: 'LinkedIn 加好友自动执行',
      impact: '队列里的 LinkedIn 连接请求不会发出',
      setup_url: 'https://phantombuster.com/automations/linkedin/',
    },
    {
      key: 'PHANTOMBUSTER_IG_DM_AGENT_ID',
      required: false,
      configured: !!process.env.PHANTOMBUSTER_IG_DM_AGENT_ID,
      capability: 'IG 私信自动发送（可选）',
      impact: '无影响（若未启用 DM 渠道）',
    },
    {
      key: 'PHANTOMBUSTER_WARMUP_START_DATE',
      required: false,
      configured: !!process.env.PHANTOMBUSTER_WARMUP_START_DATE,
      capability: '社媒账号养号渐进模式（14 天从 20% 升到 100%）',
      impact: '不配 = 满速跑，新账号有封号风险',
    },

    // ── Notifications ──
    {
      key: 'SLACK_WEBHOOK_URL',
      required: false,
      configured: !!process.env.SLACK_WEBHOOK_URL,
      capability: 'Supervisor 告警推送 Slack（low_throughput / high_error_rate）',
      impact: '不配 = 系统异常只写 DB，不推送，需主动去看 dashboard',
      setup_url: 'https://api.slack.com/messaging/webhooks',
    },
  ];

  const critical_missing = checks.filter(c => c.required && !c.configured);
  const optional_missing = checks.filter(c => !c.required && !c.configured);
  const configured_count = checks.filter(c => c.configured).length;

  // Compute capability tier
  const tier =
    critical_missing.length > 0 ? 'broken' :
    optional_missing.length > 8 ? 'minimal' :
    optional_missing.length > 4 ? 'standard' :
    optional_missing.length > 0 ? 'enhanced' : 'full';

  return NextResponse.json({
    tier,
    tier_label: {
      broken: '🔴 系统无法运行',
      minimal: '🟡 最小可用（只有核心功能）',
      standard: '🟢 标准配置',
      enhanced: '🟢 增强配置',
      full: '⭐ 完整配置',
    }[tier],
    summary: {
      total: checks.length,
      configured: configured_count,
      critical_missing: critical_missing.length,
      optional_missing: optional_missing.length,
    },
    critical_missing: critical_missing.map(c => ({ key: c.key, capability: c.capability, impact: c.impact, setup_url: c.setup_url })),
    optional_missing: optional_missing.map(c => ({ key: c.key, capability: c.capability, impact: c.impact, setup_url: c.setup_url })),
    checks,
  });
}

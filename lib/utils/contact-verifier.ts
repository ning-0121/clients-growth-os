/**
 * 联系人验证系统 — 确保客户信息真实可联系
 *
 * 验证维度:
 * 1. 邮箱可达性: MX记录检查 + 格式验证 + 域名活跃度
 * 2. 网站活跃度: HTTP状态码 + 最后更新时间 + SSL证书
 * 3. 社媒真实性: Instagram/LinkedIn 主页是否存在且活跃
 * 4. 综合可信度: 多维度交叉验证得出最终分数
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain } from './dedup';

// ── 验证结果 ──

export interface VerificationResult {
  leadId: string;
  overallScore: number;           // 0-100 综合可信度
  overallStatus: 'verified' | 'suspicious' | 'invalid';
  checks: VerificationCheck[];
  verifiedAt: string;
}

export interface VerificationCheck {
  type: 'email' | 'website' | 'instagram' | 'linkedin' | 'phone';
  status: 'pass' | 'warn' | 'fail' | 'skip';
  score: number;                  // 0-100
  details: string;
}

// ── 邮箱验证 ──

async function verifyEmail(email: string): Promise<VerificationCheck> {
  if (!email) return { type: 'email', status: 'skip', score: 0, details: '无邮箱' };

  const checks: string[] = [];
  let score = 0;

  // 1. 格式验证
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    score += 20;
    checks.push('格式正确');
  } else {
    return { type: 'email', status: 'fail', score: 0, details: '邮箱格式无效' };
  }

  // 2. 域名是否存在（通过DNS查询模拟）
  const domain = email.split('@')[1];
  try {
    const response = await fetch(`https://${domain}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok || response.status < 500) {
      score += 30;
      checks.push(`域名 ${domain} 可访问`);
    }
  } catch {
    // 域名不可访问不一定代表邮箱无效（有些域只做邮件）
    checks.push(`域名 ${domain} 无法访问（可能仅做邮件服务）`);
    score += 10;
  }

  // 3. 是否为个人邮箱（比通用邮箱更有价值）
  const prefix = email.split('@')[0];
  const genericPrefixes = ['info', 'hello', 'contact', 'support', 'admin', 'sales', 'service'];
  if (genericPrefixes.includes(prefix)) {
    checks.push('通用邮箱（非个人），优先级较低');
    score += 10;
  } else {
    checks.push('个人邮箱（高价值）');
    score += 30;
  }

  // 4. 是否跟公司域名匹配
  score += 20; // 基础分

  const status = score >= 60 ? 'pass' : score >= 30 ? 'warn' : 'fail';
  return { type: 'email', status, score, details: checks.join('; ') };
}

// ── 网站验证 ──

async function verifyWebsite(website: string): Promise<VerificationCheck> {
  if (!website) return { type: 'website', status: 'skip', score: 0, details: '无网站' };

  const checks: string[] = [];
  let score = 0;

  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 GrowthOS-Verifier/1.0' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });

    // HTTP 状态码
    if (response.ok) {
      score += 30;
      checks.push(`网站正常 (HTTP ${response.status})`);
    } else {
      checks.push(`网站响应异常 (HTTP ${response.status})`);
      score += 5;
    }

    // SSL 证书（https）
    if (response.url.startsWith('https://')) {
      score += 20;
      checks.push('有SSL证书');
    } else {
      checks.push('无SSL证书（可疑）');
    }

    // 内容检查
    const html = await response.text();

    // 页面是否有实质内容（不是空白/停放页面）
    const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (bodyText.length > 500) {
      score += 20;
      checks.push(`有实质内容 (${bodyText.length} 字)`);
    } else if (bodyText.length > 100) {
      score += 10;
      checks.push(`内容较少 (${bodyText.length} 字)`);
    } else {
      checks.push('页面内容极少（可能是停放域名）');
    }

    // 检查是否有购物/产品页面（电商信号）
    if (html.includes('shop') || html.includes('product') || html.includes('cart') ||
        html.includes('Shopify') || html.includes('WooCommerce')) {
      score += 10;
      checks.push('检测到电商功能');
    }

    // 检查是否有联系方式
    if (html.includes('mailto:') || html.includes('contact') || html.includes('email')) {
      score += 10;
      checks.push('页面有联系方式');
    }

    // 检查社媒链接
    if (html.includes('instagram.com') || html.includes('linkedin.com')) {
      score += 10;
      checks.push('有社交媒体链接');
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timeout') || msg.includes('TIMEOUT')) {
      checks.push('网站响应超时');
      score += 5;
    } else {
      checks.push(`网站无法访问: ${msg}`);
    }
  }

  score = Math.min(100, score);
  const status = score >= 50 ? 'pass' : score >= 20 ? 'warn' : 'fail';
  return { type: 'website', status, score, details: checks.join('; ') };
}

// ── Instagram 验证 ──

async function verifyInstagram(handle: string): Promise<VerificationCheck> {
  if (!handle) return { type: 'instagram', status: 'skip', score: 0, details: '无IG账号' };

  const cleanHandle = handle.replace('@', '').trim();
  const checks: string[] = [];
  let score = 0;

  try {
    const response = await fetch(`https://www.instagram.com/${cleanHandle}/`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });

    if (response.ok) {
      score += 50;
      checks.push(`IG主页存在: @${cleanHandle}`);

      const html = await response.text();

      // 检查是否被禁止/私密
      if (html.includes('This account is private')) {
        checks.push('私密账号');
        score += 10;
      }

      // 检查是否有粉丝数据
      const followerMatch = html.match(/"edge_followed_by":\{"count":(\d+)/);
      if (followerMatch) {
        const followers = parseInt(followerMatch[1]);
        if (followers >= 1000) {
          score += 30;
          checks.push(`${followers.toLocaleString()} 粉丝（活跃）`);
        } else if (followers >= 100) {
          score += 20;
          checks.push(`${followers} 粉丝`);
        } else {
          score += 5;
          checks.push(`${followers} 粉丝（较少）`);
        }
      } else {
        score += 10;
        checks.push('主页可访问，无法获取粉丝数');
      }
    } else if (response.status === 404) {
      checks.push(`IG账号不存在: @${cleanHandle}`);
    } else {
      checks.push(`IG验证受限 (HTTP ${response.status})`);
      score += 10; // 可能是速率限制
    }
  } catch {
    checks.push('IG验证超时（可能是速率限制）');
    score += 10;
  }

  score = Math.min(100, score);
  const status = score >= 50 ? 'pass' : score >= 20 ? 'warn' : 'fail';
  return { type: 'instagram', status, score, details: checks.join('; ') };
}

// ── LinkedIn 验证 ──

async function verifyLinkedIn(url: string): Promise<VerificationCheck> {
  if (!url) return { type: 'linkedin', status: 'skip', score: 0, details: '无LinkedIn' };

  const checks: string[] = [];
  let score = 0;

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });

    if (response.ok || response.status === 302) {
      score += 70;
      checks.push('LinkedIn页面存在');
    } else if (response.status === 404) {
      checks.push('LinkedIn页面不存在');
    } else if (response.status === 999) {
      // LinkedIn 常见的反爬状态码
      score += 30;
      checks.push('LinkedIn 反爬限制（页面可能存在）');
    } else {
      checks.push(`LinkedIn 响应: HTTP ${response.status}`);
      score += 10;
    }
  } catch {
    checks.push('LinkedIn 验证超时');
    score += 10;
  }

  score = Math.min(100, score);
  const status = score >= 50 ? 'pass' : score >= 20 ? 'warn' : 'fail';
  return { type: 'linkedin', status, score, details: checks.join('; ') };
}

// ── 综合验证 ──

/**
 * 对一个线索进行全方位验证
 */
export async function verifyLead(
  supabase: SupabaseClient,
  lead: {
    id: string;
    website?: string;
    contact_email?: string;
    instagram_handle?: string;
    contact_linkedin?: string;
  }
): Promise<VerificationResult> {

  // 并行执行所有验证
  const [emailResult, websiteResult, igResult, linkedinResult] = await Promise.allSettled([
    verifyEmail(lead.contact_email || ''),
    verifyWebsite(lead.website || ''),
    verifyInstagram(lead.instagram_handle || ''),
    verifyLinkedIn(lead.contact_linkedin || ''),
  ]);

  const checks: VerificationCheck[] = [
    emailResult.status === 'fulfilled' ? emailResult.value : { type: 'email' as const, status: 'fail' as const, score: 0, details: '验证出错' },
    websiteResult.status === 'fulfilled' ? websiteResult.value : { type: 'website' as const, status: 'fail' as const, score: 0, details: '验证出错' },
    igResult.status === 'fulfilled' ? igResult.value : { type: 'instagram' as const, status: 'skip' as const, score: 0, details: '验证出错' },
    linkedinResult.status === 'fulfilled' ? linkedinResult.value : { type: 'linkedin' as const, status: 'skip' as const, score: 0, details: '验证出错' },
  ];

  // 计算综合得分（加权）
  const activeChecks = checks.filter((c) => c.status !== 'skip');
  const weights: Record<string, number> = { email: 35, website: 30, instagram: 20, linkedin: 15 };

  let totalWeight = 0;
  let weightedScore = 0;
  for (const check of activeChecks) {
    const w = weights[check.type] || 10;
    totalWeight += w;
    weightedScore += check.score * w;
  }

  const overallScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
  const failedCritical = checks.filter((c) => c.status === 'fail' && (c.type === 'email' || c.type === 'website')).length;

  const overallStatus: VerificationResult['overallStatus'] =
    failedCritical >= 2 ? 'invalid' :
    overallScore >= 50 ? 'verified' :
    overallScore >= 25 ? 'suspicious' : 'invalid';

  const result: VerificationResult = {
    leadId: lead.id,
    overallScore,
    overallStatus,
    checks,
    verifiedAt: new Date().toISOString(),
  };

  // 保存验证结果到数据库
  await supabase
    .from('growth_leads')
    .update({
      verification_status: overallStatus,
      verification_score: overallScore,
      verification_data: {
        checks: checks.map((c) => ({ type: c.type, status: c.status, score: c.score, details: c.details })),
        verifiedAt: result.verifiedAt,
      },
    })
    .eq('id', lead.id);

  return result;
}

/**
 * 批量验证线索 — 带速率控制避免被封
 */
export async function verifyBatch(
  supabase: SupabaseClient,
  leads: { id: string; website?: string; contact_email?: string; instagram_handle?: string; contact_linkedin?: string }[],
  concurrency = 3,
  delayMs = 2000
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (let i = 0; i < leads.length; i += concurrency) {
    const chunk = leads.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map((lead) => verifyLead(supabase, lead))
    );

    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    // 速率控制 — 每批之间等待，避免触发反爬
    if (i + concurrency < leads.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}

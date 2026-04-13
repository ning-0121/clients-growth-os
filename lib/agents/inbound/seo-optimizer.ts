/**
 * SEO Optimizer Agent — Analyzes and optimizes website for search visibility.
 *
 * Flow: Crawls website pages → Analyzes SEO health → Generates optimization suggestions
 *       → Creates SEO-optimized content → Tracks rankings.
 */

import { Agent, AgentContext, AgentResult, SEOAnalysis } from '../types';
import { COMPANY } from '@/lib/config/company';
import { analyzeStructured } from '@/lib/ai/ai-service';

const SEO_AUDIT_PROMPT = (pageData: PageData) => `You are an SEO expert specializing in B2B manufacturing and e-commerce websites.

Audit this page for SEO optimization opportunities.

Website: ${COMPANY.domain}
Page URL: ${pageData.url}
Title: ${pageData.title}
Meta Description: ${pageData.metaDescription}
H1 Tags: ${pageData.h1Tags.join(', ') || 'None'}
H2 Tags: ${pageData.h2Tags.join(', ') || 'None'}
Word Count: ${pageData.wordCount}
Has Schema Markup: ${pageData.hasSchema}
Load Time: ${pageData.loadTime || 'Unknown'}

Content excerpt:
${pageData.content.slice(0, 2000)}

Our target keywords: custom apparel manufacturer, OEM clothing, ODM garment, activewear manufacturer China, sportswear factory, custom hoodie manufacturer, private label clothing

Respond with JSON (no markdown):
{
  "score": number (0-100, overall SEO health),
  "issues": [
    {
      "type": "meta" | "content" | "technical" | "performance",
      "severity": "critical" | "warning" | "info",
      "description": string,
      "fix": string (specific fix instruction)
    }
  ],
  "suggestions": [
    {
      "area": string,
      "currentState": string,
      "recommendation": string,
      "impact": "high" | "medium" | "low"
    }
  ],
  "keywords": [
    {
      "keyword": string,
      "present": boolean,
      "density": number,
      "recommendation": string
    }
  ],
  "contentSuggestions": {
    "title": string (optimized title suggestion),
    "metaDescription": string (optimized meta description),
    "h1": string (optimized H1),
    "additionalContent": string (content to add for better SEO)
  }
}`;

const CONTENT_GENERATION_PROMPT = (topic: string, keywords: string[]) => `You are a B2B content marketer for ${COMPANY.name}, a ${COMPANY.description}.

Write an SEO-optimized blog post / landing page section.

Topic: ${topic}
Target Keywords: ${keywords.join(', ')}
Tone: Professional but approachable
Audience: B2B buyers (fashion brands, retailers, wholesalers)

Requirements:
- 600-800 words
- Include target keywords naturally (2-3% density)
- Include H2/H3 headings
- Include a CTA at the end
- Write in English (international audience)
- Focus on our expertise: ${COMPANY.products.join(', ')}
- Mention MOQ (${COMPANY.moq}) and lead time (${COMPANY.leadTime})

Respond with JSON (no markdown):
{
  "title": string,
  "metaDescription": string (under 160 chars),
  "content_html": string (full HTML content with headings),
  "content_text": string (plain text version),
  "keywords_used": string[],
  "estimated_reading_time": string
}`;

interface PageData {
  url: string;
  title: string;
  metaDescription: string;
  h1Tags: string[];
  h2Tags: string[];
  wordCount: number;
  hasSchema: boolean;
  loadTime?: string;
  content: string;
}

function validateSEOAudit(data: unknown): SEOAnalysis {
  if (!data || typeof data !== 'object') throw new Error('Invalid');
  const d = data as Record<string, unknown>;
  return {
    url: '',
    currentScore: Number(d.score || 0),
    issues: Array.isArray(d.issues)
      ? d.issues.map((i: Record<string, unknown>) => ({
          type: String(i.type || 'content') as 'meta' | 'content' | 'technical' | 'performance',
          severity: String(i.severity || 'info') as 'critical' | 'warning' | 'info',
          description: String(i.description || ''),
          fix: String(i.fix || ''),
        }))
      : [],
    suggestions: Array.isArray(d.suggestions)
      ? d.suggestions.map((s: Record<string, unknown>) => ({
          area: String(s.area || ''),
          currentState: String(s.currentState || ''),
          recommendation: String(s.recommendation || ''),
          impact: String(s.impact || 'medium') as 'high' | 'medium' | 'low',
        }))
      : [],
    keywords: Array.isArray(d.keywords)
      ? d.keywords.map((k: Record<string, unknown>) => ({
          keyword: String(k.keyword || ''),
          searchVolume: 0,
          difficulty: 0,
          targetRank: 10,
        }))
      : [],
  };
}

export const seoOptimizerAgent: Agent = {
  role: 'seo-optimizer',
  pipeline: 'inbound',
  description: 'AI优化网站SEO，提高搜索引擎可见度，吸引目标客户',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const action = (input.action as string) || 'audit';
    const url = (input.url as string) || `https://${COMPANY.domain}`;

    try {
      if (action === 'audit') {
        // Fetch page data
        let pageData: PageData;
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': 'GrowthOS-SEO-Bot/1.0' },
            signal: AbortSignal.timeout(10000),
          });
          const html = await response.text();

          // Basic HTML parsing
          const titleMatch = html.match(/<title>(.*?)<\/title>/i);
          const metaMatch = html.match(/<meta\s+name="description"\s+content="(.*?)"/i);
          const h1Matches = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]*>/g, ''));
          const h2Matches = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]*>/g, ''));
          const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          pageData = {
            url,
            title: titleMatch?.[1] || '',
            metaDescription: metaMatch?.[1] || '',
            h1Tags: h1Matches,
            h2Tags: h2Matches,
            wordCount: bodyText.split(/\s+/).length,
            hasSchema: html.includes('application/ld+json'),
            content: bodyText.slice(0, 3000),
          };
        } catch {
          // If we can't fetch, generate suggestions based on known info
          pageData = {
            url,
            title: COMPANY.name,
            metaDescription: '',
            h1Tags: [],
            h2Tags: [],
            wordCount: 0,
            hasSchema: false,
            content: '',
          };
        }

        const audit = await analyzeStructured(
          SEO_AUDIT_PROMPT(pageData),
          'seo_audit',
          validateSEOAudit
        );
        audit.url = url;

        // Store audit results
        await context.supabase.from('agent_tasks').update({
          output: { audit },
        }).eq('id', context.taskId);

        return {
          success: true,
          data: {
            score: audit.currentScore,
            criticalIssues: audit.issues.filter((i) => i.severity === 'critical').length,
            totalIssues: audit.issues.length,
            highImpactSuggestions: audit.suggestions.filter((s) => s.impact === 'high').length,
            audit,
          },
        };
      }

      if (action === 'generate_content') {
        const topic = input.topic as string;
        const keywords = (input.keywords as string[]) || COMPANY.products;

        if (!topic) {
          return { success: false, error: '缺少内容主题' };
        }

        const content = await analyzeStructured(
          CONTENT_GENERATION_PROMPT(topic, keywords),
          'seo_content',
          (d) => d as Record<string, unknown>
        );

        return {
          success: true,
          data: { content },
        };
      }

      return { success: false, error: `未知操作: ${action}` };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `SEO优化失败: ${errorMsg}` };
    }
  },
};

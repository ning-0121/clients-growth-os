/**
 * Social Publisher Agent — AI-powered social media content creation & management.
 *
 * Flow: Generates content ideas → Creates posts → Schedules publishing
 *       → Monitors engagement → Responds to comments/DMs → Captures leads.
 */

import { Agent, AgentContext, AgentResult, SocialContent } from '../types';
import { COMPANY } from '@/lib/config/company';
import { analyzeStructured } from '@/lib/ai/ai-service';

const CONTENT_PLAN_PROMPT = (platform: string, recentPosts: string[]) => `You are a social media manager for ${COMPANY.name}, a ${COMPANY.description}.

Create a weekly content plan for ${platform}.

Our audience: B2B buyers — fashion brand owners, retailers, wholesalers looking for manufacturing partners.
Our products: ${COMPANY.products.join(', ')}
Our strengths: Competitive pricing, ${COMPANY.moq} MOQ, ${COMPANY.leadTime} lead time, quality control

Recent posts (avoid repeating topics):
${recentPosts.length > 0 ? recentPosts.map((p, i) => `${i + 1}. ${p}`).join('\n') : 'No recent posts'}

Create 7 posts (one per day) with varied content types.

Respond with JSON (no markdown):
{
  "posts": [
    {
      "day": number (1-7),
      "contentType": "educational" | "behind_scenes" | "product_showcase" | "customer_story" | "industry_trend" | "engagement",
      "topic": string,
      "caption": string (the full post text, include hashtags),
      "hashtags": string[] (5-10 relevant hashtags),
      "imagePrompt": string (description for image generation),
      "bestTimeToPost": string (e.g. "9:00 AM EST"),
      "callToAction": string (what action should viewers take)
    }
  ]
}

RULES:
- Mix educational content (40%), product showcases (30%), and engagement posts (30%)
- Use conversational, authentic tone
- Include specific numbers and details
- Each post should provide value, not just sell
- Hashtags should mix popular (#fashion) with niche (#oemclothing)`;

const REPLY_PROMPT = (platform: string, comment: string, postContext: string) => `You are the social media voice of ${COMPANY.name}.

Someone commented on our ${platform} post.

Post context: ${postContext}
Comment: "${comment}"

Write a friendly, helpful reply. Be:
- Conversational and warm
- Knowledgeable about garment manufacturing
- Subtle about driving business (don't hard sell)
- If they ask about pricing/ordering, invite them to DM or email ${COMPANY.salesEmail}

Respond with JSON (no markdown):
{
  "reply": string,
  "shouldDM": boolean (true if this looks like a potential lead),
  "dmMessage": string | null (if shouldDM, what to DM them),
  "leadSignal": "strong" | "moderate" | "none"
}`;

interface ContentPlan {
  posts: {
    day: number;
    contentType: string;
    topic: string;
    caption: string;
    hashtags: string[];
    imagePrompt: string;
    bestTimeToPost: string;
    callToAction: string;
  }[];
}

function validateContentPlan(data: unknown): ContentPlan {
  if (!data || typeof data !== 'object') throw new Error('Invalid');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.posts)) throw new Error('Missing posts');
  return {
    posts: d.posts.map((p: Record<string, unknown>) => ({
      day: Number(p.day || 1),
      contentType: String(p.contentType || 'educational'),
      topic: String(p.topic || ''),
      caption: String(p.caption || ''),
      hashtags: Array.isArray(p.hashtags) ? p.hashtags.map(String) : [],
      imagePrompt: String(p.imagePrompt || ''),
      bestTimeToPost: String(p.bestTimeToPost || '9:00 AM'),
      callToAction: String(p.callToAction || ''),
    })),
  };
}

export const socialPublisherAgent: Agent = {
  role: 'social-publisher',
  pipeline: 'inbound',
  description: 'AI驱动社媒内容创作、发布排期、互动管理，引流到客户池',

  async execute(context: AgentContext): Promise<AgentResult> {
    const input = context.previousResults || {};
    const action = (input.action as string) || 'plan';
    const platform = (input.platform as string) || 'instagram';

    try {
      if (action === 'plan') {
        // Fetch recent posts to avoid repetition
        const { data: recentPosts } = await context.supabase
          .from('social_content')
          .select('topic, caption')
          .eq('platform', platform)
          .order('created_at', { ascending: false })
          .limit(10);

        const recentTopics = (recentPosts || []).map((p: { topic: string }) => p.topic);

        const plan = await analyzeStructured(
          CONTENT_PLAN_PROMPT(platform, recentTopics),
          'social_content_plan',
          validateContentPlan
        );

        // Store content plan in database
        const now = new Date();
        for (const post of plan.posts) {
          const scheduledDate = new Date(now);
          scheduledDate.setDate(now.getDate() + post.day - 1);

          await context.supabase.from('social_content').insert({
            platform,
            content_type: post.contentType,
            topic: post.topic,
            caption: post.caption,
            hashtags: post.hashtags,
            image_prompt: post.imagePrompt,
            scheduled_at: scheduledDate.toISOString(),
            call_to_action: post.callToAction,
            status: 'pending_review',  // AI 生成后自动进入待审核
            created_by: 'ai_agent',
            approval_history: [{
              action: 'submit',
              actor_id: 'system',
              actor_name: 'AI Social Publisher',
              notes: `AI 自动生成 ${platform} 内容，等待人工审核`,
              timestamp: new Date().toISOString(),
            }],
          });
        }

        return {
          success: true,
          data: {
            platform,
            postsPlanned: plan.posts.length,
            posts: plan.posts.map((p) => ({
              day: p.day,
              type: p.contentType,
              topic: p.topic,
            })),
          },
        };
      }

      if (action === 'reply') {
        const comment = input.comment as string;
        const postContext = input.postContext as string;

        if (!comment) {
          return { success: false, error: '缺少评论内容' };
        }

        const reply = await analyzeStructured(
          REPLY_PROMPT(platform, comment, postContext || ''),
          'social_reply',
          (d) => d as Record<string, unknown>
        );

        // If strong lead signal, create lead in pool
        if (reply.leadSignal === 'strong' && reply.shouldDM) {
          // Store as potential lead for follow-up
          await context.supabase.from('growth_leads').insert({
            company_name: (input.commenterName as string) || 'Social Media Lead',
            source: `social_${platform}`,
            status: 'new',
            ai_analysis: {
              channel: platform,
              original_comment: comment,
              lead_signal: reply.leadSignal,
              captured_at: new Date().toISOString(),
            },
          });
        }

        return {
          success: true,
          data: {
            reply: reply.reply,
            shouldDM: reply.shouldDM,
            leadSignal: reply.leadSignal,
          },
        };
      }

      return { success: false, error: `未知操作: ${action}` };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `社媒管理失败: ${errorMsg}` };
    }
  },
};

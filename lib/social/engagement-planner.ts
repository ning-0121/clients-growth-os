import { SupabaseClient } from '@supabase/supabase-js';
import { analyzeStructured, analyzeWithAI } from '@/lib/ai/ai-service';

interface EngagementTarget {
  lead_id: string;
  company_name: string;
  instagram_handle?: string;
  contact_linkedin?: string;
  product_match?: string;
  ai_analysis?: Record<string, any>;
}

interface PlannedEngagement {
  lead_id: string;
  platform: 'instagram' | 'linkedin';
  engagement_type: string;
  target_url: string;
  content: string;
}

/**
 * Select leads eligible for social engagement and generate personalized content.
 * Rules: verified leads with pursue recommendation, has social handles, no recent engagement.
 */
export async function planEngagements(
  supabase: SupabaseClient,
  maxIG = 10,
  maxLinkedIn = 20
): Promise<PlannedEngagement[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const planned: PlannedEngagement[] = [];

  // Find eligible leads for IG engagement
  if (maxIG > 0) {
    const { data: igLeads } = await supabase
      .from('growth_leads')
      .select('id, company_name, instagram_handle, product_match, ai_analysis')
      .eq('verification_status', 'completed')
      .eq('ai_recommendation', 'pursue')
      .not('instagram_handle', 'is', null)
      .limit(maxIG * 2); // fetch extra to filter

    for (const lead of (igLeads || [])) {
      if (planned.filter((p) => p.platform === 'instagram').length >= maxIG) break;

      // Check no recent engagement
      const { data: recent } = await supabase
        .from('social_engagements')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('platform', 'instagram')
        .gte('created_at', sevenDaysAgo)
        .limit(1);

      if (recent && recent.length > 0) continue;

      const comment = await generateIGComment(lead);
      if (comment) {
        planned.push({
          lead_id: lead.id,
          platform: 'instagram',
          engagement_type: 'comment',
          target_url: `https://instagram.com/${lead.instagram_handle}`,
          content: comment,
        });
      }
    }
  }

  // Find eligible leads for LinkedIn engagement
  if (maxLinkedIn > 0) {
    const { data: liLeads } = await supabase
      .from('growth_leads')
      .select('id, company_name, contact_linkedin, contact_name, product_match, ai_analysis')
      .eq('verification_status', 'completed')
      .eq('ai_recommendation', 'pursue')
      .not('contact_linkedin', 'is', null)
      .limit(maxLinkedIn * 2);

    for (const lead of (liLeads || [])) {
      if (planned.filter((p) => p.platform === 'linkedin').length >= maxLinkedIn) break;

      const { data: recent } = await supabase
        .from('social_engagements')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('platform', 'linkedin')
        .gte('created_at', sevenDaysAgo)
        .limit(1);

      if (recent && recent.length > 0) continue;

      const note = await generateLinkedInNote(lead);
      if (note) {
        planned.push({
          lead_id: lead.id,
          platform: 'linkedin',
          engagement_type: 'connection_request',
          target_url: lead.contact_linkedin,
          content: note,
        });
      }
    }
  }

  return planned;
}

async function generateIGComment(lead: Record<string, any>): Promise<string | null> {
  const categories = lead.ai_analysis?.product_categories?.join(', ') || lead.product_match || 'apparel';

  const prompt = `Write a short Instagram comment on a post from ${lead.company_name}, a ${categories} brand.
The comment should be genuine, relevant to their products, and NOT salesy. 1-2 sentences max. Sound like a real person in the fashion industry who genuinely likes their products.
Do NOT mention manufacturing, OEM, or sourcing.
Examples of good comments: "Love the color palette on this collection", "This fabric looks amazing, perfect for summer"
Respond with just the comment text, no JSON, no quotes.`;

  try {
    const result = await analyzeWithAI(prompt, 'ig_comment_generation', { leadId: lead.id });
    const cleaned = result.replace(/^["']|["']$/g, '').trim();
    return cleaned.length > 0 && cleaned.length < 300 ? cleaned : null;
  } catch {
    return null;
  }
}

async function generateLinkedInNote(lead: Record<string, any>): Promise<string | null> {
  const name = lead.contact_name || 'there';
  const company = lead.company_name;
  const categories = lead.ai_analysis?.product_categories?.join(', ') || 'apparel';

  const prompt = `Write a short LinkedIn connection request note to ${name} at ${company} (${categories}).
Max 280 characters (LinkedIn limit). Be professional but warm. Mention something about their industry/products. Don't hard-sell.
Example: "Hi [Name], came across ${company} — really like what you're doing with [product area]. Would love to connect and exchange ideas."
Respond with just the note text, no JSON, no quotes.`;

  try {
    const result = await analyzeWithAI(prompt, 'linkedin_note_generation', { leadId: lead.id });
    const cleaned = result.replace(/^["']|["']$/g, '').trim();
    return cleaned.length > 0 && cleaned.length <= 300 ? cleaned : null;
  } catch {
    return null;
  }
}

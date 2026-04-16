import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { huntContacts } from '@/lib/scrapers/contact-hunter';
import { enrichCompanyInfo } from '@/lib/scrapers/external-tools';

/**
 * POST /api/leads/re-enrich
 * Re-enrich existing leads with deep contact hunting + company info.
 * Fills in: phone, address, decision makers, company details.
 * Can run via cron or manual trigger.
 */
export async function GET(request: Request) { return handleRequest(request); }
export async function POST(request: Request) { return handleRequest(request); }

async function handleRequest(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get('x-vercel-cron');

  if (!vercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Find leads that need enrichment (have website but missing key info)
    const { data: leads } = await supabase
      .from('growth_leads')
      .select('id, company_name, website, contact_name, contact_email, contact_phone, contact_address, contact_people, contact_linkedin, instagram_handle')
      .in('status', ['new', 'qualified'])
      .not('website', 'is', null)
      .is('contact_phone', null) // Missing phone = needs enrichment
      .order('deal_probability', { ascending: false })
      .limit(3); // Only 3 per run to stay within timeout

    if (!leads || leads.length === 0) {
      return NextResponse.json({ success: true, message: 'All leads enriched', processed: 0 });
    }

    let enriched = 0;

    for (const lead of leads) {
      try {
        // Run full contact hunter
        const contacts = await huntContacts(lead.website, lead.company_name, lead.contact_name || undefined);

        // Run company enrichment
        const company = await enrichCompanyInfo(lead.company_name);

        // Build update
        const update: Record<string, any> = {};

        // Best email (if current one is generic, upgrade to personal)
        const currentLocal = (lead.contact_email || '').split('@')[0]?.toLowerCase();
        const isGeneric = ['info', 'sales', 'hello', 'contact', 'support', 'help', 'customerservice', 'care', 'admin'].includes(currentLocal);
        if (isGeneric || !lead.contact_email) {
          const personalEmail = contacts.emails.find(e => e.confidence >= 70);
          if (personalEmail) update.contact_email = personalEmail.email;
        }

        // Phone
        if (!lead.contact_phone && contacts.phones.length > 0) {
          update.contact_phone = contacts.phones[0].phone;
        }

        // Address
        if (!lead.contact_address) {
          const addr = contacts.addresses[0]?.address || company.location;
          if (addr) update.contact_address = addr;
        }

        // Decision makers / contacts
        if (!lead.contact_people && contacts.contacts.length > 0) {
          update.contact_people = contacts.contacts;
        }

        // Contact name (from contacts found)
        if (!lead.contact_name && contacts.contacts.length > 0) {
          update.contact_name = contacts.contacts[0].name;
        }

        // LinkedIn
        if (!lead.contact_linkedin) {
          const li = contacts.social.find(s => s.platform === 'linkedin');
          if (li) update.contact_linkedin = li.url;
        }

        // Instagram
        if (!lead.instagram_handle) {
          const ig = contacts.social.find(s => s.platform === 'instagram');
          if (ig) {
            const match = ig.url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
            if (match) update.instagram_handle = match[1];
          }
        }

        // Company info from enrichment
        if (company.founded || company.employees || company.revenue) {
          const existingAI = (lead as any).ai_analysis || {};
          update.ai_analysis = {
            ...existingAI,
            founded: company.founded || existingAI.founded,
            employees: company.employees || existingAI.employees,
            revenue: company.revenue || existingAI.revenue,
            headquarters: company.location || existingAI.headquarters,
          };
        }

        if (Object.keys(update).length > 0) {
          await supabase.from('growth_leads').update(update).eq('id', lead.id);
          enriched++;
        }
      } catch (err) {
        console.error(`[Re-Enrich] Failed for ${lead.company_name}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      processed: leads.length,
      enriched,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

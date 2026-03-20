import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import GrowthNavbar from '@/components/GrowthNavbar';
import { GrowthLead } from '@/lib/types';
import LeadActionPanel from './LeadActionPanel';

export default async function MyTodayPage() {
  const user = await requireAuth();
  const profile = await getCurrentProfile();
  const role = profile?.role || '';

  if (role !== '销售' && role !== '管理员') {
    redirect('/login');
  }

  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // All active leads assigned to current user
  const { data: myLeads } = await supabase
    .from('growth_leads')
    .select('*')
    .eq('assigned_to', user.id)
    .in('status', ['new', 'qualified'])
    .order('final_score', { ascending: false });

  const leads = (myLeads || []) as GrowthLead[];

  // Mutually exclusive bucketing — each lead goes into exactly one section.
  // Priority order: overdue follow-up > overdue first-touch > new > upcoming
  const buckets = {
    followUp: [] as GrowthLead[],    // has first_touch, next_action_due <= now
    firstTouch: [] as GrowthLead[],  // no first_touch, next_action_due <= now
    newlyAssigned: [] as GrowthLead[], // no actions, not yet due
    upcoming: [] as GrowthLead[],     // has actions, next due is in the future
  };

  for (const lead of leads) {
    const isDue = lead.next_action_due && lead.next_action_due <= nowIso;

    if (lead.first_touch_at && isDue) {
      buckets.followUp.push(lead);
    } else if (!lead.first_touch_at && isDue) {
      buckets.firstTouch.push(lead);
    } else if (lead.action_count === 0 && !isDue) {
      buckets.newlyAssigned.push(lead);
    } else {
      buckets.upcoming.push(lead);
    }
  }

  // Sort overdue sections: most overdue first
  const sortByOverdue = (a: GrowthLead, b: GrowthLead) =>
    (a.next_action_due || '').localeCompare(b.next_action_due || '');
  buckets.followUp.sort(sortByOverdue);
  buckets.firstTouch.sort(sortByOverdue);

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My Leads</h1>
          <p className="text-sm text-gray-500 mt-1">
            {profile?.name || '—'} · 活跃线索 {leads.length} 条
          </p>
        </div>

        <LeadSection
          title="待跟进"
          subtitle="已触达，到期需要跟进"
          leads={buckets.followUp}
          emptyText="无待跟进线索"
          color="orange"
          now={now}
        />

        <LeadSection
          title="待首触"
          subtitle="已到首触时间，需要立即行动"
          leads={buckets.firstTouch}
          emptyText="无待首触线索"
          color="amber"
          now={now}
        />

        <LeadSection
          title="新分配"
          subtitle="刚分配，尚未到首触时间"
          leads={buckets.newlyAssigned}
          emptyText="无新分配线索"
          color="blue"
          now={now}
        />

        {buckets.upcoming.length > 0 && (
          <LeadSection
            title="进行中"
            subtitle="已有触达记录，下次跟进尚未到期"
            leads={buckets.upcoming}
            emptyText=""
            color="gray"
            now={now}
          />
        )}
      </div>
    </div>
  );
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  'B+': 'bg-blue-100 text-blue-800',
  B: 'bg-yellow-100 text-yellow-800',
  C: 'bg-gray-100 text-gray-600',
};

const COLOR_MAP: Record<string, string> = {
  blue: 'border-blue-300 bg-blue-50',
  amber: 'border-amber-300 bg-amber-50',
  orange: 'border-orange-300 bg-orange-50',
  green: 'border-green-300 bg-green-50',
  gray: 'border-gray-200 bg-white',
};

/**
 * Determine the ONE recommended action for a lead.
 * Returns the action_type to highlight in the panel.
 */
function getRecommendation(lead: GrowthLead): { action: string; label: string } {
  if (!lead.first_touch_at) {
    // No first touch yet — recommend based on available contacts
    if (lead.contact_email) return { action: 'email', label: '发送首次邮件' };
    if (lead.contact_linkedin) return { action: 'social_outreach', label: 'LinkedIn 首次触达' };
    if (lead.instagram_handle) return { action: 'social_outreach', label: 'Instagram 首次触达' };
    return { action: 'social_outreach', label: '查找联系方式并触达' };
  }
  // Has first touch — recommend follow-up
  if (lead.action_count <= 2) {
    if (lead.contact_email) return { action: 'email', label: '发送跟进邮件' };
    return { action: 'social_outreach', label: '发送跟进消息' };
  }
  // Multiple touches done — escalate to call
  return { action: 'call', label: '电话跟进' };
}

function overdueLabel(lead: GrowthLead, now: Date): string | null {
  if (!lead.next_action_due) return null;
  const due = new Date(lead.next_action_due);
  if (due > now) return null;
  const diffMs = now.getTime() - due.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return '刚到期';
  if (diffH < 24) return `逾期 ${diffH} 小时`;
  const diffD = Math.floor(diffH / 24);
  return `逾期 ${diffD} 天`;
}

function LeadSection({
  title,
  subtitle,
  leads,
  emptyText,
  color,
  now,
}: {
  title: string;
  subtitle: string;
  leads: GrowthLead[];
  emptyText: string;
  color: string;
  now: Date;
}) {
  const borderColor = COLOR_MAP[color] || COLOR_MAP.blue;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
          {leads.length}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-3">{subtitle}</p>

      {leads.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-400">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => {
            const rec = getRecommendation(lead);
            const overdue = overdueLabel(lead, now);
            return (
              <div
                key={lead.id}
                className={`rounded-lg border p-4 ${borderColor}`}
              >
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Link href={`/growth/leads/${lead.id}`} className="font-semibold text-gray-900 hover:text-blue-600 hover:underline">{lead.company_name}</Link>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${GRADE_COLORS[lead.grade || 'C']}`}>
                        {lead.grade}
                      </span>
                      <span className="text-xs text-gray-500">{lead.source || ''}</span>
                      {overdue && (
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                          {overdue}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs text-gray-600 mb-2">
                      <span>综合分 {lead.final_score}</span>
                      <span>机会 {lead.opportunity_score}</span>
                      {lead.action_count > 0 && (
                        <span>已触达 {lead.action_count} 次</span>
                      )}
                      {lead.product_match && (
                        <span className="text-gray-500 truncate max-w-[200px]">
                          产品: {lead.product_match}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 text-xs mb-2">
                      {lead.contact_email && (
                        <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">邮箱</span>
                      )}
                      {lead.contact_linkedin && (
                        <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">LI</span>
                      )}
                      {lead.instagram_handle && (
                        <span className="bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">IG</span>
                      )}
                    </div>
                    <div className="text-xs">
                      <span className="text-gray-500">下一步:</span>{' '}
                      <span className="font-semibold text-gray-900">{rec.label}</span>
                    </div>
                  </div>
                  <LeadActionPanel
                    leadId={lead.id}
                    leadName={lead.company_name}
                    recommendedAction={rec.action}
                    prefillEmail={lead.contact_email || ''}
                    prefillPlatform={lead.contact_linkedin ? 'linkedin' : lead.instagram_handle ? 'instagram' : 'linkedin'}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { pauseCampaign, resumeCampaign } from '@/app/actions/outreach';

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  active: { label: '进行中', color: 'bg-green-100 text-green-700' },
  paused: { label: '已暂停', color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: '已完成', color: 'bg-gray-100 text-gray-600' },
  replied: { label: '已回复', color: 'bg-blue-100 text-blue-700' },
  bounced: { label: '退信', color: 'bg-red-100 text-red-700' },
  unsubscribed: { label: '退订', color: 'bg-red-100 text-red-600' },
};

export default function OutreachDashboard({ campaigns }: { campaigns: any[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all'
    ? campaigns
    : campaigns.filter((c: any) => c.status === filter);

  async function handlePause(id: string) {
    setLoadingId(id);
    await pauseCampaign(id);
    setLoadingId(null);
  }

  async function handleResume(id: string) {
    setLoadingId(id);
    await resumeCampaign(id);
    setLoadingId(null);
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Filter tabs */}
      <div className="flex gap-2 px-4 py-3 border-b overflow-x-auto">
        {['all', 'active', 'replied', 'completed', 'paused', 'bounced'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            {f === 'all' ? '全部' : STATUS_BADGES[f]?.label || f}
            <span className="ml-1 text-gray-400">
              {f === 'all' ? campaigns.length : campaigns.filter((c: any) => c.status === f).length}
            </span>
          </button>
        ))}
      </div>

      {/* Campaign list */}
      <div className="divide-y">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            暂无数据。验证通过的线索会自动加入开发信序列。
          </div>
        ) : (
          filtered.map((campaign: any) => {
            const lead = campaign.growth_leads;
            const sequence = campaign.outreach_sequences;
            const steps = (sequence?.steps || []) as any[];
            const badge = STATUS_BADGES[campaign.status] || { label: campaign.status, color: 'bg-gray-100' };

            return (
              <div key={campaign.id} className="px-4 py-3 flex items-center gap-3">
                {/* Status badge */}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
                  {badge.label}
                </span>

                {/* Lead info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {lead?.company_name || '未知'}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {lead?.contact_email} · Step {campaign.current_step}/{steps.length} · {sequence?.name}
                  </div>
                </div>

                {/* Grade */}
                {lead?.grade && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                    {lead.grade}
                  </span>
                )}

                {/* AI Recommendation */}
                {lead?.ai_recommendation && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    lead.ai_recommendation === 'pursue' ? 'bg-green-100 text-green-600' :
                    lead.ai_recommendation === 'investigate' ? 'bg-yellow-100 text-yellow-600' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {lead.ai_recommendation}
                  </span>
                )}

                {/* Next send time */}
                {campaign.status === 'active' && campaign.next_send_at && (
                  <span className="text-xs text-gray-400">
                    下次: {new Date(campaign.next_send_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}

                {/* Actions */}
                {campaign.status === 'active' && (
                  <button
                    onClick={() => handlePause(campaign.id)}
                    disabled={loadingId === campaign.id}
                    className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-yellow-100 text-gray-600 hover:text-yellow-700"
                  >
                    {loadingId === campaign.id ? '...' : '暂停'}
                  </button>
                )}
                {campaign.status === 'paused' && (
                  <button
                    onClick={() => handleResume(campaign.id)}
                    disabled={loadingId === campaign.id}
                    className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-green-100 text-gray-600 hover:text-green-700"
                  >
                    {loadingId === campaign.id ? '...' : '恢复'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import CustomerDetailCard from './CustomerDetailCard';

type TabId = 'today' | 'awaiting' | 'replied' | 'silent';

interface Props {
  todayLeads: any[];
  awaitingReply: any[];
  repliedLeads: any[];
  silentLeads: any[];
  isAdmin: boolean;
  salesStaff: any[];
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bgColor: string; border: string }> = {
  A: { label: 'A级', color: 'text-green-700', bgColor: 'bg-green-100', border: 'border-green-200' },
  B: { label: 'B级', color: 'text-blue-700', bgColor: 'bg-blue-100', border: 'border-blue-200' },
  C: { label: 'C级', color: 'text-amber-700', bgColor: 'bg-amber-100', border: 'border-amber-200' },
  D: { label: 'D级', color: 'text-gray-500', bgColor: 'bg-gray-100', border: 'border-gray-200' },
};

export default function DealsTabs({ todayLeads, awaitingReply, repliedLeads, silentLeads, isAdmin, salesStaff }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('today');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'today', label: '今日客户', count: todayLeads.length },
    { id: 'awaiting', label: '已开发待回复', count: awaitingReply.length },
    { id: 'replied', label: '已回复客户', count: repliedLeads.length },
    { id: 'silent', label: '长期不回复', count: silentLeads.length },
  ];

  const currentLeads = activeTab === 'today' ? todayLeads
    : activeTab === 'awaiting' ? awaitingReply
    : activeTab === 'replied' ? repliedLeads
    : silentLeads;

  // Sort by category A→B→C→D
  const sorted = [...currentLeads].sort((a, b) => {
    const order = { A: 0, B: 1, C: 2, D: 3 };
    return (order[a.category as keyof typeof order] || 3) - (order[b.category as keyof typeof order] || 3);
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setExpandedId(null); }}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4">
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {activeTab === 'today' ? '暂无客户，系统正在 24 小时自动发现中...' :
             activeTab === 'awaiting' ? '暂无待回复客户' :
             activeTab === 'replied' ? '暂无已回复客户' :
             '暂无长期不回复客户'}
          </p>
        ) : (
          <div className="space-y-2">
            {sorted.map((lead: any) => {
              const cat = CATEGORY_CONFIG[lead.category] || CATEGORY_CONFIG.D;
              const isExpanded = expandedId === lead.id;
              const prob = lead.deal_probability || 0;
              const daysSince = lead.last_action_at
                ? Math.floor((Date.now() - new Date(lead.last_action_at).getTime()) / 86400000)
                : null;

              return (
                <div key={lead.id}>
                  {/* Lead row */}
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors hover:bg-gray-50 ${
                      isExpanded ? 'border-indigo-300 bg-indigo-50/30' : cat.border
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Category badge */}
                      <span className={`text-xs font-bold px-2 py-1 rounded ${cat.bgColor} ${cat.color} flex-shrink-0`}>
                        {cat.label}
                      </span>

                      {/* Probability */}
                      <div className="w-10 text-center flex-shrink-0">
                        <span className="text-sm font-bold text-gray-900">{prob}%</span>
                      </div>

                      {/* Company info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{lead.company_name}</span>
                          {lead.contact_name && <span className="text-xs text-gray-400">({lead.contact_name})</span>}
                          {lead.escalation_level >= 1 && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-1 py-0.5 rounded">升级</span>
                          )}
                        </div>
                        {lead.next_recommended_action && (
                          <span className="text-xs text-indigo-600">{lead.next_recommended_action}</span>
                        )}
                      </div>

                      {/* Email stats */}
                      {lead.email_stats && (
                        <div className="text-xs text-gray-400 flex-shrink-0">
                          发{lead.email_stats.sent} 开{lead.email_stats.opened}
                        </div>
                      )}

                      {/* Days since */}
                      <div className="text-xs text-gray-400 flex-shrink-0 w-16 text-right">
                        {lead.assigned_name && <div>{lead.assigned_name}</div>}
                        {daysSince !== null && (
                          <div className={daysSince > 14 ? 'text-red-500 font-medium' : ''}>
                            {daysSince === 0 ? '今天' : `${daysSince}天前`}
                          </div>
                        )}
                      </div>

                      {/* Expand arrow */}
                      <span className="text-gray-400 flex-shrink-0">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {/* Expanded detail card */}
                  {isExpanded && (
                    <CustomerDetailCard lead={lead} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { STAGE_CONFIG, ProbabilityStage } from '@/lib/growth/deal-probability';

type TabId = 'boss' | 'hot' | 'risk' | 'all';

const TABS: { id: TabId; label: string; sublabel: string }[] = [
  { id: 'boss', label: '老板视图', sublabel: 'Boss View' },
  { id: 'hot', label: '高潜池', sublabel: 'High Potential' },
  { id: 'risk', label: '风险池', sublabel: 'At Risk' },
  { id: 'all', label: '全部客户', sublabel: 'All Leads' },
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'bg-red-100 text-red-700',
  P1: 'bg-orange-100 text-orange-700',
  P2: 'bg-blue-100 text-blue-700',
  P3: 'bg-gray-100 text-gray-500',
};

interface Props {
  leads: any[];
}

export default function ProbabilityDashboard({ leads }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('boss');

  const filtered = (() => {
    switch (activeTab) {
      case 'boss':
        return leads.filter((l: any) =>
          l.escalation_level >= 2 ||
          l.deal_probability >= 70 ||
          (l.deal?.estimated_order_value || 0) > 30000
        );
      case 'hot':
        return leads.filter((l: any) => l.deal_probability >= 61);
      case 'risk':
        return leads.filter((l: any) =>
          l.reactivation_needed ||
          (l.risk_score > 15 && l.deal_probability > 0)
        );
      case 'all':
      default:
        return leads;
    }
  })();

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-3 text-center transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-indigo-600 bg-white'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <div className={`text-sm font-medium ${activeTab === tab.id ? 'text-indigo-600' : ''}`}>
              {tab.label}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{tab.sublabel}</div>
          </button>
        ))}
      </div>

      {/* Lead list */}
      <div className="p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {activeTab === 'boss' ? '暂无需要老板关注的客户' :
             activeTab === 'hot' ? '暂无高潜客户，系统正在发现中...' :
             activeTab === 'risk' ? '暂无风险客户' :
             '暂无活跃线索'}
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((lead: any) => (
              <LeadProbabilityCard key={lead.id} lead={lead} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LeadProbabilityCard({ lead }: { lead: any }) {
  const stage = (lead.probability_stage || 'cold') as ProbabilityStage;
  const stageConfig = STAGE_CONFIG[stage] || STAGE_CONFIG.cold;
  const probability = lead.deal_probability || 0;

  // Progress bar color
  const barColor = probability >= 81 ? 'bg-green-500'
    : probability >= 61 ? 'bg-orange-500'
    : probability >= 41 ? 'bg-blue-500'
    : probability >= 21 ? 'bg-yellow-500'
    : 'bg-gray-300';

  // Time since engagement
  const lastEngagement = lead.last_engagement_at || lead.last_action_at;
  const daysSince = lastEngagement
    ? Math.floor((Date.now() - new Date(lastEngagement).getTime()) / 86400000)
    : null;

  return (
    <div className={`border rounded-lg p-4 ${
      lead.escalation_level >= 2 ? 'border-purple-300 bg-purple-50/30' :
      lead.reactivation_needed ? 'border-red-200 bg-red-50/30' :
      probability >= 61 ? 'border-green-200' :
      'border-gray-200'
    }`}>
      {/* Top row: name + probability */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{lead.company_name}</span>
          {lead.contact_name && (
            <span className="text-xs text-gray-500">({lead.contact_name})</span>
          )}
          {lead.escalation_level >= 2 && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700 font-medium">老板关注</span>
          )}
          {lead.escalation_level === 1 && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">高级销售</span>
          )}
          {lead.reactivation_needed && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700">需要激活</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stageConfig.bgColor} ${stageConfig.color}`}>
            {stageConfig.labelCn}
          </span>
          <span className="text-lg font-bold text-gray-900">{probability}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
        <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${probability}%` }} />
      </div>

      {/* Info row */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3 text-gray-500">
          {lead.deal?.deal_stage && (
            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Deal: {lead.deal.deal_stage}</span>
          )}
          {lead.deal?.estimated_order_value && (
            <span>${Number(lead.deal.estimated_order_value).toLocaleString()}</span>
          )}
          {lead.source && <span className="text-gray-400">{lead.source}</span>}
          {lead.assigned_name && <span>{lead.assigned_name}</span>}
          {daysSince !== null && (
            <span className={daysSince > 14 ? 'text-red-500 font-medium' : ''}>
              {daysSince === 0 ? '今天互动' : `${daysSince}天前互动`}
            </span>
          )}
        </div>
      </div>

      {/* Recommended action */}
      {lead.next_recommended_action && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-500">推荐:</span>
          <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
            {lead.next_recommended_action}
          </span>
          <span className="text-xs text-gray-400">{lead.next_action_reason}</span>
        </div>
      )}
    </div>
  );
}

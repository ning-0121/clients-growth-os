'use client';

import { useState } from 'react';
import Link from 'next/link';
import IntakeTabHub from '../intake/IntakeTabHub';
import CalendarViewSwitcher from '../calendar/CalendarViewSwitcher';
import CustomerProfileForm from '../calendar/CustomerProfileForm';

type TabId = 'all' | 'hot' | 'risk' | 'cold' | 'intake' | 'calendar' | 'boss';

interface Props {
  leads: any[];
  isAdmin: boolean;
  customers: any[];
  configs: any[];
  tasks: any[];
}

const PROB_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  hot:             { dot: 'bg-green-500',  bg: 'bg-green-100',  text: 'text-green-700' },
  high_interest:   { dot: 'bg-orange-500', bg: 'bg-orange-100', text: 'text-orange-700' },
  interested:      { dot: 'bg-blue-500',   bg: 'bg-blue-100',   text: 'text-blue-700' },
  slight_interest: { dot: 'bg-yellow-400', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  cold:            { dot: 'bg-gray-300',   bg: 'bg-gray-100',   text: 'text-gray-600' },
};

const STAGE_LABELS: Record<string, string> = {
  hot: '高概率', high_interest: '高兴趣', interested: '有兴趣',
  slight_interest: '微兴趣', cold: '冷客户',
};

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-800', 'B+': 'bg-blue-100 text-blue-800',
  B: 'bg-yellow-100 text-yellow-800', C: 'bg-gray-100 text-gray-600',
};

const SOURCE_LABELS: Record<string, string> = {
  ig: 'IG', linkedin: 'LI', website: '网站', customs: '海关', referral: '推荐',
  test_batch: '测试', google: '搜索', apollo: 'Apollo', directory: '目录',
};

export default function LeadsTabSwitcher({ leads, isAdmin, customers, configs, tasks }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('all');

  const activeLeads = leads.filter((l: any) => l.status !== 'disqualified');

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'all', label: '全部客户', show: true },
    { id: 'hot', label: '高潜客户', show: true },
    { id: 'risk', label: '风险客户', show: true },
    { id: 'cold', label: '冷客户池', show: true },
    { id: 'boss', label: '老板关注', show: isAdmin },
    { id: 'intake', label: '录入新客户', show: true },
    { id: 'calendar', label: '采购日历', show: true },
  ];

  const filtered = (() => {
    switch (activeTab) {
      case 'hot': return activeLeads.filter((l: any) => (l.deal_probability || 0) >= 61);
      case 'risk': return activeLeads.filter((l: any) => l.reactivation_needed || ((l.deal_probability || 0) > 20 && daysSince(l.last_action_at) > 14));
      case 'cold': return activeLeads.filter((l: any) => (l.deal_probability || 0) > 0 && (l.deal_probability || 0) <= 20);
      case 'boss': return activeLeads.filter((l: any) => l.escalation_level >= 1 || (l.deal_probability || 0) >= 70);
      default: return activeLeads;
    }
  })();

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-gray-200">
        {tabs.filter(t => t.show).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === 'intake' ? (
          <IntakeTabHub />
        ) : activeTab === 'calendar' ? (
          <div>
            <div className="flex justify-end mb-4">
              <CustomerProfileForm customers={customers} configs={configs} />
            </div>
            <CalendarViewSwitcher
              tasks={tasks}
              customers={customers}
              configs={configs}
              deals={[]}
              staffMap={{}}
              today={new Date().toISOString().split('T')[0]}
            />
          </div>
        ) : (
          <>
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">
                {activeTab === 'hot' ? '暂无高潜客户，系统正在持续发现中...' :
                 activeTab === 'risk' ? '暂无风险客户' :
                 activeTab === 'cold' ? '暂无冷客户' :
                 activeTab === 'boss' ? '暂无需要老板关注的客户' :
                 '暂无客户数据'}
              </p>
            ) : (
              <div className="space-y-2">
                {filtered.map((lead: any) => (
                  <LeadRow key={lead.id} lead={lead} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function LeadRow({ lead }: { lead: any }) {
  const prob = lead.deal_probability || 0;
  const stage = lead.probability_stage || 'cold';
  const pc = PROB_COLORS[stage] || PROB_COLORS.cold;
  const days = daysSince(lead.last_action_at);

  return (
    <div className={`border rounded-lg p-3 flex items-center gap-3 ${
      lead.escalation_level >= 2 ? 'border-purple-200 bg-purple-50/30' :
      lead.reactivation_needed ? 'border-red-200 bg-red-50/30' :
      prob >= 61 ? 'border-green-200' : 'border-gray-100'
    }`}>
      {/* Probability */}
      <div className="w-14 text-center flex-shrink-0">
        <div className="text-lg font-bold text-gray-900">{prob}%</div>
        <div className={`text-xs px-1 py-0.5 rounded ${pc.bg} ${pc.text}`}>{STAGE_LABELS[stage]}</div>
      </div>

      {/* Progress bar */}
      <div className="w-16 flex-shrink-0">
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div className={`h-1.5 rounded-full ${pc.dot}`} style={{ width: `${prob}%` }} />
        </div>
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/growth/leads/${lead.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate">
            {lead.company_name}
          </Link>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${GRADE_COLORS[lead.grade || 'C']}`}>{lead.grade}</span>
          <span className="text-xs text-gray-400">{SOURCE_LABELS[lead.source] || lead.source}</span>
          {lead.escalation_level >= 2 && <span className="text-xs bg-purple-100 text-purple-700 px-1 py-0.5 rounded">老板</span>}
          {lead.escalation_level === 1 && <span className="text-xs bg-indigo-100 text-indigo-700 px-1 py-0.5 rounded">高级</span>}
          {lead.reactivation_needed && <span className="text-xs bg-red-100 text-red-700 px-1 py-0.5 rounded">需激活</span>}
        </div>
        {lead.next_recommended_action && (
          <div className="text-xs mt-0.5">
            <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{lead.next_recommended_action}</span>
          </div>
        )}
      </div>

      {/* Right info */}
      <div className="text-right text-xs text-gray-400 flex-shrink-0">
        {lead.assigned_name && <div>{lead.assigned_name}</div>}
        <div className={days > 14 ? 'text-red-500 font-medium' : ''}>
          {days === 0 ? '今天' : days < 999 ? `${days}天前` : '—'}
        </div>
      </div>
    </div>
  );
}

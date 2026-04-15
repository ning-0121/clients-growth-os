'use client';

import { useState } from 'react';
import Link from 'next/link';
import AIDiscoveryPanel from './AIDiscoveryPanel';
import PhantomBusterPanel from './PhantomBusterPanel';
import CustomsExplorer from './CustomsExplorer';
import SmartImportPanel from './SmartImportPanel';

type TabId = 'all' | 'ai_discovery' | 'phantombuster' | 'customs' | 'import' | 'boss';

interface Props {
  leads: any[];
  isAdmin: boolean;
  customers: any[];
  configs: any[];
  tasks: any[];
  customsCount?: number;
  matchedCount?: number;
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

// Categorize leads by quality
function categorize(l: any): 'A' | 'B' | 'C' | 'D' {
  const prob = l.deal_probability || 0;
  if (prob >= 61 || (l.grade === 'A' && l.action_count > 0)) return 'A';
  if (prob >= 41 || (l.grade === 'B+' && l.action_count > 0)) return 'B';
  if (prob >= 21 || l.first_touch_at) return 'C';
  return 'D';
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  A: { label: 'A级', color: 'text-green-700', bgColor: 'bg-green-100' },
  B: { label: 'B级', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  C: { label: 'C级', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  D: { label: 'D级', color: 'text-gray-500', bgColor: 'bg-gray-100' },
};

export default function LeadsTabSwitcher({ leads, isAdmin, customers, configs, tasks, customsCount = 0, matchedCount = 0 }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('all');

  const activeLeads = leads.filter((l: any) => l.status !== 'disqualified');

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'all', label: '客户分类列表', show: true },
    { id: 'ai_discovery', label: 'AI 自动开发', show: true },
    { id: 'phantombuster', label: 'LinkedIn 导入', show: true },
    { id: 'customs', label: '海关数据', show: true },
    { id: 'import', label: '智能导入', show: true },
    { id: 'boss', label: '老板关注', show: isAdmin },
  ];

  // For customer list: sort by category then probability
  const categorizedLeads = activeLeads.map((l: any) => ({ ...l, category: categorize(l) }));
  const sortedLeads = activeTab === 'boss'
    ? categorizedLeads.filter((l: any) => l.escalation_level >= 1 || (l.deal_probability || 0) >= 70)
    : categorizedLeads.sort((a: any, b: any) => {
        const order = { A: 0, B: 1, C: 2, D: 3 };
        const catDiff = (order[a.category as keyof typeof order] || 3) - (order[b.category as keyof typeof order] || 3);
        if (catDiff !== 0) return catDiff;
        return (b.deal_probability || 0) - (a.deal_probability || 0);
      });

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
        {activeTab === 'ai_discovery' && <AIDiscoveryPanel />}

        {activeTab === 'phantombuster' && <PhantomBusterPanel />}

        {activeTab === 'customs' && <CustomsExplorer customsCount={customsCount} matchedCount={matchedCount} />}

        {activeTab === 'import' && <SmartImportPanel />}

        {(activeTab === 'all' || activeTab === 'boss') && (
          <>
            {sortedLeads.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">
                {activeTab === 'boss' ? '暂无需要老板关注的客户' : '暂无客户数据，请通过 AI 自动开发或其他方式导入'}
              </p>
            ) : (
              <>
                {/* Category summary */}
                {activeTab === 'all' && (
                  <div className="flex gap-4 mb-4 text-xs">
                    {(['A', 'B', 'C', 'D'] as const).map(cat => {
                      const count = categorizedLeads.filter((l: any) => l.category === cat).length;
                      const cfg = CATEGORY_CONFIG[cat];
                      return (
                        <span key={cat} className={`px-2 py-1 rounded ${cfg.bgColor} ${cfg.color} font-medium`}>
                          {cfg.label} {count}个
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-2">
                  {sortedLeads.map((lead: any) => (
                    <LeadRow key={lead.id} lead={lead} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LeadRow({ lead }: { lead: any }) {
  const prob = lead.deal_probability || 0;
  const stage = lead.probability_stage || 'cold';
  const pc = PROB_COLORS[stage] || PROB_COLORS.cold;
  const cat = CATEGORY_CONFIG[lead.category] || CATEGORY_CONFIG.D;
  const days = lead.last_action_at
    ? Math.floor((Date.now() - new Date(lead.last_action_at).getTime()) / 86400000)
    : null;

  return (
    <Link href={`/growth/leads/${lead.id}`} className="block">
    <div className={`border rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors ${
      lead.escalation_level >= 2 ? 'border-purple-200 bg-purple-50/30' :
      lead.reactivation_needed ? 'border-red-200 bg-red-50/30' :
      lead.category === 'A' ? 'border-green-200' : 'border-gray-100'
    }`}>
      {/* Category */}
      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cat.bgColor} ${cat.color} flex-shrink-0`}>
        {cat.label}
      </span>

      {/* Probability */}
      <div className="w-12 text-center flex-shrink-0">
        <div className="text-sm font-bold text-gray-900">{prob}%</div>
        <div className="w-full bg-gray-100 rounded-full h-1 mt-0.5">
          <div className={`h-1 rounded-full ${pc.dot}`} style={{ width: `${prob}%` }} />
        </div>
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">{lead.company_name}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${GRADE_COLORS[lead.grade || 'C']}`}>{lead.grade}</span>
          <span className="text-xs text-gray-400">{SOURCE_LABELS[lead.source] || lead.source}</span>
          {lead.escalation_level >= 1 && <span className="text-xs bg-purple-100 text-purple-700 px-1 py-0.5 rounded">升级</span>}
          {lead.reactivation_needed && <span className="text-xs bg-red-100 text-red-700 px-1 py-0.5 rounded">需激活</span>}
        </div>
        {lead.next_recommended_action && (
          <div className="text-xs mt-0.5">
            <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{lead.next_recommended_action}</span>
          </div>
        )}
      </div>

      {/* Right */}
      <div className="text-right text-xs text-gray-400 flex-shrink-0">
        {lead.assigned_name && <div>{lead.assigned_name}</div>}
        <div className={days !== null && days > 14 ? 'text-red-500 font-medium' : ''}>
          {days === 0 ? '今天' : days !== null && days < 999 ? `${days}天前` : '—'}
        </div>
      </div>
    </div>
    </Link>
  );
}

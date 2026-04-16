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

/**
 * 客户分级标准（核心原则：能联系上决策人的才是好线索）
 *
 * A级（可以直接开发）:
 *   - 有个人邮箱（不是 info@/support@/sales@）或有 LinkedIn 个人页
 *   - AI 确认是服装行业
 *   - 有产品匹配
 *
 * B级（有潜力，需要补充信息）:
 *   - 有通用邮箱（info@/sales@）+ AI确认服装行业
 *   - 或者有 IG + 网站 + 产品匹配
 *
 * C级（信息不足，需要深度挖掘）:
 *   - 有网站但没邮箱
 *   - 或者只有 IG 没有其他联系方式
 *
 * D级（暂时无法开发）:
 *   - 没有任何有效联系方式
 *   - 或者AI判定非服装行业
 */
function categorize(l: any): 'A' | 'B' | 'C' | 'D' {
  const ai = l.ai_analysis || {};
  const email = l.contact_email || '';
  const emailLocal = email.split('@')[0]?.toLowerCase() || '';
  const isPersonalEmail = email && !['info', 'sales', 'hello', 'contact', 'support', 'help', 'customerservice', 'noreply', 'admin', 'general', 'enquiry', 'inquiry', 'care'].includes(emailLocal);
  const isGenericEmail = email && !isPersonalEmail;
  const hasLinkedInPerson = l.contact_linkedin && l.contact_linkedin.includes('/in/'); // Personal profile, not company
  const hasIG = !!l.instagram_handle;
  const isApparel = ai.is_apparel_company !== false; // true or null (not yet analyzed)
  const hasProduct = !!l.product_match || (ai.product_categories && ai.product_categories.length > 0);
  const hasPhone = !!l.contact_phone;

  // Already in active deal = A regardless
  if (l.deal_probability >= 61 || l.action_count > 2) return 'A';

  // A级: 有决策人联系方式 + 服装行业
  if ((isPersonalEmail || hasLinkedInPerson || hasPhone) && isApparel && hasProduct) return 'A';

  // B级: 有通用邮箱 + 服装行业，或者多个联系渠道
  if (isGenericEmail && isApparel && hasProduct) return 'B';
  if (hasIG && l.website && hasProduct && (email || l.contact_linkedin)) return 'B';

  // C级: 有网站或IG但联系方式不足
  if (l.website && isApparel) return 'C';
  if (hasIG && isApparel) return 'C';

  // D级: 其他
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
  const [searchQuery, setSearchQuery] = useState('');

  const activeLeads = leads.filter((l: any) => l.status !== 'disqualified');

  const hotCount = activeLeads.filter((l: any) => (l.deal_probability || 0) >= 61).length;
  const riskCount = activeLeads.filter((l: any) => l.reactivation_needed).length;
  const coldCount = activeLeads.filter((l: any) => (l.deal_probability || 0) > 0 && (l.deal_probability || 0) <= 20).length;
  const bossCount = activeLeads.filter((l: any) => l.escalation_level >= 1 || (l.deal_probability || 0) >= 70).length;

  const tabs: { id: TabId; label: string; count?: number; show: boolean }[] = [
    { id: 'all', label: '全部客户', count: activeLeads.length, show: true },
    { id: 'ai_discovery', label: 'AI 自动开发', show: true },
    { id: 'phantombuster', label: 'LinkedIn 导入', show: true },
    { id: 'customs', label: '海关数据', show: true },
    { id: 'import', label: '智能导入', show: true },
    { id: 'boss', label: '老板关注', count: bossCount, show: isAdmin },
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

  // Apply search filter
  const filteredLeads = searchQuery
    ? sortedLeads.filter((l: any) => l.company_name.toLowerCase().includes(searchQuery.toLowerCase()))
    : sortedLeads;

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
            {tab.count !== undefined && (
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab.id ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'
              }`}>{tab.count}</span>
            )}
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
            {/* Search box */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="搜索公司名称..."
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Category summary */}
            <div className="flex gap-3 mb-3 text-xs flex-wrap">
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

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">级别</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">公司名称</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">联系人</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">邮箱</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">电话</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">主营品类</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">来源</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">推荐动作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLeads.map((lead: any) => {
                    const cat = CATEGORY_CONFIG[lead.category] || CATEGORY_CONFIG.D;
                    const prob = lead.deal_probability || 0;
                    const pc = PROB_COLORS[lead.probability_stage || 'cold'] || PROB_COLORS.cold;
                    const days = lead.last_action_at ? Math.floor((Date.now() - new Date(lead.last_action_at).getTime()) / 86400000) : null;

                    return (
                      <tr key={lead.id} className="hover:bg-indigo-50 cursor-pointer" onClick={() => window.location.href = `/growth/leads/${lead.id}`}>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cat.bgColor} ${cat.color}`}>{cat.label}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-sm font-medium text-gray-900">{lead.company_name}</div>
                          <div className="text-xs text-gray-400">{lead.ai_analysis?.company_type || ''} {lead.ai_analysis?.scale_estimate || ''}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">{lead.contact_name || <span className="text-gray-300">待查</span>}</td>
                        <td className="px-3 py-2 text-xs">
                          {lead.contact_email ? (
                            <span className={(() => { const l = (lead.contact_email||'').split('@')[0]?.toLowerCase(); return ['info','sales','hello','contact','support','help','customerservice','care'].includes(l) ? 'text-amber-600' : 'text-blue-600'; })()}>
                              {lead.contact_email}
                            </span>
                          ) : <span className="text-gray-300">待查</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">{lead.contact_phone || <span className="text-gray-300">待查</span>}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{lead.ai_analysis?.product_categories?.slice(0,2).join(', ') || lead.product_match?.slice(0,20) || '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{SOURCE_LABELS[lead.source] || lead.source}</td>
                        <td className="px-3 py-2">
                          {lead.next_recommended_action && (
                            <span className="text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{lead.next_recommended_action}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredLeads.length === 0 && (
              <p className="text-sm text-gray-400 py-8 text-center">没有匹配的客户</p>
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
          {/* Contact badges */}
          {lead.contact_email && <span className="text-xs bg-blue-50 text-blue-600 px-1 py-0.5 rounded">邮箱</span>}
          {lead.contact_linkedin && <span className="text-xs bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded">LI</span>}
          {lead.instagram_handle && <span className="text-xs bg-pink-50 text-pink-600 px-1 py-0.5 rounded">IG</span>}
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

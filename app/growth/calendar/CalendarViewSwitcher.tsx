'use client';

import { useState } from 'react';
import MonthlyTaskView from './MonthlyTaskView';
import CustomerTimelineView from './CustomerTimelineView';
import SeasonGridView from './SeasonGridView';

type TabId = 'monthly' | 'customer' | 'season';

const TABS: { id: TabId; label: string; sublabel: string }[] = [
  { id: 'monthly', label: '这月做什么', sublabel: '待办事项' },
  { id: 'customer', label: '按客户', sublabel: '客户时间线' },
  { id: 'season', label: '按季节', sublabel: '季节网格' },
];

interface Props {
  tasks: any[];
  customers: any[];
  configs: any[];
  deals: any[];
  staffMap: Record<string, string>;
  today: string;
}

export default function CalendarViewSwitcher({ tasks, customers, configs, deals, staffMap, today }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('monthly');

  return (
    <div className="bg-white rounded-lg border border-gray-200">
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

      <div className="p-5">
        {activeTab === 'monthly' && (
          <MonthlyTaskView tasks={tasks} customers={customers} deals={deals} staffMap={staffMap} today={today} />
        )}
        {activeTab === 'customer' && (
          <CustomerTimelineView tasks={tasks} customers={customers} configs={configs} today={today} />
        )}
        {activeTab === 'season' && (
          <SeasonGridView tasks={tasks} customers={customers} today={today} />
        )}
      </div>
    </div>
  );
}

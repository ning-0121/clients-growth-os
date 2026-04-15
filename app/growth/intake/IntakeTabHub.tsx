'use client';

import { useState } from 'react';
import CsvUploadPanel from './CsvUploadPanel';
import WebsiteIntakePanel from './WebsiteIntakePanel';
import ManualIntakeForm from './ManualIntakeForm';
import ApiInfoPanel from './ApiInfoPanel';
import CustomsUploadPanel from './CustomsUploadPanel';

type TabId = 'csv' | 'website' | 'manual' | 'customs' | 'api';

const TABS: { id: TabId; label: string; sublabel: string }[] = [
  { id: 'csv', label: 'CSV 上传', sublabel: 'PhantomBuster / 工具导出' },
  { id: 'website', label: '网站批量', sublabel: 'URL 自动富集' },
  { id: 'customs', label: '海关数据', sublabel: '贸易记录导入' },
  { id: 'manual', label: '手动录入', sublabel: '单个线索' },
  { id: 'api', label: 'API', sublabel: '接口文档' },
];

export default function IntakeTabHub() {
  const [activeTab, setActiveTab] = useState<TabId>('csv');

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-6">
      {/* Tab bar */}
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

      {/* Panel content */}
      <div className="p-5">
        {activeTab === 'csv' && <CsvUploadPanel />}
        {activeTab === 'website' && <WebsiteIntakePanel />}
        {activeTab === 'customs' && <CustomsUploadPanel />}
        {activeTab === 'manual' && <ManualIntakeForm />}
        {activeTab === 'api' && <ApiInfoPanel />}
      </div>
    </div>
  );
}

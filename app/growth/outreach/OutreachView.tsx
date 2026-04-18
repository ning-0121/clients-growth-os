'use client';

import { useState } from 'react';
import OutreachDashboard from './OutreachDashboard';
import ApprovalsQueue from './ApprovalsQueue';

type ViewId = 'approvals' | 'campaigns';

export default function OutreachView({
  campaigns,
  approvals,
  isAdmin,
}: {
  campaigns: any[];
  approvals: any[];
  isAdmin: boolean;
}) {
  const pendingCount = approvals.filter((a: any) => a.status === 'pending').length;
  const [view, setView] = useState<ViewId>(pendingCount > 0 ? 'approvals' : 'campaigns');

  return (
    <div className="space-y-4">
      {/* Top view switcher */}
      <div className="flex gap-2 bg-white rounded-lg border border-gray-200 p-1">
        <button
          onClick={() => setView('approvals')}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            view === 'approvals'
              ? 'bg-indigo-600 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📋 审批队列
          {pendingCount > 0 && (
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${
              view === 'approvals' ? 'bg-white text-indigo-600' : 'bg-amber-100 text-amber-700'
            }`}>
              {pendingCount} 待处理
            </span>
          )}
        </button>
        <button
          onClick={() => setView('campaigns')}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            view === 'campaigns'
              ? 'bg-indigo-600 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📧 邮件序列 <span className="opacity-70 ml-1">({campaigns.length})</span>
        </button>
      </div>

      {view === 'approvals' && <ApprovalsQueue approvals={approvals} isAdmin={isAdmin} />}
      {view === 'campaigns' && <OutreachDashboard campaigns={campaigns} />}
    </div>
  );
}

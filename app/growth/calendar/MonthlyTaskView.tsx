'use client';

import { useState } from 'react';
import { completeSeasonalTask, linkDealToTask } from '@/app/actions/seasonal-calendar';
import { TASK_TYPE_CONFIG, SEASON_COLORS } from '@/lib/growth/seasonal-calendar';
import { SeasonCode, SeasonalTaskType } from '@/lib/types';

interface Props {
  tasks: any[];
  customers: any[];
  deals: any[];
  staffMap: Record<string, string>;
  today: string;
}

export default function MonthlyTaskView({ tasks, customers, deals, staffMap, today }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const customerMap = new Map(customers.map((c: any) => [c.id, c]));

  // Split into overdue and upcoming
  const endOfMonth = (() => {
    const d = new Date(today);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
  })();

  const overdue = tasks.filter((t: any) => t.due_date < today);
  const thisMonth = tasks.filter((t: any) => t.due_date >= today && t.due_date <= endOfMonth);
  const nextThreeMonths = tasks.filter((t: any) => {
    const cutoff = new Date(today);
    cutoff.setMonth(cutoff.getMonth() + 3);
    return t.due_date > endOfMonth && t.due_date <= cutoff.toISOString().split('T')[0];
  });

  async function handleComplete(taskId: string) {
    setLoadingId(taskId);
    await completeSeasonalTask(taskId);
    setLoadingId(null);
  }

  async function handleLinkDeal(taskId: string, dealId: string) {
    setLinkingId(null);
    await linkDealToTask(taskId, dealId);
  }

  function renderTaskRow(task: any) {
    const customer = customerMap.get(task.customer_id);
    const isOverdue = task.due_date < today;
    const taskConfig = TASK_TYPE_CONFIG[task.task_type as SeasonalTaskType];
    const seasonColor = SEASON_COLORS[task.season as SeasonCode];

    // Find deals matching this customer
    const customerDeals = deals.filter((d: any) =>
      d.customer_name === customer?.customer_name
    );

    return (
      <div
        key={task.id}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
          isOverdue ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'
        }`}
      >
        {/* Task type badge */}
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${taskConfig.bgColor} ${taskConfig.color}`}>
          {taskConfig.labelCn}
        </span>

        {/* Season badge */}
        <span className={`px-2 py-0.5 rounded-full text-xs ${seasonColor.bgColor} ${seasonColor.color}`}>
          {task.season} {task.target_year}
        </span>

        {/* Customer name */}
        <span className="text-sm font-medium text-gray-900 flex-1">
          {customer?.customer_name || '未知客户'}
        </span>

        {/* Due date */}
        <span className={`text-xs ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
          {isOverdue ? '逾期 ' : ''}{task.due_date}
        </span>

        {/* Deal link */}
        {task.deal_id ? (
          <span className="text-xs text-green-600">已关联</span>
        ) : customerDeals.length > 0 ? (
          <div className="relative">
            <button
              onClick={() => setLinkingId(linkingId === task.id ? null : task.id)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              关联Deal
            </button>
            {linkingId === task.id && (
              <div className="absolute right-0 top-6 z-10 bg-white border rounded-lg shadow-lg py-1 min-w-[160px]">
                {customerDeals.map((d: any) => (
                  <button
                    key={d.id}
                    onClick={() => handleLinkDeal(task.id, d.id)}
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    {d.deal_stage} — ${d.estimated_order_value?.toLocaleString() || 'N/A'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Complete button */}
        <button
          onClick={() => handleComplete(task.id)}
          disabled={loadingId === task.id}
          className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-green-100 text-gray-600 hover:text-green-700 transition-colors disabled:opacity-50"
        >
          {loadingId === task.id ? '...' : '完成'}
        </button>
      </div>
    );
  }

  function renderSection(title: string, items: any[], emptyMsg: string) {
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          {title}
          {items.length > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-400">{items.length} 项</span>
          )}
        </h3>
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 py-3">{emptyMsg}</p>
        ) : (
          <div className="space-y-2">
            {items.map(renderTaskRow)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {renderSection('逾期任务', overdue, '没有逾期任务')}
      {renderSection('本月到期', thisMonth, '本月没有到期任务')}
      {renderSection('未来 3 个月', nextThreeMonths, '未来 3 个月没有任务')}
    </div>
  );
}

'use client';

import { TASK_TYPE_CONFIG, SEASON_COLORS, MARKET_LABELS } from '@/lib/growth/seasonal-calendar';
import { SeasonCode, SeasonalTaskType, Market } from '@/lib/types';

interface Props {
  tasks: any[];
  customers: any[];
  configs: any[];
  today: string;
}

export default function CustomerTimelineView({ tasks, customers, configs, today }: Props) {
  if (customers.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">还没有客户档案。点击右上角"添加客户"开始。</p>;
  }

  // Group tasks by customer
  const tasksByCustomer = new Map<string, any[]>();
  for (const task of tasks) {
    if (!tasksByCustomer.has(task.customer_id)) {
      tasksByCustomer.set(task.customer_id, []);
    }
    tasksByCustomer.get(task.customer_id)!.push(task);
  }

  // Group configs by customer
  const configsByCustomer = new Map<string, any[]>();
  for (const config of configs) {
    if (!configsByCustomer.has(config.customer_id)) {
      configsByCustomer.set(config.customer_id, []);
    }
    configsByCustomer.get(config.customer_id)!.push(config);
  }

  return (
    <div className="space-y-4">
      {customers.map((customer: any) => {
        const customerTasks = tasksByCustomer.get(customer.id) || [];
        const customerConfigs = configsByCustomer.get(customer.id) || [];
        const marketLabel = MARKET_LABELS[customer.market as Market];
        const activeSeasons = customerConfigs.map((c: any) => c.season as SeasonCode);

        return (
          <div key={customer.id} className="border rounded-lg bg-white">
            {/* Customer header */}
            <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg flex items-center gap-3">
              <h3 className="text-sm font-semibold text-gray-900">{customer.customer_name}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                {marketLabel?.labelCn || customer.market}
              </span>
              <span className="text-xs text-gray-400">{customer.customer_type}</span>
              {customer.product_preferences && (
                <span className="text-xs text-gray-400 ml-auto">{customer.product_preferences}</span>
              )}
            </div>

            {/* Season badges + tasks */}
            <div className="px-4 py-3">
              {/* Active seasons */}
              <div className="flex gap-2 mb-3">
                {(['SS1', 'SS2', 'FW1', 'FW2'] as SeasonCode[]).map((season) => {
                  const isActive = activeSeasons.includes(season);
                  const sc = SEASON_COLORS[season];
                  return (
                    <span
                      key={season}
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        isActive ? `${sc.bgColor} ${sc.color} font-medium` : 'bg-gray-100 text-gray-300'
                      }`}
                    >
                      {season}
                    </span>
                  );
                })}
              </div>

              {/* Task timeline */}
              {customerTasks.length === 0 ? (
                <p className="text-xs text-gray-400">暂无待办任务。请先生成年度任务。</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {customerTasks
                    .sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))
                    .slice(0, 6) // show next 6 tasks
                    .map((task: any) => {
                      const tc = TASK_TYPE_CONFIG[task.task_type as SeasonalTaskType];
                      const sc = SEASON_COLORS[task.season as SeasonCode];
                      const isOverdue = task.due_date < today;

                      return (
                        <div
                          key={task.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                            isOverdue ? 'bg-red-50 border border-red-200' : 'bg-gray-50'
                          }`}
                        >
                          <span className={`${tc.color} font-medium`}>{tc.labelCn}</span>
                          <span className={`px-1.5 py-0.5 rounded ${sc.bgColor} ${sc.color}`}>
                            {task.season}
                          </span>
                          <span className={`ml-auto ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                            {task.due_date}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

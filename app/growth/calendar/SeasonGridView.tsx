'use client';

import { SEASON_COLORS, TASK_TYPE_CONFIG, MARKET_SEASONS } from '@/lib/growth/seasonal-calendar';
import { SeasonCode, SeasonalTaskType, Market } from '@/lib/types';

interface Props {
  tasks: any[];
  customers: any[];
  today: string;
}

const SEASONS: SeasonCode[] = ['SS1', 'SS2', 'FW1', 'FW2'];

export default function SeasonGridView({ tasks, customers, today }: Props) {
  const customerMap = new Map(customers.map((c: any) => [c.id, c]));

  // Group tasks by season
  const tasksBySeason = new Map<string, any[]>();
  for (const season of SEASONS) {
    tasksBySeason.set(season, []);
  }
  for (const task of tasks) {
    const list = tasksBySeason.get(task.season);
    if (list) list.push(task);
  }

  // Determine current target year
  const currentYear = new Date(today).getFullYear();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {SEASONS.map((season) => {
        const sc = SEASON_COLORS[season];
        const seasonTasks = tasksBySeason.get(season) || [];
        const usConfig = MARKET_SEASONS.us[season];

        // Group by customer within this season
        const byCustomer = new Map<string, any[]>();
        for (const task of seasonTasks) {
          if (!byCustomer.has(task.customer_id)) {
            byCustomer.set(task.customer_id, []);
          }
          byCustomer.get(task.customer_id)!.push(task);
        }

        return (
          <div key={season} className="border rounded-lg bg-white">
            {/* Season header */}
            <div className={`px-3 py-2 rounded-t-lg ${sc.bgColor}`}>
              <div className={`text-sm font-semibold ${sc.color}`}>
                {season} — {usConfig.labelCn}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                上架: {usConfig.shelfMonthStart}-{usConfig.shelfMonthEnd}月 (美国)
              </div>
            </div>

            {/* Customers in this season */}
            <div className="px-3 py-2 space-y-2">
              {byCustomer.size === 0 ? (
                <p className="text-xs text-gray-400 py-2">暂无客户</p>
              ) : (
                [...byCustomer.entries()].map(([customerId, customerTasks]) => {
                  const customer = customerMap.get(customerId);
                  // Find the next incomplete task
                  const nextTask = customerTasks
                    .sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))
                    .find((t: any) => !t.completed_at);

                  const isOverdue = nextTask && nextTask.due_date < today;

                  return (
                    <div
                      key={customerId}
                      className={`px-2 py-1.5 rounded text-xs ${
                        isOverdue ? 'bg-red-50 border border-red-200' : 'bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900">
                          {customer?.customer_name || '未知'}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          customer?.market === 'us' ? 'bg-blue-100 text-blue-600' :
                          customer?.market === 'eu' ? 'bg-green-100 text-green-600' :
                          customer?.market === 'jp' ? 'bg-pink-100 text-pink-600' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {customer?.market?.toUpperCase()}
                        </span>
                      </div>
                      {nextTask && (
                        <div className={`mt-1 ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                          {TASK_TYPE_CONFIG[nextTask.task_type as SeasonalTaskType].labelCn}
                          {' → '}
                          {nextTask.due_date}
                          {isOverdue && ' (逾期!)'}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import GrowthNavbar from '@/components/GrowthNavbar';
import CalendarViewSwitcher from './CalendarViewSwitcher';
import CustomerProfileForm from './CustomerProfileForm';

export default async function CalendarPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const now = new Date();

  // Fetch all incomplete tasks, ordered by due date
  const { data: tasks } = await supabase
    .from('seasonal_tasks')
    .select('*')
    .is('completed_at', null)
    .order('due_date', { ascending: true });

  // Fetch all customer profiles
  const { data: customers } = await supabase
    .from('customer_profiles')
    .select('*')
    .order('customer_name');

  // Fetch seasonal configs for all customers
  const { data: configs } = await supabase
    .from('customer_seasonal_configs')
    .select('*')
    .eq('is_active', true);

  // Fetch active deals (for linking)
  const { data: deals } = await supabase
    .from('growth_deals')
    .select('id, customer_name, deal_stage, status, estimated_order_value')
    .eq('status', 'active');

  // Fetch staff names
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, name');

  const staffMap: Record<string, string> = {};
  (profiles || []).forEach((p: any) => { staffMap[p.user_id] = p.name; });

  const allTasks = tasks || [];
  const allCustomers = customers || [];
  const allConfigs = configs || [];
  const allDeals = deals || [];

  // Compute metrics
  const today = now.toISOString().split('T')[0];
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const overdueTasks = allTasks.filter((t: any) => t.due_date < today);
  const thisMonthTasks = allTasks.filter((t: any) => t.due_date >= today && t.due_date <= endOfMonth);
  const upcomingMeetings = allTasks.filter((t: any) =>
    (t.task_type === 'meeting' || t.task_type === 'book_meeting') && t.due_date >= today
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Buying Calendar</h1>
            <p className="text-sm text-gray-500 mt-1">客户采购季节日历 — 提前规划产品准备、会议预约和下单节点</p>
          </div>
          <CustomerProfileForm customers={allCustomers} configs={allConfigs} />
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MetricCard
            label="逾期任务"
            value={overdueTasks.length}
            color={overdueTasks.length > 0 ? 'text-red-600' : 'text-gray-600'}
            border={overdueTasks.length > 0 ? 'border-red-200' : 'border-gray-200'}
          />
          <MetricCard
            label="本月到期"
            value={thisMonthTasks.length}
            color={thisMonthTasks.length > 0 ? 'text-amber-600' : 'text-gray-600'}
            border="border-amber-200"
          />
          <MetricCard
            label="活跃客户"
            value={allCustomers.length}
            color="text-indigo-600"
            border="border-indigo-200"
          />
          <MetricCard
            label="待预约会议"
            value={upcomingMeetings.length}
            color="text-blue-600"
            border="border-blue-200"
          />
        </div>

        {/* Calendar views */}
        <CalendarViewSwitcher
          tasks={allTasks}
          customers={allCustomers}
          configs={allConfigs}
          deals={allDeals}
          staffMap={staffMap}
          today={today}
        />
      </main>
    </div>
  );
}

function MetricCard({ label, value, color, border }: {
  label: string; value: number; color: string; border: string;
}) {
  return (
    <div className={`bg-white rounded-lg p-4 border ${border}`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

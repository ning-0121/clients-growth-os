'use client';

import { useState } from 'react';

interface Metric {
  hour_bucket: string;
  new_leads_count: number;
  new_urls_queued: number;
  emails_sent: number;
  emails_opened: number;
  ai_jobs_total: number;
  ai_jobs_success: number;
  ai_jobs_error: number;
  avg_duration_ms: number;
  total_tokens_used: number;
  approvals_pending: number;
  stalled_jobs: number;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  related_job: string | null;
  detected_at: string;
  auto_actions_taken: string[] | null;
}

interface Job {
  id: string;
  job_type: string;
  job_name: string;
  status: string;
  input_count: number;
  output_count: number;
  error_count: number;
  duration_ms: number;
  started_at: string;
  error_message: string | null;
}

const SEVERITY_CFG: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  critical: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', icon: '🚨' },
  warning:  { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', icon: '⚠️' },
  info:     { color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-300', icon: 'ℹ️' },
};

const STATUS_CFG: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  timeout: 'bg-orange-100 text-orange-700',
  partial: 'bg-yellow-100 text-yellow-700',
};

export default function SupervisorDashboard({ metrics, alerts, recentJobs, totals, currentPending, currentStalled }: {
  metrics: Metric[];
  alerts: Alert[];
  recentJobs: Job[];
  totals: any;
  currentPending: number;
  currentStalled: number;
}) {
  const [tab, setTab] = useState<'overview' | 'jobs' | 'alerts'>('overview');

  // Calculate cost estimate: rough $0.003 per 1k tokens
  const estimatedCost = (totals.tokens_used || 0) * 0.003 / 1000;

  const successRate = totals.ai_jobs_total > 0
    ? Math.round(((totals.ai_jobs_total - totals.ai_jobs_error) / totals.ai_jobs_total) * 100)
    : 100;

  // Build 24h sparkline data
  const maxLeads = Math.max(1, ...metrics.map(m => m.new_leads_count || 0));

  return (
    <div className="space-y-6">
      {/* Top alert banner */}
      {alerts.filter(a => a.severity === 'critical').length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
          <p className="text-sm font-semibold text-red-800">
            🚨 {alerts.filter(a => a.severity === 'critical').length} 个关键问题需要处理
          </p>
          <button onClick={() => setTab('alerts')} className="text-xs text-red-600 underline mt-1">
            查看详情 →
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-white rounded-lg border border-gray-200 p-1">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} label="📊 总览" />
        <TabButton active={tab === 'alerts'} onClick={() => setTab('alerts')} label={`🔔 告警 (${alerts.length})`} />
        <TabButton active={tab === 'jobs'} onClick={() => setTab('jobs')} label={`⚙️ 最近任务 (${recentJobs.length})`} />
      </div>

      {tab === 'overview' && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="24h 新客户" value={totals.new_leads || 0}
              note={totals.new_leads < 20 ? '⚠️ 偏低' : totals.new_leads >= 50 ? '✅ 达标' : '正常'}
              color={totals.new_leads < 20 ? 'text-amber-600' : 'text-green-600'} />
            <KpiCard label="24h 新URL" value={totals.new_urls || 0} color="text-indigo-600" />
            <KpiCard label="24h 邮件发送" value={totals.emails_sent || 0} color="text-blue-600" />
            <KpiCard label="24h 邮件打开" value={totals.emails_opened || 0} color="text-purple-600" />
            <KpiCard label="AI 任务总数" value={totals.ai_jobs_total || 0} color="text-gray-700" />
            <KpiCard label="AI 成功率" value={`${successRate}%`}
              color={successRate >= 90 ? 'text-green-600' : successRate >= 70 ? 'text-amber-600' : 'text-red-600'} />
            <KpiCard label="24h API 成本估算" value={`$${estimatedCost.toFixed(2)}`} color="text-gray-600"
              note={`${(totals.tokens_used || 0).toLocaleString()} tokens`} />
            <KpiCard label="待审批 / 卡住"
              value={`${currentPending} / ${currentStalled}`}
              color={currentStalled > 0 ? 'text-red-600' : currentPending > 5 ? 'text-amber-600' : 'text-green-600'} />
          </div>

          {/* 24h throughput chart */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">24 小时产出（每小时新客户数）</h3>
            {metrics.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">暂无数据 — 监工cron还没跑（每小时整点执行）</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {metrics.map((m, i) => {
                  const pct = ((m.new_leads_count || 0) / maxLeads) * 100;
                  const hour = new Date(m.hour_bucket).getHours();
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${hour}:00 — ${m.new_leads_count} 新客户, ${m.ai_jobs_error} 错误`}>
                      <div className="text-xs text-gray-400">{m.new_leads_count || ''}</div>
                      <div className="w-full bg-indigo-100 rounded-t" style={{ height: `${Math.max(pct, 2)}%` }}>
                        <div className={`w-full rounded-t ${(m.ai_jobs_error || 0) > 0 ? 'bg-red-400' : 'bg-indigo-500'}`}
                             style={{ height: '100%' }} />
                      </div>
                      <div className="text-xs text-gray-400">{hour}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Health status */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">健康状况</h3>
            <div className="space-y-2">
              <HealthRow label="Discovery 引擎" status={totals.new_urls > 50 ? 'healthy' : totals.new_urls > 0 ? 'warning' : 'critical'}
                note={`24h 抓取 ${totals.new_urls} 个 URL`} />
              <HealthRow label="邮件发送" status={totals.emails_sent > 0 ? 'healthy' : 'warning'}
                note={`24h 发送 ${totals.emails_sent} 封`} />
              <HealthRow label="AI 分析" status={successRate >= 90 ? 'healthy' : successRate >= 70 ? 'warning' : 'critical'}
                note={`成功率 ${successRate}%`} />
              <HealthRow label="审批队列" status={currentPending <= 5 ? 'healthy' : currentPending <= 10 ? 'warning' : 'critical'}
                note={`${currentPending} 封待审批`} />
              <HealthRow label="任务卡壳" status={currentStalled === 0 ? 'healthy' : 'critical'}
                note={currentStalled === 0 ? '无卡住任务' : `${currentStalled} 个任务超时（已自动重置）`} />
            </div>
          </div>
        </>
      )}

      {tab === 'alerts' && (
        <div className="bg-white rounded-lg border border-gray-200">
          {alerts.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-sm text-gray-500">一切正常，没有告警</p>
            </div>
          ) : (
            <div className="divide-y">
              {alerts.map((a) => {
                const cfg = SEVERITY_CFG[a.severity] || SEVERITY_CFG.info;
                return (
                  <div key={a.id} className={`p-4 ${cfg.bg} border-l-4 ${cfg.border}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{cfg.icon}</span>
                      <div className="flex-1">
                        <h4 className={`font-semibold ${cfg.color}`}>{a.title}</h4>
                        <p className="text-sm text-gray-700 mt-1">{a.description}</p>
                        {a.auto_actions_taken && a.auto_actions_taken.length > 0 && (
                          <p className="text-xs text-gray-500 mt-1">
                            🤖 自动处理: {a.auto_actions_taken.join('; ')}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-2">
                          {new Date(a.detected_at).toLocaleString('zh-CN')}
                          {a.related_job && ` · 相关: ${a.related_job}`}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'jobs' && (
        <div className="bg-white rounded-lg border border-gray-200">
          {recentJobs.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-gray-400">过去1小时没有 AI 任务记录</p>
              <p className="text-xs text-gray-400 mt-1">需要先运行数据库迁移 supabase/migration-supervisor.sql</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">状态</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">类型</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">任务</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">产出</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">耗时</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">错误</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recentJobs.map((j) => (
                    <tr key={j.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_CFG[j.status] || 'bg-gray-100 text-gray-600'}`}>
                          {j.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{j.job_type}</td>
                      <td className="px-3 py-2 text-gray-900 font-medium">{j.job_name}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{j.output_count}</td>
                      <td className="px-3 py-2 text-right text-gray-500">
                        {j.duration_ms ? `${(j.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="px-3 py-2 text-red-600 max-w-[200px] truncate" title={j.error_message || ''}>
                        {j.error_message ? j.error_message.slice(0, 40) : ''}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-400">
                        {new Date(j.started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  );
}

function KpiCard({ label, value, color, note }: { label: string; value: number | string; color: string; note?: string }) {
  return (
    <div className="bg-white rounded-lg p-3 border border-gray-200">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {note && <div className="text-xs text-gray-400 mt-0.5">{note}</div>}
    </div>
  );
}

function HealthRow({ label, status, note }: { label: string; status: 'healthy' | 'warning' | 'critical'; note: string }) {
  const dot = status === 'healthy' ? 'bg-green-500' : status === 'warning' ? 'bg-amber-500' : 'bg-red-500';
  const statusLabel = status === 'healthy' ? '正常' : status === 'warning' ? '偏低' : '需关注';
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dot}`}></span>
        <span className="text-sm text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">{note}</span>
        <span className={`text-xs font-medium ${
          status === 'healthy' ? 'text-green-600' : status === 'warning' ? 'text-amber-600' : 'text-red-600'
        }`}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

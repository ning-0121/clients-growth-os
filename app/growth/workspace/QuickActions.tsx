'use client';

import { useState } from 'react';

/**
 * Admin-only quick actions panel to improve system usage rate.
 *
 * Actions:
 * 1. Activate untouched leads (reset verification_status so verify cron picks them up)
 * 2. Bulk find personal emails for leads blocked by generic email
 * 3. Trigger discovery cron manually (instead of waiting for scheduled time)
 * 4. Trigger supervisor snapshot manually
 */

interface Stats {
  untouched_count: number;
  blocked_generic_count: number;
  queue_pending: number;
  pending_approvals: number;
  c_grade_count?: number;
}

export default function QuickActions({ stats }: { stats: Stats }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function activateUntouched(count: number) {
    if (!confirm(`确认激活 ${count} 条闲置线索？它们会在15分钟内进入验证队列。`)) return;
    setBusy('activate');
    setResult(null);
    try {
      const res = await fetch('/api/leads/bulk-activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false, max_leads: count, target: 'untouched' }),
      });
      const data = await res.json();
      if (data.error) setResult(`❌ ${data.error}`);
      else setResult(`✅ ${data.message}`);
    } catch (e: any) {
      setResult(`❌ ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function triageCGrade(action: 'nurture' | 'archive') {
    const label = action === 'nurture' ? '转入培育池（每季度检查）' : '批量归档（标记为 disqualified）';
    if (!confirm(`确认把 C 级低质量线索 ${label}？最多处理 50 条。`)) return;
    setBusy('triage');
    setResult(null);
    try {
      const res = await fetch('/api/leads/bulk-triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, grade: 'C', max: 50 }),
      });
      const data = await res.json();
      if (data.error) setResult(`❌ ${data.error}`);
      else setResult(`✅ ${data.message}`);
    } catch (e: any) {
      setResult(`❌ ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function triggerReEnrich() {
    if (!confirm(`触发深度联系人查找？将扫描3个有网站但没邮箱的线索，查找个人联系方式。`)) return;
    setBusy('reenrich');
    setResult(null);
    try {
      const res = await fetch('/api/leads/re-enrich', { method: 'POST' });
      const data = await res.json();
      if (data.error) setResult(`❌ ${data.error}`);
      else setResult(`✅ 已处理 ${data.processed || 0}，补齐 ${data.enriched || 0} 条`);
    } catch (e: any) {
      setResult(`❌ ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  if (stats.untouched_count === 0 && stats.blocked_generic_count === 0 && stats.pending_approvals === 0 && !stats.c_grade_count) {
    return null; // nothing to show
  }

  return (
    <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-indigo-900">🎛️ 管理员快速操作</h2>
        <span className="text-xs text-indigo-600">一键提升系统使用率</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Activate untouched */}
        {stats.untouched_count > 0 && (
          <button
            onClick={() => activateUntouched(Math.min(50, stats.untouched_count))}
            disabled={busy !== null}
            className="text-left p-3 bg-white border border-indigo-200 rounded hover:border-indigo-400 hover:shadow-sm transition-all disabled:opacity-50"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-gray-500">闲置线索</div>
                <div className="text-lg font-bold text-indigo-700 mt-0.5">{stats.untouched_count}</div>
              </div>
              <span className="text-xl">🎯</span>
            </div>
            <div className="text-xs text-indigo-600 mt-2">
              {busy === 'activate' ? '激活中...' : `→ 激活 ${Math.min(50, stats.untouched_count)} 条进队列`}
            </div>
          </button>
        )}

        {/* Find personal emails */}
        {stats.blocked_generic_count > 0 && (
          <button
            onClick={triggerReEnrich}
            disabled={busy !== null}
            className="text-left p-3 bg-white border border-amber-200 rounded hover:border-amber-400 hover:shadow-sm transition-all disabled:opacity-50"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-gray-500">泛型邮箱被拦</div>
                <div className="text-lg font-bold text-amber-700 mt-0.5">{stats.blocked_generic_count}</div>
              </div>
              <span className="text-xl">🔍</span>
            </div>
            <div className="text-xs text-amber-600 mt-2">
              {busy === 'reenrich' ? '查找中...' : '→ AI 深度查找个人邮箱'}
            </div>
          </button>
        )}

        {/* Pending approvals */}
        {stats.pending_approvals > 0 && (
          <a
            href="/growth/outreach"
            className="text-left p-3 bg-white border border-purple-200 rounded hover:border-purple-400 hover:shadow-sm transition-all block"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-gray-500">待审批邮件</div>
                <div className="text-lg font-bold text-purple-700 mt-0.5">{stats.pending_approvals}</div>
              </div>
              <span className="text-xl">📋</span>
            </div>
            <div className="text-xs text-purple-600 mt-2">→ 去审批队列</div>
          </a>
        )}

        {/* C-grade cleanup */}
        {(stats.c_grade_count || 0) > 0 && (
          <div className="text-left p-3 bg-white border border-gray-200 rounded hover:shadow-sm transition-all">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-gray-500">C级低质量</div>
                <div className="text-lg font-bold text-gray-700 mt-0.5">{stats.c_grade_count}</div>
              </div>
              <span className="text-xl">🧹</span>
            </div>
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => triageCGrade('nurture')}
                disabled={busy !== null}
                className="flex-1 text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-50"
              >
                {busy === 'triage' ? '...' : '→ 培育池'}
              </button>
              <button
                onClick={() => triageCGrade('archive')}
                disabled={busy !== null}
                className="flex-1 text-xs px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100 disabled:opacity-50"
              >
                {busy === 'triage' ? '...' : '归档'}
              </button>
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className={`mt-3 p-2 rounded text-xs ${result.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {result}
        </div>
      )}
    </div>
  );
}

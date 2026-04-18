'use client';

import { useEffect, useState } from 'react';

interface Check {
  key: string;
  required: boolean;
  configured: boolean;
  capability: string;
  impact: string;
  setup_url?: string;
}

interface EnvHealthResponse {
  tier: string;
  tier_label: string;
  summary: { total: number; configured: number; critical_missing: number; optional_missing: number };
  critical_missing: Check[];
  optional_missing: Check[];
  checks: Check[];
}

export default function EnvHealth() {
  const [data, setData] = useState<EnvHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/env-health')
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500">加载环境配置...</div>;
  if (!data || !data.checks) return <div className="bg-white rounded-lg border border-red-200 p-4 text-sm text-red-700">无法加载环境配置</div>;

  const pctConfigured = Math.round(data.summary.configured / data.summary.total * 100);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">环境配置健康度</h3>
        <span className="text-sm font-medium">{data.tier_label}</span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>已配置</span>
          <span>{data.summary.configured} / {data.summary.total} ({pctConfigured}%)</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className={`h-2 rounded-full ${pctConfigured >= 80 ? 'bg-green-500' : pctConfigured >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${pctConfigured}%` }}
          />
        </div>
      </div>

      {/* Critical missing */}
      {data.critical_missing.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-red-700">🚨 必需但缺失</h4>
          {data.critical_missing.map(c => (
            <div key={c.key} className="bg-red-50 border border-red-200 rounded p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <code className="text-red-700 font-mono">{c.key}</code>
                  <p className="text-red-600 mt-1">{c.capability}</p>
                  <p className="text-red-500 mt-0.5">影响: {c.impact}</p>
                </div>
                {c.setup_url && (
                  <a href={c.setup_url} target="_blank" rel="noreferrer" className="text-red-700 underline whitespace-nowrap">获取 →</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Optional missing */}
      {data.optional_missing.length > 0 && (
        <details className="space-y-2">
          <summary className="text-xs font-semibold text-amber-700 cursor-pointer">
            ⚠️ 可选但建议配置 ({data.optional_missing.length})
          </summary>
          <div className="space-y-2 mt-2">
            {data.optional_missing.map(c => (
              <div key={c.key} className="bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <code className="text-amber-700 font-mono">{c.key}</code>
                    <p className="text-amber-700 mt-1">{c.capability}</p>
                    <p className="text-amber-600 mt-0.5">影响: {c.impact}</p>
                  </div>
                  {c.setup_url && (
                    <a href={c.setup_url} target="_blank" rel="noreferrer" className="text-amber-700 underline whitespace-nowrap">获取 →</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* All checks at a glance */}
      <details>
        <summary className="text-xs font-semibold text-gray-600 cursor-pointer">查看所有检查项</summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
          {data.checks.map(c => (
            <div key={c.key} className="flex items-center gap-2 text-xs py-1">
              <span className={c.configured ? 'text-green-600' : c.required ? 'text-red-600' : 'text-gray-400'}>
                {c.configured ? '✅' : c.required ? '❌' : '⚠️'}
              </span>
              <code className="font-mono text-gray-700">{c.key}</code>
              <span className="text-gray-400 truncate">{c.capability}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

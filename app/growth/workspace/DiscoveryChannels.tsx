'use client';

import { useState } from 'react';

/**
 * Admin panel for manually triggering discovery channels.
 * - Faire (wholesale marketplace)
 * - Amazon (FBA sellers)
 * - Exhibitor list (trade shows)
 * - Instagram SerpAPI dork
 */

interface ChannelResult {
  channel: string;
  total_found?: number;
  urls_queued?: number;
  duplicates?: number;
  sample?: any[];
  shopify_confirmed?: number;
  websites_resolved?: number;
  emails_extracted?: number;
  error?: string;
}

const CHANNELS = [
  {
    key: 'faire',
    name: 'Faire.com',
    description: '美国批发市场小品牌，84个字段',
    endpoint: '/api/discovery/faire',
    icon: '🏪',
    color: 'border-rose-200 hover:border-rose-400 bg-rose-50',
    estimate: '~30 秒 · 50 品牌/次',
    best_for: '低 MOQ 小品牌',
  },
  {
    key: 'shopify',
    name: 'Shopify 独立站',
    description: 'Google 反向找 Shopify 指纹店铺',
    endpoint: '/api/discovery/shopify',
    icon: '🛍️',
    color: 'border-emerald-200 hover:border-emerald-400 bg-emerald-50',
    estimate: '~40 秒 · 20 店/次',
    best_for: 'DTC 独立品牌',
  },
  {
    key: 'amazon',
    name: 'Amazon',
    description: 'FBA 卖家 + 自动解析独立站',
    endpoint: '/api/discovery/amazon',
    icon: '📦',
    color: 'border-orange-200 hover:border-orange-400 bg-orange-50',
    estimate: '~55 秒 · 50 卖家/次',
    best_for: '含 Shopify 反向查找',
  },
  {
    key: 'exhibitor',
    name: '展会参展商',
    description: 'Sourcing at MAGIC 参展商名单',
    endpoint: '/api/discovery/exhibitor',
    icon: '🎪',
    color: 'border-teal-200 hover:border-teal-400 bg-teal-50',
    estimate: '~20 秒 · 百家起',
    best_for: '有预算的小品牌',
  },
  {
    key: 'instagram',
    name: 'Instagram 爬虫',
    description: 'Google dork 找 bio 有邮箱的品牌',
    endpoint: '/api/discovery/instagram-dork',
    icon: '📸',
    color: 'border-fuchsia-200 hover:border-fuchsia-400 bg-fuchsia-50',
    estimate: '~15 秒 · 30 profile/次',
    best_for: 'bio 已暴露邮箱',
  },
] as const;

export default function DiscoveryChannels() {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ChannelResult>>({});

  async function runChannel(channel: typeof CHANNELS[number]) {
    setBusy(channel.key);
    setResults((r) => ({ ...r, [channel.key]: { channel: channel.name } }));

    try {
      const res = await fetch(channel.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setResults((r) => ({
        ...r,
        [channel.key]: {
          channel: channel.name,
          total_found: data.total_found ?? data.profiles_found,
          urls_queued: data.urls_queued,
          duplicates: data.duplicates,
          sample: data.sample,
          // Extra metrics for some channels
          shopify_confirmed: data.shopify_confirmed,
          websites_resolved: data.websites_resolved,
          emails_extracted: data.emails_extracted,
          error: data.error || (!res.ok ? `HTTP ${res.status}` : undefined),
        } as ChannelResult,
      }));
    } catch (e: any) {
      setResults((r) => ({
        ...r,
        [channel.key]: { channel: channel.name, error: e.message },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">🌐 多渠道客户发现（手动触发）</h2>
        <a href="/growth/leads" className="text-xs text-indigo-600 hover:underline">查看瀑布流 →</a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {CHANNELS.map((ch) => {
          const r = results[ch.key];
          const running = busy === ch.key;
          return (
            <div key={ch.key} className={`border-2 rounded-lg p-3 ${ch.color}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{ch.icon}</span>
                    <span className="text-sm font-semibold text-gray-900">{ch.name}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{ch.description}</p>
                </div>
              </div>

              <div className="text-xs text-gray-500 space-y-0.5 mb-3">
                <div>⏱ {ch.estimate}</div>
                <div>🎯 {ch.best_for}</div>
              </div>

              <button
                onClick={() => runChannel(ch)}
                disabled={busy !== null}
                className="w-full text-xs py-1.5 rounded bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50 font-medium"
              >
                {running ? '运行中...' : '▶ 立即抓取'}
              </button>

              {r && (
                <div className="mt-2 text-xs">
                  {r.error ? (
                    <div className="p-1.5 bg-red-100 text-red-700 rounded">❌ {r.error}</div>
                  ) : (
                    <div className="p-1.5 bg-green-100 text-green-700 rounded">
                      ✅ 抓 {r.total_found || 0} · 入库 {r.urls_queued || 0}
                      {(r.duplicates ?? 0) > 0 && ` · 去重 ${r.duplicates}`}
                      {(r.shopify_confirmed ?? 0) > 0 && ` · Shopify ${r.shopify_confirmed}`}
                      {(r.websites_resolved ?? 0) > 0 && ` · 解析 ${r.websites_resolved}`}
                      {(r.emails_extracted ?? 0) > 0 && ` · 邮箱 ${r.emails_extracted}`}
                    </div>
                  )}
                  {r.sample && r.sample.length > 0 && !r.error && (
                    <details className="mt-1">
                      <summary className="text-gray-500 cursor-pointer">示例样本</summary>
                      <ul className="mt-1 pl-3 text-gray-600 space-y-0.5">
                        {r.sample.slice(0, 3).map((s: any, i: number) => (
                          <li key={i} className="truncate">
                            {s.brand || s.company || s.profile || 'unknown'}
                            {s.email && <span className="text-green-600"> · {s.email}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-gray-500">
        💡 抓取后新线索自动进入 <strong>lead_source_queue</strong>，10分钟内 <code>auto-source</code> cron 会处理它们，
        然后 15 分钟内 <code>verify</code> cron 会打分 → 合格后进客户瀑布流。
      </div>
    </div>
  );
}

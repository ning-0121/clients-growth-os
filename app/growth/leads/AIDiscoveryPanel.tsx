'use client';

import { useState } from 'react';

const PRODUCT_KEYWORDS = [
  'activewear', 'sportswear', 'yoga wear', 'compression wear',
  'gym clothing', 'athleisure', 'performance apparel', 'tennis wear',
  'golf wear', 'running apparel', 'cycling jersey', 'outdoor sportswear',
  'swimwear', 'loungewear', 'streetwear',
];

const MARKETS = [
  { value: 'USA', label: '美国' }, { value: 'UK', label: '英国' },
  { value: 'Germany', label: '德国' }, { value: 'France', label: '法国' },
  { value: 'Australia', label: '澳大利亚' }, { value: 'Canada', label: '加拿大' },
  { value: 'Japan', label: '日本' }, { value: 'South Korea', label: '韩国' },
  { value: 'Netherlands', label: '荷兰' }, { value: 'Italy', label: '意大利' },
  { value: 'Spain', label: '西班牙' }, { value: 'Sweden', label: '瑞典' },
];

const CUSTOMER_TYPES = [
  { value: 'brand', label: '品牌商' },
  { value: 'retailer', label: '零售商' },
  { value: 'ecommerce', label: '电商卖家' },
  { value: 'wholesale', label: '批发商' },
  { value: 'dtc', label: 'DTC品牌' },
];

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export default function AIDiscoveryPanel() {
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>(['activewear', 'sportswear']);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(['USA', 'UK']);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['brand', 'dtc']);
  const [customKeyword, setCustomKeyword] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);

  const toggleItem = (list: string[], item: string, setter: (v: string[]) => void) => {
    setter(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);
  };

  const addCustomKeyword = () => {
    if (customKeyword.trim() && !selectedKeywords.includes(customKeyword.trim())) {
      setSelectedKeywords([...selectedKeywords, customKeyword.trim()]);
      setCustomKeyword('');
    }
  };

  async function runDiscovery() {
    setIsRunning(true);
    setResult(null);

    try {
      const res = await fetch('/api/cron/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${window.location.hostname === 'localhost' ? 'dev' : ''}`,
        },
      });
      const data = await res.json();
      setResult(data);

      // Also fetch queue stats
      const statsRes = await fetch('/api/queue/stats');
      if (statsRes.ok) {
        setQueueStats(await statsRes.json());
      }
    } catch {
      setResult({ error: '搜索执行失败' });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-green-800">AI 自动开发引擎运行中</div>
          <div className="text-xs text-green-600">每 2 小时自动搜索 Google + Bing · 每小时处理 20 条 · 24 小时不间断</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs text-green-700">运行中</span>
        </div>
      </div>

      {/* Search configuration */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">搜索条件配置</h3>

        {/* Product keywords */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-700 mb-2 block">产品关键词（选择或自定义）</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRODUCT_KEYWORDS.map(kw => (
              <button
                key={kw}
                onClick={() => toggleItem(selectedKeywords, kw, setSelectedKeywords)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  selectedKeywords.includes(kw)
                    ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {kw}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={customKeyword}
              onChange={e => setCustomKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomKeyword()}
              placeholder="自定义关键词..."
              className="text-xs border rounded px-2 py-1 flex-1"
            />
            <button onClick={addCustomKeyword} className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">添加</button>
          </div>
        </div>

        {/* Target markets */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-700 mb-2 block">目标市场</label>
          <div className="flex flex-wrap gap-1.5">
            {MARKETS.map(m => (
              <button
                key={m.value}
                onClick={() => toggleItem(selectedMarkets, m.value, setSelectedMarkets)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  selectedMarkets.includes(m.value)
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Customer types */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-700 mb-2 block">客户类型</label>
          <div className="flex flex-wrap gap-1.5">
            {CUSTOMER_TYPES.map(ct => (
              <button
                key={ct.value}
                onClick={() => toggleItem(selectedTypes, ct.value, setSelectedTypes)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  selectedTypes.includes(ct.value)
                    ? 'bg-amber-100 border-amber-300 text-amber-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {ct.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={runDiscovery}
            disabled={isRunning || selectedKeywords.length === 0}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {isRunning ? '搜索中...' : '立即搜索'}
          </button>
          <div className="text-xs text-gray-400 flex items-center">
            已选：{selectedKeywords.length} 个关键词 × {selectedMarkets.length} 个市场 = {selectedKeywords.length * selectedMarkets.length} 组合
          </div>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className={`rounded-lg p-3 text-sm ${result.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
          {result.error ? (
            <p>{result.error}</p>
          ) : (
            <div>
              <p className="font-medium">搜索完成：找到 {result.total_found || 0} 个 URL，新增入队 {result.total_new || 0} 个</p>
              {result.sources?.google && (
                <p className="text-xs mt-1">Google: {result.sources.google.urls_found || 0} 找到，{result.sources.google.urls_new || 0} 新增</p>
              )}
              {result.sources?.bing && (
                <p className="text-xs">Bing: {result.sources.bing.urls_found || 0} 找到，{result.sources.bing.urls_new || 0} 新增</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pipeline status */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">自动化管线状态</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatusCard icon="🔍" label="发现" desc="每2小时 Google+Bing" status="运行中" />
          <StatusCard icon="🌐" label="爬取+AI分析" desc="每小时处理20条" status="运行中" />
          <StatusCard icon="✅" label="4轮验证" desc="每15分钟" status="运行中" />
          <StatusCard icon="📧" label="自动发信" desc="每15分钟" status="运行中" />
        </div>
      </div>
    </div>
  );
}

function StatusCard({ icon, label, desc, status }: { icon: string; label: string; desc: string; status: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
      <div className="text-lg mb-1">{icon}</div>
      <div className="text-xs font-medium text-gray-900">{label}</div>
      <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
      <div className="text-xs text-green-600 mt-1 flex items-center justify-center gap-1">
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
        {status}
      </div>
    </div>
  );
}

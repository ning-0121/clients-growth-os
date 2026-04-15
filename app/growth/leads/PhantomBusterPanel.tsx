'use client';

import { useState } from 'react';

export default function PhantomBusterPanel() {
  const [showSetup, setShowSetup] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<any>(null);

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/phantombuster`
    : 'https://order-growth-os.vercel.app/api/webhooks/phantombuster';

  async function pullLatest() {
    setPulling(true);
    setPullResult(null);
    try {
      const res = await fetch('/api/phantombuster/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setPullResult(data);
    } catch {
      setPullResult({ error: '拉取失败' });
    } finally {
      setPulling(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Quick pull */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-indigo-800">PhantomBuster LinkedIn 数据导入</div>
            <div className="text-xs text-indigo-600 mt-1">PB 搜索完成后，点击下方按钮拉取最新数据到系统</div>
          </div>
          <button
            onClick={pullLatest}
            disabled={pulling}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium flex-shrink-0"
          >
            {pulling ? '拉取中...' : '拉取最新数据'}
          </button>
        </div>

        {pullResult && (
          <div className={`mt-3 rounded p-2 text-xs ${pullResult.error ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {pullResult.error ? (
              <p>{pullResult.error}</p>
            ) : (
              <p>PB 返回 {pullResult.pb_results || 0} 条 → 有效 {pullResult.valid_leads || 0} 条 → 合格 {pullResult.qualified || 0} 条，淘汰 {pullResult.disqualified || 0} 条，重复 {pullResult.duplicates || 0} 条</p>
            )}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">工作流程</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Step num={1} title="PB 搜索" desc="PhantomBuster 在 LinkedIn 搜索目标客户" />
          <Step num={2} title="自动回调" desc="搜索完成后 PB 自动调用我们的 webhook" />
          <Step num={3} title="自动入库" desc="数据自动经过评分、去重、AI分析" />
          <Step num={4} title="自动开发" desc="合格线索自动发送开发信" />
        </div>
      </div>

      {/* Setup guide */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">配置方法</h3>
          <button
            onClick={() => setShowSetup(!showSetup)}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {showSetup ? '收起' : '展开配置指南'}
          </button>
        </div>

        {showSetup && (
          <div className="space-y-4 text-xs text-gray-600">
            <div>
              <p className="font-medium text-gray-800 mb-1">Step 1: 在 PhantomBuster 创建 Agent</p>
              <p>推荐用 "LinkedIn Search Export" 或 "LinkedIn Company Scraper" agent</p>
              <p>搜索关键词设为：Activewear brand, Sportswear buyer, Athletic clothing sourcing manager</p>
            </div>

            <div>
              <p className="font-medium text-gray-800 mb-1">Step 2: 配置 Webhook</p>
              <p>在 Agent Settings → Notifications → Webhook 中填入：</p>
              <div className="bg-gray-100 rounded p-2 font-mono text-xs mt-1 flex items-center justify-between">
                <span className="truncate">{webhookUrl}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                  className="ml-2 text-indigo-600 hover:text-indigo-800 flex-shrink-0"
                >
                  复制
                </button>
              </div>
            </div>

            <div>
              <p className="font-medium text-gray-800 mb-1">Step 3: 设置 Webhook Body</p>
              <p>在 webhook 配置中，设置 POST body 为 JSON：</p>
              <pre className="bg-gray-100 rounded p-2 mt-1 overflow-x-auto">{`{
  "source_type": "linkedin",
  "results": {{output}},
  "agent_id": "你的agent_id",
  "webhook_secret": "你设置的密钥"
}`}</pre>
            </div>

            <div>
              <p className="font-medium text-gray-800 mb-1">Step 4: 设置自动执行</p>
              <p>在 Agent Settings → Launch → Schedule 中设置定时执行（建议每天 1-2 次）</p>
            </div>

            <div>
              <p className="font-medium text-gray-800 mb-1">Step 5: 环境变量</p>
              <p>在 Vercel 环境变量中添加：</p>
              <div className="bg-gray-100 rounded p-2 mt-1 font-mono">
                PHANTOMBUSTER_API_KEY=你的PB API Key<br />
                PHANTOMBUSTER_WEBHOOK_SECRET=你设置的密钥
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Supported data */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">支持的数据类型</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <DataType label="LinkedIn Company Search" desc="搜索公司并提取公司信息" />
          <DataType label="LinkedIn People Search" desc="搜索决策人（采购经理、Sourcing）" />
          <DataType label="LinkedIn Profile Scraper" desc="提取个人资料详情" />
          <DataType label="Instagram Search" desc="搜索IG品牌账号" />
        </div>
      </div>
    </div>
  );
}

function Step({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div className="w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center mx-auto text-sm font-bold mb-1">
        {num}
      </div>
      <div className="text-xs font-medium text-gray-900">{title}</div>
      <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
    </div>
  );
}

function DataType({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="bg-gray-50 rounded p-2">
      <div className="font-medium text-gray-800">{label}</div>
      <div className="text-gray-500 mt-0.5">{desc}</div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import CustomsUploadPanel from '../intake/CustomsUploadPanel';

interface Props {
  customsCount: number;
  matchedCount: number;
}

export default function CustomsExplorer({ customsCount, matchedCount }: Props) {
  const [activeView, setActiveView] = useState<'upload' | 'browse'>('upload');

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-amber-200 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-amber-600">{customsCount}</div>
          <div className="text-xs text-gray-500">海关记录总数</div>
        </div>
        <div className="bg-white border border-green-200 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-green-600">{matchedCount}</div>
          <div className="text-xs text-gray-500">已匹配线索</div>
        </div>
        <div className="bg-white border border-blue-200 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-blue-600">{customsCount - matchedCount}</div>
          <div className="text-xs text-gray-500">待匹配</div>
        </div>
      </div>

      {/* Info about 特易数据 */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="text-sm font-medium text-amber-800">特易数据（tendata.cn）海关数据接入</div>
        <div className="text-xs text-amber-700 mt-1 space-y-1">
          <p>特易数据暂不支持 API 自动接入，需要手动导出后上传。建议操作流程：</p>
          <p>1. 登录特易数据 → 按 HS 编码 6109（T恤）/ 6110（毛衣）/ 6112（运动服）搜索</p>
          <p>2. 筛选目标国家的进口商 → 导出 Excel</p>
          <p>3. 在下方上传 → 系统自动解析、去重、匹配现有线索</p>
          <p className="font-medium mt-2">建议每周导出一次新数据，保持数据新鲜度。</p>
        </div>
      </div>

      {/* View switcher */}
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setActiveView('upload')}
          className={`text-xs px-3 py-1.5 rounded-lg ${activeView === 'upload' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-500'}`}
        >
          上传新数据
        </button>
        <button
          onClick={() => setActiveView('browse')}
          className={`text-xs px-3 py-1.5 rounded-lg ${activeView === 'browse' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-500'}`}
        >
          推荐 HS 编码
        </button>
      </div>

      {activeView === 'upload' && <CustomsUploadPanel />}

      {activeView === 'browse' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">以下是与我们产品最相关的 HS 编码，建议在特易数据中按这些编码搜索：</p>
          <div className="space-y-1">
            <HSCode code="6109" desc="T恤（针织）" relevance="核心" />
            <HSCode code="6110" desc="毛衣/套头衫（针织）— 含卫衣" relevance="核心" />
            <HSCode code="6112" desc="运动服/滑雪服（针织）— 含 Activewear" relevance="核心" />
            <HSCode code="6114" desc="其他针织服装" relevance="相关" />
            <HSCode code="6104" desc="女式西装/套装（针织）— 含瑜伽套装" relevance="相关" />
            <HSCode code="6105" desc="男式衬衫（针织）— 含 Polo 衫" relevance="相关" />
            <HSCode code="6201" desc="男式大衣/外套（梭织）" relevance="扩展" />
            <HSCode code="6202" desc="女式大衣/外套（梭织）" relevance="扩展" />
            <HSCode code="6211" desc="运动服/泳装（梭织）" relevance="扩展" />
          </div>
        </div>
      )}
    </div>
  );
}

function HSCode({ code, desc, relevance }: { code: string; desc: string; relevance: string }) {
  const colors = {
    '核心': 'bg-green-100 text-green-700',
    '相关': 'bg-blue-100 text-blue-700',
    '扩展': 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-100 rounded p-2">
      <span className="text-sm font-mono font-bold text-gray-900 w-12">{code}</span>
      <span className="text-xs text-gray-700 flex-1">{desc}</span>
      <span className={`text-xs px-2 py-0.5 rounded ${colors[relevance as keyof typeof colors] || colors['扩展']}`}>
        {relevance}
      </span>
    </div>
  );
}

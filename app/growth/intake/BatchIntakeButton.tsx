'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { runBatchIntake, runAutoScrape } from '@/app/actions/lead-intake';

export default function BatchIntakeButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; total: number; qualified: number; disqualified: number; duplicates?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async (type: 'batch' | 'scrape') => {
    setIsLoading(type);
    setError(null);
    setResult(null);

    try {
      const res = type === 'batch' ? await runBatchIntake() : await runAutoScrape();
      if (res?.error) {
        setError(res.error);
      } else if (res?.success) {
        setResult({
          label: type === 'batch' ? '批量导入' : '品牌抓取',
          total: res.total,
          qualified: res.qualified,
          disqualified: res.disqualified,
          duplicates: res.duplicates,
        });
        router.refresh();
      }
    } catch {
      setError('导入失败');
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => handleRun('scrape')}
          disabled={!!isLoading}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {isLoading === 'scrape' ? '抓取中...' : 'Run Auto Batch'}
        </button>
        <button
          onClick={() => handleRun('batch')}
          disabled={!!isLoading}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          {isLoading === 'batch' ? '导入中...' : '模拟50条'}
        </button>
      </div>
      {result && (
        <div className="text-xs text-green-600">
          {result.label}：{result.total} 条，合格 {result.qualified}，淘汰 {result.disqualified}
          {result.duplicates ? `，重复 ${result.duplicates}` : ''}
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}

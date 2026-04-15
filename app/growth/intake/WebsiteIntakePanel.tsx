'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { runWebsiteIntake, WebsiteIntakeResult } from '@/app/actions/website-intake';

export default function WebsiteIntakePanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<WebsiteIntakeResult | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setInput(text);

    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setResult(null);

    try {
      const firstLine = trimmed.split('\n')[0].toLowerCase();
      const format = (firstLine.includes('website') && firstLine.includes(','))
        ? 'csv' as const
        : 'txt' as const;

      const res = await runWebsiteIntake(trimmed, format);
      setResult(res);
      if (res.success) {
        router.refresh();
      }
    } catch {
      setResult({
        error: '请求失败',
        total: 0, qualified: 0, disqualified: 0, duplicates: 0,
        ig_only_count: 0, failures: [],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const lineCount = input.trim().split('\n').filter((l) => l.trim().length > 0).length;
  const isOverLimit = lineCount > 50;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          粘贴 URL 或上传 .txt / .csv 文件（每批最多 50 个）
        </p>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv"
            onChange={handleFileUpload}
            className="hidden"
            id="seed-file"
          />
          <label
            htmlFor="seed-file"
            className="cursor-pointer px-3 py-1.5 text-xs border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            上传文件
          </label>
        </div>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={`每行粘贴一个 URL：\nhttps://everlane.com\nhttps://vuoriclothing.com\n\n或 CSV 格式：\nwebsite,source_label,product_hint,notes\nhttps://everlane.com,,,\nhttps://vuoriclothing.com,,activewear,DTC品牌`}
        rows={6}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
        disabled={isLoading}
      />

      <div className="flex items-center justify-between mt-3">
        <div className="text-xs text-gray-500">
          {lineCount > 0 && (
            <span className={isOverLimit ? 'text-red-600 font-medium' : ''}>
              {lineCount} 个 URL
              {isOverLimit && '（超过限制 50）'}
            </span>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={isLoading || lineCount === 0 || isOverLimit}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? '富集并导入中...' : '开始网站批量导入'}
        </button>
      </div>

      {/* 结果 */}
      {result && (
        <div className={`mt-4 rounded-md p-3 text-sm ${result.error && !result.success ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
          {result.error && !result.success ? (
            <p>{result.error}</p>
          ) : (
            <>
              <p className="font-medium">
                共处理 {result.total} 条：{result.qualified} 条合格，{result.disqualified} 条已淘汰
                {result.duplicates > 0 && `，${result.duplicates} 条重复`}
              </p>
              {result.ig_only_count > 0 && (
                <p className="text-amber-700 mt-1">
                  {result.ig_only_count} 条仅有 IG（无邮箱/LinkedIn —已淘汰，可后续升级）
                </p>
              )}
            </>
          )}

          {result.failures.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs underline text-gray-600 hover:text-gray-800"
              >
                {expanded ? '隐藏' : '显示'} {result.failures.length} 个失败 URL
              </button>
              {expanded && (
                <ul className="mt-1 space-y-1">
                  {result.failures.map((f, i) => (
                    <li key={i} className="text-xs text-red-600">
                      {f.url} — {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

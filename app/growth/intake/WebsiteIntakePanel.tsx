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

    // Reset file input so the same file can be re-uploaded
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setResult(null);

    try {
      // Auto-detect format
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
        error: 'Request failed',
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
          Paste URLs or upload .txt / .csv file (max 50 per batch)
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
            Upload File
          </label>
        </div>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={`Paste one URL per line:\nhttps://everlane.com\nhttps://vuoriclothing.com\n\nOr CSV format:\nwebsite,source_label,product_hint,notes\nhttps://everlane.com,,,\nhttps://vuoriclothing.com,,activewear,DTC focus`}
        rows={6}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
        disabled={isLoading}
      />

      <div className="flex items-center justify-between mt-3">
        <div className="text-xs text-gray-500">
          {lineCount > 0 && (
            <span className={isOverLimit ? 'text-red-600 font-medium' : ''}>
              {lineCount} URL{lineCount !== 1 ? 's' : ''}
              {isOverLimit && ' (exceeds limit of 50)'}
            </span>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={isLoading || lineCount === 0 || isOverLimit}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Enriching & importing...' : 'Run Website Intake'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className={`mt-4 rounded-md p-3 text-sm ${result.error && !result.success ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
          {result.error && !result.success ? (
            <p>{result.error}</p>
          ) : (
            <>
              <p className="font-medium">
                {result.total} processed: {result.qualified} qualified, {result.disqualified} disqualified
                {result.duplicates > 0 && `, ${result.duplicates} duplicates`}
              </p>
              {result.ig_only_count > 0 && (
                <p className="text-amber-700 mt-1">
                  {result.ig_only_count} IG-only (no email/LI — disqualified, can upgrade later)
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
                {expanded ? 'Hide' : 'Show'} {result.failures.length} failed URL{result.failures.length !== 1 ? 's' : ''}
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

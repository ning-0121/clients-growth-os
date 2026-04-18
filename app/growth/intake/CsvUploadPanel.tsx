'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { parseCSV, autoDetectMapping, computeClientWarnings, ParsedCSV } from '@/lib/growth/csv-parser';
import { runCsvIntake, checkCsvDuplicates } from '@/app/actions/csv-intake';
import { LeadSource, CSVColumnMapping } from '@/lib/types';

/**
 * Read an xlsx/xls file and convert it to CSV text that our parser can handle.
 * Uses the xlsx (SheetJS) library.
 */
async function xlsxFileToCsv(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error('Excel 文件中没有工作表');
  const worksheet = wb.Sheets[firstSheet];
  // Convert to CSV, preserving empty cells
  return XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
}

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'website', label: 'Website' },
  { value: 'ig', label: 'Instagram' },
  { value: 'customs', label: '海关数据' },
  { value: 'referral', label: '推荐' },
];

const MAPPABLE_FIELDS: { key: keyof Omit<CSVColumnMapping, 'source_column'>; label: string; required?: boolean }[] = [
  { key: 'company_name', label: '公司名称', required: true },
  { key: 'contact_name', label: '联系人' },
  { key: 'website', label: '网站' },
  { key: 'contact_email', label: '邮箱' },
  { key: 'contact_linkedin', label: 'LinkedIn' },
  { key: 'instagram_handle', label: 'Instagram' },
  { key: 'product_match', label: '产品匹配' },
];

interface Warnings {
  total: number;
  likely_valid: number;
  missing_company_name: number;
  missing_website: number;
  missing_contact_path: number;
  likely_duplicates: number;
}

export default function CsvUploadPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [csv, setCsv] = useState<ParsedCSV | null>(null);
  const [mapping, setMapping] = useState<CSVColumnMapping | null>(null);
  const [defaultSource, setDefaultSource] = useState<LeadSource>('linkedin');
  const [warnings, setWarnings] = useState<Warnings | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; total?: number; qualified?: number; disqualified?: number; duplicates?: number } | null>(null);

  const readFile = async (file: File): Promise<string> => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      return xlsxFileToCsv(file);
    }
    return file.text();
  };

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFile(file);
      loadCsv(text);
    } catch (err: any) {
      setResult({ error: `文件解析失败：${err.message}` });
    }
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const text = await readFile(file);
      loadCsv(text);
    } catch (err: any) {
      setResult({ error: `文件解析失败：${err.message}` });
    }
  }, []);

  const loadCsv = (text: string) => {
    const parsed = parseCSV(text);
    if (parsed.rows.length === 0) {
      setResult({ error: 'CSV 中未找到数据行' });
      return;
    }
    setCsv(parsed);
    const detected = autoDetectMapping(parsed.headers);
    setMapping(detected);
    setWarnings(null);
    setResult(null);
  };

  const updateMapping = (field: keyof CSVColumnMapping, value: string) => {
    if (!mapping) return;
    setMapping({ ...mapping, [field]: value || null });
    setWarnings(null);
  };

  const runPreview = async () => {
    if (!csv || !mapping) return;
    setIsChecking(true);
    setResult(null);

    try {
      // Client-side warnings
      const clientW = computeClientWarnings(csv.rows, mapping);

      // Server-side dedup check
      const dupIndices = await checkCsvDuplicates(csv.rows, mapping, defaultSource);

      setWarnings({
        ...clientW,
        likely_duplicates: dupIndices.length,
      });
    } catch {
      setResult({ error: 'Preview check failed' });
    } finally {
      setIsChecking(false);
    }
  };

  const runImport = async () => {
    if (!csv || !mapping) return;
    setIsImporting(true);
    setResult(null);

    try {
      const res = await runCsvIntake(csv.rows, mapping, defaultSource);
      setResult(res);
      if (res.success) {
        router.refresh();
      }
    } catch {
      setResult({ error: 'Import failed' });
    } finally {
      setIsImporting(false);
    }
  };

  const reset = () => {
    setCsv(null);
    setMapping(null);
    setWarnings(null);
    setResult(null);
  };

  const previewRows = csv ? csv.rows.slice(0, 5) : [];
  const isOverLimit = (csv?.rows.length || 0) > 200;

  return (
    <div className="space-y-4">
      {/* Upload area */}
      {!csv ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-indigo-400 transition-colors"
        >
          <p className="text-sm text-gray-600 mb-2">
            拖放 Excel / CSV 文件或点击浏览
          </p>
          <p className="text-xs text-gray-400 mb-4">
            支持 .xlsx / .xls / .csv，最多 200 行（PhantomBuster / 手工整理均可）
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFile}
            className="hidden"
            id="csv-file"
          />
          <label
            htmlFor="csv-file"
            className="cursor-pointer px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
          >
            浏览文件
          </label>
        </div>
      ) : (
        <>
          {/* File loaded header */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">
              <span className="font-medium">{csv.rows.length} 行</span>
              <span className="text-gray-400 mx-1">/</span>
              <span>{csv.headers.length} 列</span>
              {isOverLimit && (
                <span className="text-red-600 font-medium ml-2">(超过限制 200 行)</span>
              )}
            </div>
            <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 underline">
              清除重新上传
            </button>
          </div>

          {/* Preview table (first 5 rows) */}
          <div className="overflow-x-auto border border-gray-200 rounded-md">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {csv.headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {csv.headers.map((h) => (
                      <td key={h} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[200px] truncate">
                        {row[h] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {csv.rows.length > 5 && (
              <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50 border-t">
                ... 还有 {csv.rows.length - 5} 行
              </div>
            )}
          </div>

          {/* Column mapping */}
          <div className="bg-gray-50 rounded-md border border-gray-200 p-4">
            <h4 className="text-xs font-semibold text-gray-700 mb-3">列映射</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MAPPABLE_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-20 shrink-0">
                    {f.label}{f.required && <span className="text-red-500">*</span>}
                  </span>
                  <span className="text-xs text-gray-400">←</span>
                  <select
                    value={(mapping as any)?.[f.key] || ''}
                    onChange={(e) => updateMapping(f.key, e.target.value)}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">— 未映射 —</option>
                    {csv.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                    {/* firstName+lastName concat options */}
                    {f.key === 'contact_name' && getNameConcatOptions(csv.headers).map((opt) => (
                      <option key={opt} value={opt}>{opt} (concat)</option>
                    ))}
                  </select>
                </div>
              ))}

              {/* Source column (per-row override) */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-20 shrink-0">来源列</span>
                <span className="text-xs text-gray-400">←</span>
                <select
                  value={mapping?.source_column || ''}
                  onChange={(e) => updateMapping('source_column', e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">— 全部使用默认来源 —</option>
                  {csv.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Default source */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-20 shrink-0">默认来源</span>
                <span className="text-xs text-gray-400">←</span>
                <select
                  value={defaultSource}
                  onChange={(e) => setDefaultSource(e.target.value as LeadSource)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Warnings */}
          {warnings && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
              <h4 className="text-xs font-semibold text-amber-800 mb-2">导入质量预览</h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <WarningCard label="可能有效" value={warnings.likely_valid} total={warnings.total} color="green" />
                <WarningCard label="可能重复" value={warnings.likely_duplicates} total={warnings.total} color={warnings.likely_duplicates > 0 ? 'red' : 'green'} />
                <WarningCard label="缺少联系方式" value={warnings.missing_contact_path} total={warnings.total} color={warnings.missing_contact_path > 0 ? 'amber' : 'green'} />
                <WarningCard label="缺少网站" value={warnings.missing_website} total={warnings.total} color={warnings.missing_website > 0 ? 'amber' : 'green'} />
                <WarningCard label="缺少公司名" value={warnings.missing_company_name} total={warnings.total} color={warnings.missing_company_name > 0 ? 'red' : 'green'} />
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`rounded-md p-3 text-sm ${result.error && !result.success ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
              {result.error && !result.success ? (
                <p>{result.error}</p>
              ) : (
                <p className="font-medium">
                  {result.total} processed: {result.qualified} qualified, {result.disqualified} disqualified
                  {(result.duplicates || 0) > 0 && `, ${result.duplicates} duplicates`}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={runPreview}
              disabled={isChecking || isImporting || !mapping?.company_name}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChecking ? '检查中...' : '预览警告'}
            </button>
            <button
              onClick={runImport}
              disabled={isImporting || isChecking || !mapping?.company_name || isOverLimit}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isImporting ? '导入中...' : `导入全部 (${csv.rows.length})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function WarningCard({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-green-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  };
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${colorMap[color] || 'text-gray-700'}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function getNameConcatOptions(headers: string[]): string[] {
  const firstNames = ['firstName', 'first_name', 'First', 'first'];
  const lastNames = ['lastName', 'last_name', 'Last', 'last'];

  const options: string[] = [];
  for (const h1 of headers) {
    if (firstNames.some((f) => h1.toLowerCase().replace(/_/g, '') === f.toLowerCase().replace(/_/g, ''))) {
      for (const h2 of headers) {
        if (lastNames.some((l) => h2.toLowerCase().replace(/_/g, '') === l.toLowerCase().replace(/_/g, ''))) {
          options.push(`${h1}+${h2}`);
        }
      }
    }
  }
  return options;
}

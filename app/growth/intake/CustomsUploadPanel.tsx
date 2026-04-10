'use client';

import { useState, useRef } from 'react';
import { importCustomsCSV, importCustomsExcel } from '@/app/actions/customs-intake';

export default function CustomsUploadPanel() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState<{ total: number; imported: number; duplicates: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('loading');
    setMessage('正在解析并导入海关数据...');
    setStats(null);

    try {
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.csv') || fileName.endsWith('.tsv') || fileName.endsWith('.txt')) {
        const text = await file.text();
        const result = await importCustomsCSV(text);
        handleResult(result);
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const result = await importCustomsExcel(base64);
        handleResult(result);
      } else {
        setStatus('error');
        setMessage('不支持的文件格式。请上传 CSV 或 Excel (.xlsx) 文件。');
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || '导入失败');
    }

    // Reset file input
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleResult(result: { success: boolean; error?: string; total: number; imported: number; duplicates: number }) {
    if (result.success) {
      setStatus('success');
      setStats({ total: result.total, imported: result.imported, duplicates: result.duplicates });
      setMessage(`导入完成！共 ${result.total} 条记录，新增 ${result.imported} 条，重复 ${result.duplicates} 条。`);
    } else {
      setStatus('error');
      setMessage(result.error || '导入失败');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">导入海关数据</h3>
        <p className="text-xs text-gray-500 mb-3">
          上传从海关数据平台导出的 CSV 或 Excel 文件。系统会自动识别列映射（进口商、HS编码、金额、产地等）并去重入库。
          导入后的数据将自动用于线索交叉验证。
        </p>
      </div>

      {/* Supported columns info */}
      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
        <div className="font-medium mb-1">支持的列名（自动识别）:</div>
        <div className="grid grid-cols-2 gap-1">
          <span>进口商/importer/buyer <span className="text-red-500">*必填</span></span>
          <span>HS编码/hs_code/tariff_code</span>
          <span>商品描述/product_desc</span>
          <span>金额/value_usd/amount</span>
          <span>重量/weight_kg</span>
          <span>数量/quantity</span>
          <span>原产国/origin_country</span>
          <span>日期/import_date</span>
          <span>出口商/exporter/supplier</span>
          <span>提单号/bill_of_lading</span>
        </div>
      </div>

      {/* Upload area */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-indigo-400 transition-colors">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,.tsv,.txt"
          onChange={handleFileUpload}
          className="hidden"
          id="customs-file-input"
          disabled={status === 'loading'}
        />
        <label
          htmlFor="customs-file-input"
          className="cursor-pointer"
        >
          <div className="text-gray-400 mb-2">
            <svg className="mx-auto h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <span className="text-sm text-gray-600">
            {status === 'loading' ? '导入中...' : '点击上传海关数据文件 (CSV / Excel)'}
          </span>
        </label>
      </div>

      {/* Status message */}
      {message && (
        <div className={`rounded-lg p-3 text-sm ${
          status === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          status === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {message}
        </div>
      )}

      {/* Import stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-gray-900">{stats.total}</div>
            <div className="text-xs text-gray-500">总记录数</div>
          </div>
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-green-600">{stats.imported}</div>
            <div className="text-xs text-gray-500">新增导入</div>
          </div>
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-amber-600">{stats.duplicates}</div>
            <div className="text-xs text-gray-500">重复跳过</div>
          </div>
        </div>
      )}
    </div>
  );
}

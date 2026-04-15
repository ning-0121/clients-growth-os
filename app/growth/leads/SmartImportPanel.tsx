'use client';

import { useState } from 'react';
import CsvUploadPanel from '../intake/CsvUploadPanel';
import ManualIntakeForm from '../intake/ManualIntakeForm';

type ImportMode = 'csv' | 'manual';

export default function SmartImportPanel() {
  const [mode, setMode] = useState<ImportMode>('csv');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setMode('csv')}
          className={`text-xs px-3 py-1.5 rounded-lg ${mode === 'csv' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          Excel / CSV 上传
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`text-xs px-3 py-1.5 rounded-lg ${mode === 'manual' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          手工录入
        </button>
      </div>

      {mode === 'csv' && <CsvUploadPanel />}
      {mode === 'manual' && <ManualIntakeForm />}
    </div>
  );
}

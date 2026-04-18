'use client';

import { useState } from 'react';
import DealsTabs from './DealsTabs';

type CategoryFilter = 'all' | 'A' | 'B' | 'C' | 'D';

interface Props {
  counts: { A: number; B: number; C: number; D: number };
  todayLeads: any[];
  awaitingReply: any[];
  repliedLeads: any[];
  silentLeads: any[];
  isAdmin: boolean;
  salesStaff: any[];
}

export default function DealsCategoryAndList({ counts, todayLeads, awaitingReply, repliedLeads, silentLeads, isAdmin, salesStaff }: Props) {
  const [filter, setFilter] = useState<CategoryFilter>('all');

  return (
    <>
      {/* Clickable category summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <CategoryCard
          active={filter === 'A'}
          onClick={() => setFilter(filter === 'A' ? 'all' : 'A')}
          count={counts.A}
          label="A级 · 高价值"
          color="text-green-600"
          activeColor="bg-green-50 border-green-500 ring-2 ring-green-200"
          defaultColor="border-green-200"
        />
        <CategoryCard
          active={filter === 'B'}
          onClick={() => setFilter(filter === 'B' ? 'all' : 'B')}
          count={counts.B}
          label="B级 · 有潜力"
          color="text-blue-600"
          activeColor="bg-blue-50 border-blue-500 ring-2 ring-blue-200"
          defaultColor="border-blue-200"
        />
        <CategoryCard
          active={filter === 'C'}
          onClick={() => setFilter(filter === 'C' ? 'all' : 'C')}
          count={counts.C}
          label="C级 · 待开发"
          color="text-amber-600"
          activeColor="bg-amber-50 border-amber-500 ring-2 ring-amber-200"
          defaultColor="border-amber-200"
        />
        <CategoryCard
          active={filter === 'D'}
          onClick={() => setFilter(filter === 'D' ? 'all' : 'D')}
          count={counts.D}
          label="D级 · 待培育"
          color="text-gray-500"
          activeColor="bg-gray-100 border-gray-500 ring-2 ring-gray-300"
          defaultColor="border-gray-200"
        />
      </div>

      {/* Filter hint */}
      {filter !== 'all' && (
        <div className="mb-3 text-xs text-gray-600 flex items-center gap-2">
          <span>已筛选 <span className="font-semibold">{filter}级</span> 客户</span>
          <button
            onClick={() => setFilter('all')}
            className="text-indigo-600 hover:text-indigo-700 underline"
          >
            清除筛选
          </button>
        </div>
      )}

      <DealsTabs
        todayLeads={todayLeads}
        awaitingReply={awaitingReply}
        repliedLeads={repliedLeads}
        silentLeads={silentLeads}
        isAdmin={isAdmin}
        salesStaff={salesStaff}
        initialCategoryFilter={filter}
        key={filter} // Force re-mount when filter changes to sync state
      />
    </>
  );
}

function CategoryCard({ active, onClick, count, label, color, activeColor, defaultColor }: {
  active: boolean;
  onClick: () => void;
  count: number;
  label: string;
  color: string;
  activeColor: string;
  defaultColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-lg p-3 border text-center transition-all hover:shadow-md cursor-pointer ${
        active ? activeColor : defaultColor
      }`}
    >
      <div className={`text-xl font-bold ${color}`}>{count}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      <div className="text-xs text-gray-400 mt-0.5">{active ? '✓ 已筛选' : '点击筛选'}</div>
    </button>
  );
}

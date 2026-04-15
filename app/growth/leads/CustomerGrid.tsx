'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, ICellRendererParams } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

interface Props {
  leads: any[];
  isAdmin: boolean;
}

// ── Cell Renderers ──

function ProbabilityCell(params: ICellRendererParams) {
  const prob = params.value || 0;
  const color = prob >= 81 ? '#16a34a' : prob >= 61 ? '#ea580c' : prob >= 41 ? '#2563eb' : prob >= 21 ? '#ca8a04' : '#9ca3af';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 700, color, minWidth: 32 }}>{prob}%</span>
      <div style={{ flex: 1, height: 4, background: '#f3f4f6', borderRadius: 2 }}>
        <div style={{ width: `${prob}%`, height: 4, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function GradeCell(params: ICellRendererParams) {
  const colors: Record<string, string> = {
    A: '#166534', 'B+': '#1e40af', B: '#854d0e', C: '#6b7280',
  };
  const bgs: Record<string, string> = {
    A: '#dcfce7', 'B+': '#dbeafe', B: '#fef9c3', C: '#f3f4f6',
  };
  const grade = params.value || 'C';
  return (
    <span style={{ background: bgs[grade] || bgs.C, color: colors[grade] || colors.C, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {grade}
    </span>
  );
}

function CategoryCell(params: ICellRendererParams) {
  const cat = params.value || 'D';
  const configs: Record<string, { bg: string; color: string }> = {
    A: { bg: '#dcfce7', color: '#166534' },
    B: { bg: '#dbeafe', color: '#1e40af' },
    C: { bg: '#fef3c7', color: '#92400e' },
    D: { bg: '#f3f4f6', color: '#6b7280' },
  };
  const c = configs[cat] || configs.D;
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
      {cat}级
    </span>
  );
}

function ContactCell(params: ICellRendererParams) {
  const lead = params.data;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {lead.contact_email && <span style={{ background: '#eff6ff', color: '#2563eb', padding: '1px 6px', borderRadius: 3, fontSize: 10 }}>邮箱</span>}
      {lead.contact_linkedin && <span style={{ background: '#eef2ff', color: '#4338ca', padding: '1px 6px', borderRadius: 3, fontSize: 10 }}>LI</span>}
      {lead.instagram_handle && <span style={{ background: '#fdf2f8', color: '#be185d', padding: '1px 6px', borderRadius: 3, fontSize: 10 }}>IG</span>}
      {!lead.contact_email && !lead.contact_linkedin && !lead.instagram_handle && (
        <span style={{ color: '#d1d5db', fontSize: 10 }}>无</span>
      )}
    </div>
  );
}

function ActionCell(params: ICellRendererParams) {
  const action = params.data?.next_recommended_action;
  if (!action) return null;
  return (
    <span style={{ background: '#eef2ff', color: '#4338ca', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
      {action}
    </span>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  ig: 'IG', linkedin: 'LI', website: '网站', customs: '海关', referral: '推荐',
  test_batch: '测试', google: '搜索', apollo: 'Apollo', directory: '目录',
};

const STAGE_LABELS: Record<string, string> = {
  hot: '高概率', high_interest: '高兴趣', interested: '有兴趣',
  slight_interest: '微兴趣', cold: '冷客户',
};

function categorize(l: any): string {
  const prob = l.deal_probability || 0;
  if (prob >= 61 || (l.grade === 'A' && l.action_count > 0)) return 'A';
  if (prob >= 41 || (l.grade === 'B+' && l.action_count > 0)) return 'B';
  if (prob >= 21 || l.first_touch_at) return 'C';
  return 'D';
}

export default function CustomerGrid({ leads, isAdmin }: Props) {
  const router = useRouter();

  const rowData = useMemo(() => {
    return leads
      .filter((l: any) => l.status !== 'disqualified')
      .map((l: any) => ({
        ...l,
        category: categorize(l),
        source_label: SOURCE_LABELS[l.source] || l.source || '',
        stage_label: STAGE_LABELS[l.probability_stage] || l.probability_stage || '',
        days_since: l.last_action_at
          ? Math.floor((Date.now() - new Date(l.last_action_at).getTime()) / 86400000)
          : null,
      }));
  }, [leads]);

  const columnDefs = useMemo<ColDef[]>(() => [
    {
      headerName: '级别',
      field: 'category',
      width: 70,
      cellRenderer: CategoryCell,
      filter: true,
      sort: 'asc',
    },
    {
      headerName: '概率',
      field: 'deal_probability',
      width: 120,
      cellRenderer: ProbabilityCell,
      filter: 'agNumberColumnFilter',
      sortable: true,
    },
    {
      headerName: '公司名称',
      field: 'company_name',
      flex: 2,
      minWidth: 150,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
    },
    {
      headerName: '等级',
      field: 'grade',
      width: 70,
      cellRenderer: GradeCell,
      filter: true,
    },
    {
      headerName: '来源',
      field: 'source_label',
      width: 80,
      filter: true,
    },
    {
      headerName: '联系方式',
      field: 'contact_email',
      width: 100,
      cellRenderer: ContactCell,
      filter: true,
      filterValueGetter: (params: any) => {
        const d = params.data;
        if (d.contact_email) return '有邮箱';
        if (d.contact_linkedin) return '有LI';
        if (d.instagram_handle) return '有IG';
        return '无';
      },
    },
    {
      headerName: '邮箱',
      field: 'contact_email',
      width: 180,
      filter: 'agTextColumnFilter',
      hide: true, // Hidden by default, user can show
    },
    {
      headerName: '推荐动作',
      field: 'next_recommended_action',
      flex: 1,
      minWidth: 120,
      cellRenderer: ActionCell,
    },
    {
      headerName: '负责人',
      field: 'assigned_name',
      width: 80,
      filter: true,
    },
    {
      headerName: '最近互动',
      field: 'days_since',
      width: 90,
      valueFormatter: (params: any) => {
        if (params.value === null) return '—';
        if (params.value === 0) return '今天';
        return `${params.value}天前`;
      },
      cellStyle: (params: any) => {
        if (params.value !== null && params.value > 14) return { color: '#ef4444', fontWeight: 600 };
        return null;
      },
      filter: 'agNumberColumnFilter',
      sortable: true,
    },
    {
      headerName: '阶段',
      field: 'stage_label',
      width: 80,
      filter: true,
      hide: true,
    },
    {
      headerName: '网站',
      field: 'website',
      width: 150,
      filter: 'agTextColumnFilter',
      hide: true,
    },
  ], []);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: true,
    resizable: true,
    suppressMovable: false,
  }), []);

  const onRowClicked = useCallback((event: any) => {
    if (event.data?.id) {
      router.push(`/growth/leads/${event.data.id}`);
    }
  }, [router]);

  return (
    <div className="ag-theme-alpine" style={{ width: '100%', height: Math.min(600, Math.max(300, rowData.length * 42 + 80)) }}>
      <AgGridReact
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        onRowClicked={onRowClicked}
        rowSelection="single"
        animateRows={true}
        pagination={true}
        paginationPageSize={50}
        suppressCellFocus={true}
        rowStyle={{ cursor: 'pointer' }}
        overlayNoRowsTemplate="<span style='padding:20px;color:#9ca3af'>暂无客户数据，AI 正在 24 小时搜索中...</span>"
      />
    </div>
  );
}

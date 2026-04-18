'use client';

import { useState } from 'react';
import { approveAndSendEmail, rejectEmail } from '@/app/actions/approvals';

interface Approval {
  id: string;
  lead_id: string;
  lead_category: string | null;
  to_email: string;
  subject: string;
  body_text: string;
  step_number: number;
  email_type: string;
  submitted_by_name: string | null;
  submitted_at: string;
  status: string;
  review_notes: string | null;
  send_error: string | null;
  growth_leads: { company_name: string; contact_name: string | null } | null;
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  pending:  { label: '待审批', color: 'bg-amber-100 text-amber-700' },
  approved: { label: '已批准', color: 'bg-blue-100 text-blue-700' },
  sent:     { label: '已发送', color: 'bg-green-100 text-green-700' },
  rejected: { label: '已拒绝', color: 'bg-red-100 text-red-700' },
  failed:   { label: '发送失败', color: 'bg-red-100 text-red-700' },
};

export default function ApprovalsQueue({ approvals, isAdmin }: { approvals: Approval[]; isAdmin: boolean }) {
  const [filter, setFilter] = useState<'pending' | 'all' | 'sent' | 'rejected'>('pending');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const filtered = filter === 'all' ? approvals : approvals.filter(a => a.status === filter);

  async function handleApprove(id: string) {
    setLoadingId(id);
    setMsg(null);
    const res = await approveAndSendEmail(id);
    setLoadingId(null);
    if (res.error) {
      setMsg({ id, text: res.error, ok: false });
    } else {
      setMsg({ id, text: '✅ 已批准并发送', ok: true });
    }
  }

  async function handleReject(id: string) {
    if (!rejectNotes.trim()) { setMsg({ id, text: '请填写拒绝原因', ok: false }); return; }
    setLoadingId(id);
    const res = await rejectEmail(id, rejectNotes);
    setLoadingId(null);
    if (res.error) {
      setMsg({ id, text: res.error, ok: false });
    } else {
      setRejectingId(null);
      setRejectNotes('');
      setMsg({ id, text: '已拒绝', ok: true });
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Filter tabs */}
      <div className="flex gap-2 px-4 py-3 border-b overflow-x-auto">
        {(['pending', 'sent', 'rejected', 'all'] as const).map((f) => {
          const count = f === 'all' ? approvals.length : approvals.filter(a => a.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                filter === f
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              {f === 'pending' ? '待审批' : f === 'sent' ? '已发送' : f === 'rejected' ? '已拒绝' : '全部'}
              <span className="ml-1 text-gray-400">{count}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="divide-y">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-gray-400">
              {filter === 'pending' ? '没有待审批的邮件' : '暂无记录'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              A/B级高价值客户的邮件提交后会出现在这里
            </p>
          </div>
        ) : (
          filtered.map((a) => {
            const cfg = STATUS_CFG[a.status] || { label: a.status, color: 'bg-gray-100 text-gray-600' };
            const company = a.growth_leads?.company_name || '(unknown)';
            const contactName = a.growth_leads?.contact_name || '';

            return (
              <div key={a.id} className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      {a.lead_category && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                          a.lead_category === 'A' ? 'bg-green-100 text-green-700' :
                          a.lead_category === 'B' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {a.lead_category}级
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-900">{company}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      → {contactName ? `${contactName} <${a.to_email}>` : a.to_email}
                      {a.submitted_by_name && <span className="ml-2">· 提交人: {a.submitted_by_name}</span>}
                      <span className="ml-2">· {new Date(a.submitted_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>

                {/* Email preview */}
                <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                  <div className="bg-white px-3 py-2 border-b border-gray-200">
                    <span className="text-xs text-gray-500">主题：</span>
                    <span className="text-sm text-gray-900 font-medium ml-1">{a.subject}</span>
                  </div>
                  <div className="p-3">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
{a.body_text}
                    </pre>
                  </div>
                </div>

                {/* Review notes / error */}
                {a.review_notes && (
                  <p className="text-xs text-gray-600 bg-gray-50 rounded p-2">
                    <span className="font-medium">审批备注：</span> {a.review_notes}
                  </p>
                )}
                {a.send_error && (
                  <p className="text-xs text-red-600 bg-red-50 rounded p-2">
                    <span className="font-medium">发送错误：</span> {a.send_error}
                  </p>
                )}

                {/* Actions (only for pending, admin only) */}
                {a.status === 'pending' && isAdmin && (
                  <>
                    {rejectingId === a.id ? (
                      <div className="flex gap-2 items-start">
                        <input
                          value={rejectNotes}
                          onChange={e => setRejectNotes(e.target.value)}
                          placeholder="拒绝原因（必填）"
                          className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-400"
                        />
                        <button
                          onClick={() => handleReject(a.id)}
                          disabled={loadingId === a.id}
                          className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {loadingId === a.id ? '...' : '确认拒绝'}
                        </button>
                        <button
                          onClick={() => { setRejectingId(null); setRejectNotes(''); }}
                          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(a.id)}
                          disabled={loadingId === a.id}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                        >
                          {loadingId === a.id ? '发送中...' : '✅ 批准并发送'}
                        </button>
                        <button
                          onClick={() => setRejectingId(a.id)}
                          className="px-4 py-1.5 text-xs font-medium border border-red-300 text-red-600 rounded hover:bg-red-50"
                        >
                          ❌ 拒绝
                        </button>
                      </div>
                    )}
                  </>
                )}

                {a.status === 'pending' && !isAdmin && (
                  <p className="text-xs text-gray-500 italic">等待管理员审批...</p>
                )}

                {msg?.id === a.id && (
                  <p className={`text-xs px-2 py-1 rounded ${msg.ok ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                    {msg.text}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

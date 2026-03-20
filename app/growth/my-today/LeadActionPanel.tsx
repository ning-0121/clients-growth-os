'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { recordLeadAction } from '@/app/actions/lead-actions';
import { LeadActionType } from '@/lib/types';

interface Props {
  leadId: string;
  leadName: string;
  recommendedAction: string; // action_type to highlight
  prefillEmail: string;
  prefillPlatform: string;
}

type ActionMode = LeadActionType | null;

const ACTION_BUTTONS: { type: LeadActionType; label: string; style: string; highlightStyle: string }[] = [
  { type: 'email', label: '邮件', style: 'border border-blue-300 text-blue-700 hover:bg-blue-50', highlightStyle: 'bg-blue-600 text-white ring-2 ring-blue-300 hover:bg-blue-700' },
  { type: 'social_outreach', label: '社交触达', style: 'border border-indigo-300 text-indigo-700 hover:bg-indigo-50', highlightStyle: 'bg-indigo-600 text-white ring-2 ring-indigo-300 hover:bg-indigo-700' },
  { type: 'call', label: '电话', style: 'border border-green-300 text-green-700 hover:bg-green-50', highlightStyle: 'bg-green-600 text-white ring-2 ring-green-300 hover:bg-green-700' },
  { type: 'reject', label: '拒绝', style: 'border border-red-200 text-red-500 hover:bg-red-50', highlightStyle: 'border border-red-200 text-red-500 hover:bg-red-50' },
  { type: 'return', label: '退回', style: 'border border-gray-200 text-gray-500 hover:bg-gray-50', highlightStyle: 'border border-gray-200 text-gray-500 hover:bg-gray-50' },
];

export default function LeadActionPanel({
  leadId,
  leadName,
  recommendedAction,
  prefillEmail,
  prefillPlatform,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<ActionMode>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields — pre-filled where possible
  const [note, setNote] = useState('');
  const [emailTo, setEmailTo] = useState(prefillEmail);
  const [emailSubject, setEmailSubject] = useState('');
  const [platform, setPlatform] = useState(prefillPlatform);
  const [messagePreview, setMessagePreview] = useState('');
  const [callDuration, setCallDuration] = useState('');
  const [callOutcome, setCallOutcome] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = async () => {
    if (!mode) return;
    setIsLoading(true);
    setError(null);

    let evidenceJson: Record<string, any> = {};

    if (mode === 'email') {
      if (!emailTo.trim() || !emailSubject.trim()) {
        setError('请填写收件人和主题');
        setIsLoading(false);
        return;
      }
      evidenceJson = { to: emailTo.trim(), subject: emailSubject.trim() };
    } else if (mode === 'social_outreach') {
      if (!messagePreview.trim()) {
        setError('请填写消息内容');
        setIsLoading(false);
        return;
      }
      evidenceJson = { platform, message_preview: messagePreview.trim() };
    } else if (mode === 'call') {
      if (!callOutcome.trim()) {
        setError('请填写通话结果');
        setIsLoading(false);
        return;
      }
      evidenceJson = {
        duration_min: parseInt(callDuration) || 0,
        outcome: callOutcome.trim(),
      };
    } else if (mode === 'reject' || mode === 'return') {
      if (!reason.trim()) {
        setError('请填写原因');
        setIsLoading(false);
        return;
      }
      evidenceJson = { reason: reason.trim() };
    }

    const result = await recordLeadAction(leadId, mode, note.trim() || null, evidenceJson);

    if (result?.error) {
      setError(result.error);
    } else {
      setMode(null);
      router.refresh();
    }
    setIsLoading(false);
  };

  if (!mode) {
    return (
      <div className="flex flex-row sm:flex-col flex-wrap gap-1.5 sm:ml-4 shrink-0">
        {ACTION_BUTTONS.map((btn) => {
          const isRecommended = btn.type === recommendedAction;
          return (
            <button
              key={btn.type}
              onClick={() => setMode(btn.type)}
              className={`text-xs px-3 py-2 rounded ${isRecommended ? btn.highlightStyle : btn.style}`}
            >
              {btn.label}{isRecommended ? ' ←' : ''}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="w-full sm:ml-4 sm:w-72 bg-white border border-gray-200 rounded-lg p-3 shadow-sm shrink-0">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-semibold text-gray-700">
          {mode === 'email' && '记录邮件触达'}
          {mode === 'social_outreach' && '记录社交触达'}
          {mode === 'call' && '记录电话触达'}
          {mode === 'reject' && '拒绝线索'}
          {mode === 'return' && '退回线索'}
        </span>
        <button
          onClick={() => { setMode(null); setError(null); }}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          取消
        </button>
      </div>

      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}

      <div className="space-y-2">
        {mode === 'email' && (
          <>
            <input
              type="text" placeholder="收件人邮箱" value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
            />
            <input
              type="text" placeholder="邮件主题" value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
            />
          </>
        )}

        {mode === 'social_outreach' && (
          <>
            <select
              value={platform} onChange={(e) => setPlatform(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="linkedin">LinkedIn</option>
              <option value="instagram">Instagram</option>
              <option value="wechat">WeChat</option>
            </select>
            <textarea
              placeholder="发送的消息内容" value={messagePreview}
              onChange={(e) => setMessagePreview(e.target.value)}
              rows={2}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
            />
          </>
        )}

        {mode === 'call' && (
          <>
            <input
              type="number" placeholder="通话时长（分钟）" value={callDuration}
              onChange={(e) => setCallDuration(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
            />
            <input
              type="text" placeholder="通话结果（如：有意向、需样品等）" value={callOutcome}
              onChange={(e) => setCallOutcome(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
            />
          </>
        )}

        {(mode === 'reject' || mode === 'return') && (
          <textarea
            placeholder={mode === 'reject' ? '拒绝原因' : '退回原因'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
          />
        )}

        <textarea
          placeholder="备注（选填）" value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={1}
          className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
        />

        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full text-xs px-3 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
        >
          {isLoading ? '提交中...' : '提交'}
        </button>
      </div>
    </div>
  );
}

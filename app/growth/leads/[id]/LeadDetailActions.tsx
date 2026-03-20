'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { recordLeadAction, markMeaningfulReply, promoteLeadToDeal } from '@/app/actions/lead-actions';
import { LeadActionType } from '@/lib/types';

interface Props {
  leadId: string;
  leadName: string;
  recommendedAction: string;
  prefillEmail: string;
  prefillPlatform: string;
  productMatch: string;
}

type Mode = LeadActionType | 'promote_form' | null;

export default function LeadDetailActions({
  leadId,
  leadName,
  recommendedAction,
  prefillEmail,
  prefillPlatform,
  productMatch,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form fields
  const [note, setNote] = useState('');
  const [emailTo, setEmailTo] = useState(prefillEmail);
  const [emailSubject, setEmailSubject] = useState('');
  const [platform, setPlatform] = useState(prefillPlatform);
  const [messagePreview, setMessagePreview] = useState('');
  const [callDuration, setCallDuration] = useState('');
  const [callOutcome, setCallOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [replySummary, setReplySummary] = useState('');
  // Promote fields
  const [estimatedValue, setEstimatedValue] = useState('');
  const [promoteCategory, setPromoteCategory] = useState(productMatch);
  const [promoteNotes, setPromoteNotes] = useState('');

  const reset = () => {
    setMode(null);
    setError(null);
    setSuccess(null);
    setNote('');
    setEmailSubject('');
    setMessagePreview('');
    setCallDuration('');
    setCallOutcome('');
    setReason('');
    setReplySummary('');
  };

  const handleAction = async () => {
    if (!mode) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    let result: any;

    if (mode === 'reply') {
      if (!replySummary.trim()) {
        setError('请填写回复内容摘要');
        setIsLoading(false);
        return;
      }
      result = await markMeaningfulReply(leadId, replySummary.trim());
    } else if (mode === 'promote_form') {
      result = await promoteLeadToDeal(leadId, {
        estimated_order_value: estimatedValue ? parseFloat(estimatedValue) : undefined,
        product_category: promoteCategory.trim() || undefined,
        notes: promoteNotes.trim() || undefined,
      });
    } else {
      let evidenceJson: Record<string, any> = {};

      if (mode === 'email') {
        if (!emailTo.trim() || !emailSubject.trim()) { setError('请填写收件人和主题'); setIsLoading(false); return; }
        evidenceJson = { to: emailTo.trim(), subject: emailSubject.trim() };
      } else if (mode === 'social_outreach') {
        if (!messagePreview.trim()) { setError('请填写消息内容'); setIsLoading(false); return; }
        evidenceJson = { platform, message_preview: messagePreview.trim() };
      } else if (mode === 'call') {
        if (!callOutcome.trim()) { setError('请填写通话结果'); setIsLoading(false); return; }
        evidenceJson = { duration_min: parseInt(callDuration) || 0, outcome: callOutcome.trim() };
      } else if (mode === 'reject' || mode === 'return') {
        if (!reason.trim()) { setError('请填写原因'); setIsLoading(false); return; }
        evidenceJson = { reason: reason.trim() };
      }

      result = await recordLeadAction(leadId, mode, note.trim() || null, evidenceJson);
    }

    if (result?.error) {
      setError(result.error);
    } else {
      setSuccess(mode === 'promote_form' ? '已转为商机' : '操作成功');
      reset();
      router.refresh();
    }
    setIsLoading(false);
  };

  const isRec = (type: string) => type === recommendedAction;

  if (!mode) {
    return (
      <div>
        {success && <div className="text-xs text-green-600 mb-3">{success}</div>}
        <div className="flex flex-wrap gap-2">
          <ActionBtn label="邮件" highlight={isRec('email')} color="blue" onClick={() => setMode('email')} />
          <ActionBtn label="社交触达" highlight={isRec('social_outreach')} color="indigo" onClick={() => setMode('social_outreach')} />
          <ActionBtn label="电话" highlight={isRec('call')} color="green" onClick={() => setMode('call')} />
          <ActionBtn label="收到回复" highlight={false} color="teal" onClick={() => setMode('reply')} />
          <ActionBtn label="转为商机" highlight={false} color="purple" onClick={() => setMode('promote_form')} />
          <ActionBtn label="拒绝" highlight={false} color="red" onClick={() => setMode('reject')} />
          <ActionBtn label="退回" highlight={false} color="gray" onClick={() => setMode('return')} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-w-md">
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-semibold text-gray-700">
          {mode === 'email' && '记录邮件触达'}
          {mode === 'social_outreach' && '记录社交触达'}
          {mode === 'call' && '记录电话触达'}
          {mode === 'reply' && '记录有意义回复'}
          {mode === 'promote_form' && '转为商机'}
          {mode === 'reject' && '拒绝线索'}
          {mode === 'return' && '退回线索'}
        </span>
        <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
      </div>

      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}

      <div className="space-y-2">
        {mode === 'email' && (
          <>
            <input type="text" placeholder="收件人邮箱" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
            <input type="text" placeholder="邮件主题" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
          </>
        )}

        {mode === 'social_outreach' && (
          <>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full text-sm border border-gray-300 rounded px-3 py-2">
              <option value="linkedin">LinkedIn</option>
              <option value="instagram">Instagram</option>
              <option value="wechat">WeChat</option>
            </select>
            <textarea placeholder="发送的消息内容" value={messagePreview} onChange={(e) => setMessagePreview(e.target.value)} rows={2} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
          </>
        )}

        {mode === 'call' && (
          <>
            <input type="number" placeholder="通话时长（分钟）" value={callDuration} onChange={(e) => setCallDuration(e.target.value)} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
            <input type="text" placeholder="通话结果" value={callOutcome} onChange={(e) => setCallOutcome(e.target.value)} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
          </>
        )}

        {mode === 'reply' && (
          <textarea placeholder="回复内容摘要（必填）" value={replySummary} onChange={(e) => setReplySummary(e.target.value)} rows={3} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
        )}

        {mode === 'promote_form' && (
          <>
            <input type="number" placeholder="预估订单金额（选填）" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
            <input type="text" placeholder="产品品类" value={promoteCategory} onChange={(e) => setPromoteCategory(e.target.value)} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
            <textarea placeholder="备注（选填）" value={promoteNotes} onChange={(e) => setPromoteNotes(e.target.value)} rows={2} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
          </>
        )}

        {(mode === 'reject' || mode === 'return') && (
          <textarea placeholder={mode === 'reject' ? '拒绝原因' : '退回原因'} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
        )}

        {mode !== 'reply' && mode !== 'promote_form' && (
          <textarea placeholder="备注（选填）" value={note} onChange={(e) => setNote(e.target.value)} rows={1} className="w-full text-sm border border-gray-300 rounded px-3 py-2" />
        )}

        <button onClick={handleAction} disabled={isLoading} className="w-full text-sm px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50">
          {isLoading ? '提交中...' : '提交'}
        </button>
      </div>
    </div>
  );
}

const BTN_STYLES: Record<string, { normal: string; highlight: string }> = {
  blue:   { normal: 'border border-blue-300 text-blue-700 hover:bg-blue-50', highlight: 'bg-blue-600 text-white ring-2 ring-blue-300 hover:bg-blue-700' },
  indigo: { normal: 'border border-indigo-300 text-indigo-700 hover:bg-indigo-50', highlight: 'bg-indigo-600 text-white ring-2 ring-indigo-300 hover:bg-indigo-700' },
  green:  { normal: 'border border-green-300 text-green-700 hover:bg-green-50', highlight: 'bg-green-600 text-white ring-2 ring-green-300 hover:bg-green-700' },
  teal:   { normal: 'border border-teal-300 text-teal-700 hover:bg-teal-50', highlight: 'bg-teal-600 text-white ring-2 ring-teal-300 hover:bg-teal-700' },
  purple: { normal: 'border border-purple-300 text-purple-700 hover:bg-purple-50', highlight: 'bg-purple-600 text-white ring-2 ring-purple-300 hover:bg-purple-700' },
  red:    { normal: 'border border-red-200 text-red-600 hover:bg-red-50', highlight: 'border border-red-200 text-red-600 hover:bg-red-50' },
  gray:   { normal: 'border border-gray-200 text-gray-600 hover:bg-gray-50', highlight: 'border border-gray-200 text-gray-600 hover:bg-gray-50' },
};

function ActionBtn({ label, highlight, color, onClick }: {
  label: string; highlight: boolean; color: string; onClick: () => void;
}) {
  const styles = BTN_STYLES[color] || BTN_STYLES.gray;
  return (
    <button
      onClick={onClick}
      className={`text-sm px-4 py-2 rounded ${highlight ? styles.highlight : styles.normal}`}
    >
      {label}{highlight ? ' ←' : ''}
    </button>
  );
}
